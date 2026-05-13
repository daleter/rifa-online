const { pool } = require('../db');

async function liberarReservasExpiradas() {
  const agora = new Date().toISOString();

  const { rows: comprasExpiradas } = await pool.query(`
    SELECT DISTINCT compra_id FROM numeros
    WHERE status = 'reservado' AND reservado_ate < $1
  `, [agora]);

  if (comprasExpiradas.length === 0) return 0;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rowCount } = await client.query(`
      UPDATE numeros SET status = 'livre', compra_id = NULL, reservado_ate = NULL
      WHERE status = 'reservado' AND reservado_ate < $1
    `, [agora]);

    for (const { compra_id } of comprasExpiradas) {
      await client.query(`
        UPDATE compras SET status = 'cancelado'
        WHERE id = $1 AND status = 'pendente'
      `, [compra_id]);
    }

    await client.query('COMMIT');

    if (rowCount > 0) {
      console.log(`[Reservas] ${rowCount} número(s) liberado(s) de ${comprasExpiradas.length} compra(s) expirada(s)`);
    }
    return rowCount;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

module.exports = { liberarReservasExpiradas };
