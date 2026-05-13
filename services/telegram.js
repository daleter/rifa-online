require('dotenv').config();
const { pool } = require('../db');

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID   = process.env.TELEGRAM_CHAT_ID;

async function enviarMensagem(texto) {
  if (!BOT_TOKEN || !CHAT_ID) {
    console.log('[Telegram] Não configurado. Mensagem:', texto);
    return;
  }
  try {
    const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: CHAT_ID, text: texto, parse_mode: 'HTML' })
    });
    const data = await res.json();
    if (!data.ok) console.error('[Telegram] Erro:', data.description);
  } catch (err) {
    console.error('[Telegram] Falha ao enviar:', err.message);
  }
}

async function notificarNovaCompra(compra, numeros) {
  const id8 = compra.id.substring(0, 8);
  const texto = `
🎟️ <b>NOVA RESERVA!</b>

👤 <b>${compra.nome_comprador}</b>
📱 ${compra.telefone || 'Telefone não informado'}
🔢 Números: ${numeros.join(', ')}
💰 Valor: R$ ${parseFloat(compra.total_valor).toFixed(2)}
⏳ Expira em ${process.env.MINUTOS_EXPIRACAO_RESERVA || 30} min

Após receber o Pix, confirme:
/confirmar ${id8}
  `.trim();
  await enviarMensagem(texto);
}

async function notificarPagamentoConfirmado(compra, numeros) {
  const texto = `
✅ <b>PAGAMENTO CONFIRMADO</b>

👤 ${compra.nome_comprador}
🔢 Números: ${numeros.join(', ')}
💰 R$ ${parseFloat(compra.total_valor).toFixed(2)}
  `.trim();
  await enviarMensagem(texto);
}

async function notificarSorteio(resultado) {
  const texto = `
🏆 <b>SORTEIO REALIZADO!</b>

🎯 Número sorteado: <b>${resultado.numero_sorteado}</b>
👤 Ganhador: ${resultado.nome_ganhador}
📍 ${resultado.endereco_parcial}
🔧 Método: ${resultado.metodo}
  `.trim();
  await enviarMensagem(texto);
}

// ── Comandos ─────────────────────────────────────────────────────────────────

