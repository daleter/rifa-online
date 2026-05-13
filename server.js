require('dotenv').config();
const express = require('express');
const session = require('express-session');
const rateLimit = require('express-rate-limit');
const cron = require('node-cron');
const path = require('path');

const { initDb, pool } = require('./db');
const apiRoutes = require('./routes/api');
const adminRoutes = require('./routes/admin');
const { liberarReservasExpiradas } = require('./services/reservas');
const { executarSorteio } = require('./services/sorteio');
const { notificarSorteio, iniciarPolling } = require('./services/telegram');

const app = express();
const PORT = process.env.PORT || 3000;

app.set('trust proxy', 1);

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

app.use(session({
  secret: process.env.SESSION_SECRET || 'dev-secret-troque-em-producao',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    maxAge: 8 * 60 * 60 * 1000
  }
}));

const limiterGeral = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: { erro: 'Muitas requisições. Aguarde alguns minutos.' }
});

const limiterReserva = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 5,
  message: { erro: 'Muitas tentativas de reserva. Aguarde 10 minutos.' }
});

const limiterAdmin = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  message: { erro: 'Muitas tentativas de acesso admin.' }
});

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  next();
});

app.use('/api', limiterGeral);
app.use('/api/reservar', limiterReserva);
app.use('/admin', limiterAdmin);

app.use('/api', apiRoutes);
app.use('/admin', adminRoutes);
app.use(express.static(path.join(__dirname, 'public')));

app.get('*', (req, res) => {
  if (req.path.startsWith('/api') || req.path.startsWith('/admin')) {
    return res.status(404).json({ erro: 'Rota não encontrada' });
  }
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Cron: limpar reservas expiradas a cada 2 minutos
cron.schedule('*/2 * * * *', () => {
  liberarReservasExpiradas().catch(err => console.error('[Cron] Erro ao liberar reservas:', err.message));
});

// Cron: verificar sorteio agendado a cada minuto
cron.schedule('* * * * *', async () => {
  const dataHoraStr = process.env.SORTEIO_DATA_HORA;
  if (!dataHoraStr) return;

  const agora     = new Date();
  const agendado  = new Date(dataHoraStr);

  if (isNaN(agendado.getTime()) || agora < agendado) return;

  try {
    const { rows } = await pool.query('SELECT numero_sorteado FROM sorteio WHERE id = 1');
    if (rows[0]?.numero_sorteado) return;

    console.log('[Cron] Executando sorteio agendado...');
    const resultado = await executarSorteio();
    if (resultado.sucesso) {
      console.log('[Cron] Sorteio realizado:', resultado.resultado);
      notificarSorteio(resultado.resultado).catch(console.error);
    }
  } catch (err) {
    console.error('[Cron] Erro no sorteio:', err.message);
  }
});

// Inicializa banco e sobe o servidor
initDb()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`✅ Servidor rodando em http://localhost:${PORT}`);
      console.log(`📊 Painel admin: http://localhost:${PORT}/admin.html`);
      console.log(`🔑 Sorteio agendado: ${process.env.SORTEIO_DATA_HORA || 'Não definido'}`);
      if (!process.env.ADMIN_PASSWORD) {
        console.warn('⚠️  ATENÇÃO: ADMIN_PASSWORD não definido!');
      }
      if (!process.env.TELEGRAM_BOT_TOKEN) {
        console.warn('⚠️  ATENÇÃO: TELEGRAM_BOT_TOKEN não definido. Notificações desabilitadas.');
      }
      iniciarPolling();
    });
  })
  .catch(err => {
    console.error('❌ Falha ao conectar ao banco de dados:', err.message);
    process.exit(1);
  });
