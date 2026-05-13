const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const { pool } = require('../db');
const { notificarNovaCompra } = require('../services/telegram');
const { liberarReservasExpiradas } = require('../services/reservas');

router.get('/numeros', async (req, res) => {
  try {
    await liberarReservasExpiradas();

    const { rows: numeros } = await pool.query(`
      SELECT n.numero, n.status, n.reservado_ate,
             CASE WHEN n.status = 'vendido' THEN c.nome_comprador ELSE NULL END AS nome_comprador
      FROM numeros n
      LEFT JOIN compras c ON n.compra_id = c.id AND c.status = 'confirmado'
      ORDER BY n.numero
    `);

    const hash = crypto.createHash('md5').update(JSON.stringify(numeros)).digest('hex');
    res.set('ETag', hash);

    if (req.headers['if-none-match'] === hash) {
      return res.status(304).end();
    }

    res.json(numeros);
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

router.get('/sorteio', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM sorteio WHERE id = 1');
    const resultado = rows[0];
    if (!resultado || !resultado.numero_sorteado) {
      const dataHora = process.env.SORTEIO_DATA_HORA || null;
      return res.json({ realizado: false, data_hora_agendada: dataHora });
    }
    res.json({ realizado: true, resultado });
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

router.post('/reservar', async (req, res) => {
  const { nome, telefone, endereco, numeros } = req.body;

  if (!nome || typeof nome !== 'string' || nome.trim().length < 2 || nome.trim().length > 100) {
    return res.status(400).json({ erro: 'Nome inválido (2-100 caracteres)' });
  }
  if (!endereco || typeof endereco !== 'string' || endereco.trim().length < 5 || endereco.trim().length > 300) {
    return res.status(400).json({ erro: 'Endereço inválido (5-300 caracteres)' });
  }
  if (telefone && (typeof telefone !== 'string' || !/^[\d\s\(\)\-\+]{8,20}$/.test(telefone))) {
    return res.status(400).json({ erro: 'Telefone inválido' });
  }
  if (!Array.isArray(numeros) || numeros.length === 0 || numeros.length > 50) {
    return res.status(400).json({ erro: 'Selecione entre 1 e 50 números' });
  }
  if (!numeros.every(n => Number.isInteger(n) && n >= 1 && n <= 120)) {
    return res.status(400).json({ erro: 'Números inválidos (1-120)' });
  }
  if (new Set(numeros).size !== numeros.length) {
    return res.status(400).json({ erro: 'Números duplicados na seleção' });
  }

  try {
    const { rows: sorteioRows } = await pool.query('SELECT numero_sorteado FROM sorteio WHERE id = 1');
    if (sorteioRows[0]?.numero_sorteado) {
      return res.status(400).json({ erro: 'Rifa encerrada. Sorteio já foi realizado.' });
    }

    await liberarReservasExpiradas();

    const minutosExpiracao = parseInt(process.env.MINUTOS_EXPIRACAO_RESERVA || '30');
    const expiracao = new Date(Date.now() + minutosExpiracao * 60 * 1000).toISOString();
    const compraId  = crypto.randomUUID();
    const totalValor = numeros.length * parseFloat(process.env.PRECO_NUMERO || '15');

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      for (const num of numeros) {
        const { rows } = await client.query('SELECT status FROM numeros WHERE numero = $1', [num]);
        if (!rows[0] || rows[0].status !== 'livre') {
          throw new Error(`Número ${num} não está disponível`);
        }
      }

      await client.query(`
        INSERT INTO compras (id, nome_comprador, telefone, endereco, numeros_json, total_valor)
        VALUES ($1, $2, $3, $4, $5, $6)
      `, [compraId, nome.trim(), telefone?.trim() || null, endereco.trim(), JSON.stringify(numeros), totalValor]);

      for (const num of numeros) {
        const { rowCount } = await client.query(`
          UPDATE numeros SET status = 'reservado', compra_id = $1, reservado_ate = $2
          WHERE numero = $3 AND status = 'livre'
        `, [compraId, expiracao, num]);
        if (rowCount === 0) throw new Error(`Número ${num} foi reservado por outro comprador`);
      }

      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }

    const compra = {
      id: compraId,
      nome_comprador: nome.trim(),
      telefone: telefone?.trim(),
      endereco: endereco.trim(),
      total_valor: totalValor
    };
    notificarNovaCompra(compra, numeros).catch(console.error);

    res.json({
      sucesso: true,
      compra_id: compraId,
      numeros,
      total_valor: totalValor,
      expira_em: expiracao,
      pix_chave: process.env.PIX_CHAVE,
      pix_nome: process.env.PIX_NOME,
      pix_cidade: process.env.PIX_CIDADE || 'BRASIL',
      minutos_para_pagar: minutosExpiracao
    });
  } catch (err) {
    res.status(409).json({ erro: err.message });
  }
});

router.get('/compra/:id', async (req, res) => {
  const { id } = req.params;
  if (!/^[0-9a-f\-]{36}$/.test(id)) return res.status(400).json({ erro: 'ID inválido' });

  try {
    const { rows } = await pool.query(
      'SELECT id, status, created_at, confirmado_at, numeros_json, total_valor FROM compras WHERE id = $1',
      [id]
    );
    const compra = rows[0];
    if (!compra) return res.status(404).json({ erro: 'Compra não encontrada' });

    res.json({ ...compra, numeros: JSON.parse(compra.numeros_json) });
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

module.exports = router;
