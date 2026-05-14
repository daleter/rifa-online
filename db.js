require('dotenv').config();
// Render free tier não roteia IPv6 — força resolução IPv4
require('dns').setDefaultResultOrder('ipv4first');
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  max: 10
});

async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS numeros (
      numero INTEGER PRIMARY KEY CHECK(numero >= 1 AND numero <= 120),
      status TEXT NOT NULL DEFAULT 'livre' CHECK(status IN ('livre', 'reservado', 'vendido')),
      compra_id TEXT,
      reservado_ate TIMESTAMPTZ,
      updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS compras (
      id TEXT PRIMARY KEY,
      nome_comprador TEXT NOT NULL,
      telefone TEXT,
      endereco TEXT NOT NULL,
      numeros_json TEXT NOT NULL,
      total_valor FLOAT8 NOT NULL,
      status TEXT NOT NULL DEFAULT 'pendente' CHECK(status IN ('pendente', 'confirmado', 'cancelado')),
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      confirmado_at TIMESTAMPTZ,
      observacao TEXT
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS sorteio (
      id INTEGER PRIMARY KEY DEFAULT 1,
      numero_sorteado INTEGER,
      compra_id TEXT,
      nome_ganhador TEXT,
      endereco_parcial TEXT,
      realizado_at TIMESTAMPTZ,
      metodo TEXT
    )
  `);

  const { rows } = await pool.query('SELECT COUNT(*)::INT AS c FROM numeros');
  if (rows[0].c === 0) {
    const vals = Array.from({ length: 120 }, (_, i) => `(${i + 1})`).join(',');
    await pool.query(`INSERT INTO numeros (numero) VALUES ${vals} ON CONFLICT DO NOTHING`);
    console.log('[DB] 120 números inseridos na tabela numeros');
  }

  console.log('[DB] Banco inicializado ✅');
}

module.exports = { pool, initDb };
