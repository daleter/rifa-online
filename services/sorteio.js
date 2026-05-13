const crypto = require('crypto');
const { pool } = require('../db');

async function gerarNumeroAleatorio(min, max) {
  try {
    const response = await fetch('https://api.random.org/json-rpc/4/invoke', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'generateIntegers',
        params: {
          apiKey: '00000000-0000-0000-0000-000000000000',
          n: 1,
          min,
          max,
          replacement: true
        },
        id: 1
      }),
      signal: AbortSignal.timeout(5000)
    });

    const data = await response.json();
    if (data.result && data.result.random && data.result.random.data) {
      return { numero: data.result.random.data[0], metodo: 'random.org' };
    }
    throw new Error('Resposta inválida do random.org');
  } catch (err) {
    console.warn('[Sorteio] Usando fallback crypto:', err.message);
    return {
      numero: crypto.randomInt(min, max + 1),
      metodo: 'crypto.randomInt (fallback)'
    };
  }
}

async function executarSorteio() {
  const { rows: existente } = await pool.query(
    'SELECT * FROM sorteio WHERE id = 1 AND numero_sorteado IS NOT NULL'
  );
  if (existente.length > 0) {
    return { erro: 'Sorteio já foi realizado', resultado: existente[0] };
  }

  const { rows: numerosVendidos } = await pool.query(`
    SELECT n.numero, c.id AS compra_id, c.nome_comprador, c.endereco
    FROM numeros n
    JOIN compras c ON n.compra_id = c.id
    WHERE n.status = 'vendido'
  `);

  if (numerosVendidos.length === 0) {
    return { erro: 'Nenhum número vendido para sortear' };
  }

  let numeroSorteado, metodo, tentativas = 0;
  const setVendidos = new Set(numerosVendidos.map(n => n.numero));

  do {
    const resultado = await gerarNumeroAleatorio(1, 120);
    numeroSorteado = resultado.numero;
    metodo = resultado.metodo;
    tentativas++;
    if (tentativas > 200) {
      const idx = crypto.randomInt(0, numerosVendidos.length);
      const escolhido = numerosVendidos[idx];
      numeroSorteado = escolhido.numero;
      metodo = 'seleção direta (fallback máx tentativas)';
      break;
    }
  } while (!setVendidos.has(numeroSorteado));

  const ganhador = numerosVendidos.find(n => n.numero === numeroSorteado);
  const enderecoParcial = ganhador.endereco.split(',')[0].trim() + ', ***';
  const metodoFinal = `${metodo} (${tentativas} tentativa(s))`;

  await pool.query(`
    INSERT INTO sorteio (id, numero_sorteado, compra_id, nome_ganhador, endereco_parcial, realizado_at, metodo)
    VALUES (1, $1, $2, $3, $4, CURRENT_TIMESTAMP, $5)
    ON CONFLICT (id) DO UPDATE SET
      numero_sorteado = EXCLUDED.numero_sorteado,
      compra_id       = EXCLUDED.compra_id,
      nome_ganhador   = EXCLUDED.nome_ganhador,
      endereco_parcial = EXCLUDED.endereco_parcial,
      realizado_at    = EXCLUDED.realizado_at,
      metodo          = EXCLUDED.metodo
  `, [numeroSorteado, ganhador.compra_id, ganhador.nome_comprador, enderecoParcial, metodoFinal]);

  return {
    sucesso: true,
    resultado: {
      numero_sorteado: numeroSorteado,
      nome_ganhador: ganhador.nome_comprador,
      endereco_parcial: enderecoParcial,
      metodo: metodoFinal,
      realizado_at: new Date().toISOString()
    }
  };
}

module.exports = { executarSorteio, gerarNumeroAleatorio };