async function processarComando(texto) {
  const partes = texto.trim().split(/\s+/);
  const cmd    = partes[0].toLowerCase();
  const argId  = partes[1] || '';

  switch (cmd) {
    case '/confirmar': {
      if (!argId) {
        await enviarMensagem('❌ Use: /confirmar &lt;id&gt;\nEx: /confirmar abc12345');
        return;
      }
      const { rows } = await pool.query(
        "SELECT * FROM compras WHERE id LIKE $1 AND status = 'pendente'",
        [argId + '%']
      );
      const compra = rows[0];

      if (!compra) {
        await enviarMensagem(`❌ Compra não encontrada ou já confirmada.\nID buscado: <code>${argId}</code>`);
        return;
      }

      const numeros = JSON.parse(compra.numeros_json);

      await pool.query(
        "UPDATE compras SET status='confirmado', confirmado_at=CURRENT_TIMESTAMP WHERE id=$1",
        [compra.id]
      );
      await pool.query(
        "UPDATE numeros SET status='vendido', reservado_ate=NULL WHERE compra_id=$1 AND status IN ('reservado','vendido')",
        [compra.id]
      );

      await enviarMensagem(
        `✅ <b>Confirmado!</b>\n\n` +
        `👤 ${compra.nome_comprador}\n` +
        `🔢 Números: ${numeros.join(', ')}\n` +
        `💰 R$ ${parseFloat(compra.total_valor).toFixed(2)}`
      );
      break;
    }

    case '/cancelar': {
      if (!argId) {
        await enviarMensagem('❌ Use: /cancelar &lt;id&gt;');
        return;
      }
      const { rows } = await pool.query(
        "SELECT * FROM compras WHERE id LIKE $1 AND status = 'pendente'",
        [argId + '%']
      );
      const compra = rows[0];

      if (!compra) {
        await enviarMensagem(`❌ Compra não encontrada ou não está pendente.\nID: <code>${argId}</code>`);
        return;
      }

      const numeros = JSON.parse(compra.numeros_json);
      await pool.query(
        "UPDATE numeros SET status='livre', compra_id=NULL, reservado_ate=NULL WHERE compra_id=$1",
        [compra.id]
      );
      await pool.query("UPDATE compras SET status='cancelado' WHERE id=$1", [compra.id]);

      await enviarMensagem(
        `🗑️ <b>Cancelado e números liberados.</b>\n\n` +
        `👤 ${compra.nome_comprador}\n` +
        `🔢 ${numeros.join(', ')}`
      );
      break;
    }

    case '/pendentes': {
      const { rows: lista } = await pool.query(
        "SELECT * FROM compras WHERE status='pendente' ORDER BY created_at DESC LIMIT 10"
      );

      if (lista.length === 0) {
        await enviarMensagem('✅ Nenhuma compra pendente!');
        return;
      }

      const linhas = lista.map(c => {
        const nums = JSON.parse(c.numeros_json);
        const id8  = c.id.substring(0, 8);
        return `• <b>${c.nome_comprador}</b> — ${nums.join(',')} — R$${parseFloat(c.total_valor).toFixed(0)}\n  /confirmar ${id8}`;
      }).join('\n\n');

      await enviarMensagem(`📋 <b>${lista.length} pendente(s):</b>\n\n${linhas}`);
      break;
    }

    case '/stats': {
      const { rows } = await pool.query(`
        SELECT
          (SELECT COUNT(*)::INT FROM numeros WHERE status='livre')     AS livres,
          (SELECT COUNT(*)::INT FROM numeros WHERE status='reservado') AS reservados,
          (SELECT COUNT(*)::INT FROM numeros WHERE status='vendido')   AS vendidos,
          (SELECT COUNT(*)::INT FROM compras  WHERE status='pendente') AS pendentes,
          (SELECT COALESCE(SUM(total_valor),0)::FLOAT8 FROM compras WHERE status='confirmado') AS arrecadado
      `);
      const s = rows[0];

      await enviarMensagem(
        `📊 <b>Resumo da rifa</b>\n\n` +
        `🟢 Livres: ${s.livres}\n` +
        `🟡 Reservados: ${s.reservados}\n` +
        `🔴 Vendidos: ${s.vendidos}\n` +
        `⏳ Pendentes confirmar: ${s.pendentes}\n` +
        `💰 Arrecadado: R$ ${parseFloat(s.arrecadado).toFixed(2)}`
      );
      break;
    }

    case '/start':
    case '/ajuda':
    case '/help': {
      await enviarMensagem(
        '🤖 <b>Comandos disponíveis:</b>\n\n' +
        '/pendentes — ver reservas aguardando confirmação\n' +
        '/confirmar &lt;id&gt; — confirmar pagamento recebido\n' +
        '/cancelar &lt;id&gt; — cancelar reserva e liberar números\n' +
        '/stats — resumo geral da rifa'
      );
      break;
    }

    default:
      break;
  }
}

// ── Polling ──────────────────────────────────────────────────────────────────

function iniciarPolling() {
  if (!BOT_TOKEN || !CHAT_ID) {
    console.warn('[Telegram] BOT_TOKEN ou CHAT_ID não configurado. Polling desabilitado.');
    return;
  }

  let offset = 0;

  async function poll() {
    try {
      const res = await fetch(
        `https://api.telegram.org/bot${BOT_TOKEN}/getUpdates?offset=${offset}&timeout=25`,
        { signal: AbortSignal.timeout(30000) }
      );
      const data = await res.json();

      if (data.ok) {
        for (const update of data.result) {
          offset = update.update_id + 1;
          const msg = update.message;
          if (!msg?.text) continue;
          if (String(msg.chat.id) !== String(CHAT_ID)) continue;
          processarComando(msg.text).catch(console.error);
        }
      }
    } catch (err) {
      if (!err.message.includes('abort') && !err.message.includes('timeout')) {
        console.error('[Telegram] Erro no polling:', err.message);
      }
    }
    setTimeout(poll, 1000);
  }

  poll();
  console.log('[Telegram] Bot polling iniciado ✅');
}

module.exports = {
  enviarMensagem,
  notificarNovaCompra,
  notificarPagamentoConfirmado,
  notificarSorteio,
  iniciarPolling
};
