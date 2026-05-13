const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const { pool } = require('../db');
const { notificarPagamentoConfirmado, notificarSorteio } = require('../services/telegram');
const { executarSorteio } = require('../services/sorteio');
const { liberarReservasExpiradas } = require('../services/reservas');

function autenticarAdmin(req, res, next) {
  if (req.session && req.session.adminLogado) return next();
  return res.status(401).json({ erro: 'Não autenticado' });
}

function crypto_timing(a, b) {
  try {
    return crypto.timingSafeEqual(Buffer.from(String(a)), Buffer.from(String(b)));
  } catch { return false; }
}

router.post('/login', (req, res) => {
  const { usuario, senha } = req.body;
  const usuarioCorreto = process.env.ADMIN_USERNAME || 'admin';
  const senhaCorreta   = process.env.ADMIN_PASSWORD;

  if (!senhaCorreta) {
    return res.status(500).json({ erro: 'Admin não configurado (defina ADMIN_PASSWORD no .env)' });
  }

  const usuarioOk = crypto_timing(usuario, usuarioCorreto);
  const senhaOk   = crypto_timing(senha, senhaCorreta);

  if (usuarioOk && senhaOk) {
    req.session.adminLogado = true;
    req.session.save();
    res.json({ sucesso: true });
  } else {
    res.status(401).json({ erro: 'Credenciais inválidas' });
  }
});

router.post('/logout', (req, res) => {
  req.session.destroy();
  res.json({ sucesso: true });
});

router.get('/verificar-sessao', (req, res) => {
  res.json({ logado: !!(req.session && req.session.adminLogado) });
});

router.get('/dashboard', autenticarAdmin, async (req, res) => {
  try {
    await liberarReservasExpiradas();

    const { rows: statsRows } = await pool.query(`
      SELECT
        (SELECT COUNT(*)::INT FROM numeros WHERE status = 'livre')      AS livres,
        (SELECT COUNT(*)::INT FROM numeros WHERE status = 'reservado')  AS reservados,
        (SELECT COUNT(*)::INT FROM numeros WHERE status = 'vendido')    AS vendidos,
        (SELECT COUNT(*)::INT FROM compras WHERE status = 'pendente')   AS compras_pendentes,
        (SELECT COUNT(*)::INT FROM compras WHERE status = 'confirmado') AS compras_confirmadas,
        (SELECT COALESCE(SUM(total_valor),0)::FLOAT8 FROM compras WHERE status = 'confirmado') AS total_arrecadado
    `);

    const { rows: sorteioRows } = await pool.query('SELECT * FROM sorteio WHERE id = 1');

    res.json({ stats: statsRows[0], sorteio: sorteioRows[0] || null });
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

router.get('/compras', autenticarAdmin, async (req, res) => {
  try {
    const { status } = req.query;
    let query = 'SELECT * FROM compras';
    const params = [];

    if (status && ['pendente', 'confirmado', 'cancelado'].includes(status)) {
      query += ' WHERE status = $1';
      params.push(status);
    }
    query += ' ORDER BY created_at DESC LIMIT 200';

    const { rows: compras } = await pool.query(query, params);
    res.json(compras.map(c => ({ ...c, numeros: JSON.parse(c.numeros_json) })));
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

router.post('/confirmar-pagamento', autenticarAdmin, async (req, res) => {
  const { compra_id, observacao } = req.body;
  if (!compra_id || !/^[0-9a-f\-]{36}$/.test(compra_id)) {
    return res.status(400).json({ erro: 'ID inválido' });
  }

  try {
    const { rows } = await pool.query('SELECT * FROM compras WHERE id = $1', [compra_id]);
    const compra = rows[0];

    if (!compra) return res.status(404).json({ erro: 'Compra não encontrada' });
    if (compra.status === 'confirmado') return res.status(400).json({ erro: 'Compra já confirmada' });
    if (compra.status === 'cancelado')  return res.status(400).json({ erro: 'Compra cancelada (números já liberados)' });

    const numeros = JSON.parse(compra.numeros_json);

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      await client.query(`
        UPDATE compras SET status = 'confirmado', confirmado_at = CURRENT_TIMESTAMP, observacao = $1
        WHERE id = $2
      `, [observacao || null, compra_id]);

      await client.query(`
        UPDATE numeros SET status = 'vendido', reservado_ate = NULL
        WHERE compra_id = $1 AND status IN ('reservado', 'vendido')
      `, [compra_id]);

      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }

    notificarPagamentoConfirmado(compra, numeros).catch(console.error);
    res.json({ sucesso: true, numeros_confirmados: numeros });
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

router.post('/cancelar-compra', autenticarAdmin, async (req, res) => {
  const { compra_id } = req.body;
  if (!compra_id || !/^[0-9a-f\-]{36}$/.test(compra_id)) {
    return res.status(400).json({ erro: 'ID inválido' });
  }

  try {
    const { rows } = await pool.query('SELECT * FROM compras WHERE id = $1', [compra_id]);
    const compra = rows[0];

    if (!compra) return res.status(404).json({ erro: 'Compra não encontrada' });
    if (compra.status === 'confirmado') return res.status(400).json({ erro: 'Não é possível cancelar compra confirmada' });

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        "UPDATE numeros SET status='livre', compra_id=NULL, reservado_ate=NULL WHERE compra_id=$1",
        [compra_id]
      );
      await client.query("UPDATE compras SET status='cancelado' WHERE id=$1", [compra_id]);
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }

    res.json({ sucesso: true });
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

router.post('/executar-sorteio', autenticarAdmin, async (req, res) => {
  try {
    const resultado = await executarSorteio();
    if (resultado.erro) return res.status(400).json({ erro: resultado.erro, resultado: resultado.resultado });
    notificarSorteio(resultado.resultado).catch(console.error);
    res.json(resultado);
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

module.exports = router;
