// ── Estado ────────────────────────────────────────────────────────────────────
let numerosData = [];
let selecionados = new Set();
let etag = '';
let pollingInterval = null;
const PRECO = 15;

// ── Inicialização ─────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  renderGridSkeleton();
  carregarNumeros();
  verificarSorteio();
  pollingInterval = setInterval(carregarNumeros, 10000);
  setInterval(verificarSorteio, 60000);
});

function renderGridSkeleton() {
  const grid = document.getElementById('grid-numeros');
  grid.innerHTML = Array.from({ length: 120 }, () =>
    `<div class="num-btn skeleton" style="opacity:0.3">&nbsp;</div>`
  ).join('');
}

// ── API ───────────────────────────────────────────────────────────────────────
async function carregarNumeros() {
  try {
    const headers = etag ? { 'If-None-Match': etag } : {};
    const res = await fetch('/api/numeros', { headers });

    if (res.status === 304) return;
    if (!res.ok) throw new Error('Erro ao carregar números');

    etag = res.headers.get('ETag') || '';
    numerosData = await res.json();
    renderGrid();
    atualizarStats();
  } catch (err) {
    console.error('Erro ao carregar números:', err);
  }
}

async function verificarSorteio() {
  try {
    const res = await fetch('/api/sorteio');
    const data = await res.json();
    if (data.realizado && data.resultado) {
      mostrarResultadoSorteio(data.resultado);
      if (pollingInterval) {
        clearInterval(pollingInterval);
        pollingInterval = null;
      }
    }
  } catch (err) {
    console.error('Erro ao verificar sorteio:', err);
  }
}

// ── Render ────────────────────────────────────────────────────────────────────
function renderGrid() {
  const grid = document.getElementById('grid-numeros');
  grid.innerHTML = '';

  for (const item of numerosData) {
    const btn = document.createElement('button');
    btn.className = `num-btn ${item.status}`;
    if (selecionados.has(item.numero) && item.status === 'livre') {
      btn.className = 'num-btn selecionado';
    }
    btn.textContent = item.numero;
    btn.title = item.status === 'vendido' && item.nome_comprador
      ? `Vendido para ${item.nome_comprador.split(' ')[0]}`
      : item.status;

    if (item.status === 'livre') {
      btn.addEventListener('click', () => toggleNumero(item.numero, btn));
    }

    grid.appendChild(btn);
  }
}

function atualizarStats() {
  const livres = numerosData.filter(n => n.status === 'livre').length;
  const vendidos = numerosData.filter(n => n.status === 'vendido').length;
  document.getElementById('stat-livres').textContent = livres;
  document.getElementById('stat-vendidos').textContent = vendidos;
}

function mostrarResultadoSorteio(resultado) {
  document.getElementById('secao-sorteio').style.display = 'block';
  document.getElementById('numero-sorteado').textContent = resultado.numero_sorteado;
  document.getElementById('ganhador-nome').textContent = `🏆 ${resultado.nome_ganhador}`;
  document.getElementById('ganhador-ende').textContent = `📍 ${resultado.endereco_parcial}`;
  document.getElementById('sorteio-metodo').textContent = `Método: ${resultado.metodo}`;

  const btns = document.querySelectorAll('.num-btn');
  btns.forEach(btn => {
    if (parseInt(btn.textContent) === resultado.numero_sorteado) {
      btn.classList.add('sorteado');
    }
  });
}

// ── Seleção ───────────────────────────────────────────────────────────────────
function toggleNumero(numero, btn) {
  if (selecionados.has(numero)) {
    selecionados.delete(numero);
    btn.className = 'num-btn livre';
  } else {
    if (selecionados.size >= 50) {
      alert('Máximo de 50 números por compra.');
      return;
    }
    selecionados.add(numero);
    btn.className = 'num-btn selecionado';
  }
  atualizarSelecaoUI();
}

function atualizarSelecaoUI() {
  const total = selecionados.size * PRECO;
  const info = document.getElementById('selecao-info');
  const texto = document.getElementById('selecao-texto');
  const btnComprar = document.getElementById('btn-comprar');

  if (selecionados.size > 0) {
    info.style.display = 'flex';
    btnComprar.style.display = 'block';
    texto.textContent = `${selecionados.size} número(s) • Total: R$ ${total.toFixed(2).replace('.', ',')}`;
  } else {
    info.style.display = 'none';
    btnComprar.style.display = 'none';
  }
}

function limparSelecao() {
  selecionados.clear();
  renderGrid();
  atualizarSelecaoUI();
}

// ── Modal ─────────────────────────────────────────────────────────────────────
function abrirModal() {
  if (selecionados.size === 0) return;
  document.getElementById('modal-compra').style.display = 'flex';
  document.getElementById('modal-conteudo-formulario').style.display = 'block';
  document.getElementById('modal-conteudo-pix').style.display = 'none';
  document.getElementById('erro-formulario').style.display = 'none';

  const nums = [...selecionados].sort((a, b) => a - b);
  const total = selecionados.size * PRECO;
  document.getElementById('modal-numeros').textContent = nums.join(', ');
  document.getElementById('modal-total').textContent = `R$ ${total.toFixed(2).replace('.', ',')}`;

  document.body.style.overflow = 'hidden';
}

function fecharModal() {
  document.getElementById('modal-compra').style.display = 'none';
  document.body.style.overflow = '';
}

document.addEventListener('keydown', e => { if (e.key === 'Escape') fecharModal(); });

// ── Compra ────────────────────────────────────────────────────────────────────
async function reservarNumeros() {
  const nome = document.getElementById('input-nome').value.trim();
  const telefone = document.getElementById('input-telefone').value.trim();
  const endereco = document.getElementById('input-endereco').value.trim();
  const erroEl = document.getElementById('erro-formulario');
  const btnConfirmar = document.querySelector('.btn-confirmar');

  function mostrarErro(msg) {
    erroEl.textContent = msg;
    erroEl.style.display = 'block';
  }

  if (nome.length < 2) return mostrarErro('Por favor, informe seu nome completo.');
  if (endereco.length < 5) return mostrarErro('Por favor, informe o endereço completo de entrega.');

  btnConfirmar.disabled = true;
  btnConfirmar.textContent = 'Processando...';
  erroEl.style.display = 'none';

  try {
    const res = await fetch('/api/reservar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        nome,
        telefone: telefone || undefined,
        endereco,
        numeros: [...selecionados]
      })
    });

    const data = await res.json();

    if (!res.ok) {
      mostrarErro(data.erro || 'Erro ao processar reserva. Tente novamente.');
      btnConfirmar.disabled = false;
      btnConfirmar.textContent = 'Confirmar e ver dados do Pix';
      return;
    }

    document.getElementById('modal-conteudo-formulario').style.display = 'none';
    document.getElementById('modal-conteudo-pix').style.display = 'block';

    const chave = data.pix_chave || '—';
    const valor = `R$ ${data.total_valor.toFixed(2).replace('.', ',')}`;
    const nums  = (data.numeros || []).sort((a, b) => a - b).join(', ');

    document.getElementById('pix-chave').textContent = chave;
    document.getElementById('pix-nome').textContent  = data.pix_nome || '—';
    document.getElementById('pix-valor').textContent = valor;
    document.getElementById('pix-minutos').textContent = data.minutos_para_pagar;
    document.getElementById('pix-compra-id').textContent = data.compra_id;

    const pixPayload = gerarPixCopiaCola(
      chave,
      data.pix_nome || 'ORGANIZADOR',
      data.pix_cidade || 'BRASIL',
      data.total_valor
    );
    document.getElementById('pix-copia-cola').textContent = pixPayload;

    const msgWhats = `Oi Dáleter! Acabei de pagar o Pix da rifa 🇧🇷\n\n` +
      `✅ Valor pago: ${valor}\n` +
      `🔢 Meus números: ${nums}\n` +
      `🔑 Chave usada: ${chave}\n\n` +
      `Segue o comprovante!`;
    const btnWhats = document.querySelector('.pix-whats-btn');
    if (btnWhats) btnWhats.href = `https://wa.me/5519988669279?text=${encodeURIComponent(msgWhats)}`;

    selecionados.clear();
    atualizarSelecaoUI();
    await carregarNumeros();

  } catch (err) {
    mostrarErro('Erro de conexão. Tente novamente.');
    btnConfirmar.disabled = false;
    btnConfirmar.textContent = 'Confirmar e ver dados do Pix';
  }
}

function copiarPix() {
  const payload = document.getElementById('pix-copia-cola').textContent;
  const btn = document.querySelector('.btn-copiar');
  navigator.clipboard.writeText(payload).then(() => {
    btn.textContent = '✅ Copiado!';
    setTimeout(() => { btn.textContent = 'Copiar código'; }, 2500);
  }).catch(() => {
    alert('Código Pix:\n' + payload);
  });
}

function gerarPixCopiaCola(chave, nome, cidade, valor) {
  function emv(id, v) {
    return `${id}${String(v.length).padStart(2, '0')}${v}`;
  }
  function norm(s, max) {
    return s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9 ]/g, ' ').substring(0, max).toUpperCase().trim();
  }
  // CPF/CNPJ: DICT armazena só dígitos, sem pontuação
  function normalizeChave(c) {
    const digits = c.replace(/\D/g, '');
    if ((digits.length === 11 || digits.length === 14) && /^[\d.\-\/]+$/.test(c)) return digits;
    return c;
  }

  const chaveNorm = normalizeChave(chave);
  const merchant = emv('26', emv('00', 'br.gov.bcb.pix') + emv('01', chaveNorm));
  const valorStr = parseFloat(valor).toFixed(2);

  let payload =
    emv('00', '01') +
    emv('01', '11') +    // 11 = estático (chave direta); 12 = dinâmico (URL) — não usar 12 com chave
    merchant +
    emv('52', '0000') +
    emv('53', '986') +
    emv('54', valorStr) +
    emv('58', 'BR') +
    emv('59', norm(nome, 25)) +
    emv('60', norm(cidade, 15)) +
    emv('62', emv('05', '***')) +
    '6304';

  let crc = 0xFFFF;
  for (const c of payload) {
    crc ^= c.charCodeAt(0) << 8;
    for (let i = 0; i < 8; i++) {
      crc = (crc & 0x8000) ? (crc << 1) ^ 0x1021 : crc << 1;
      crc &= 0xFFFF;
    }
  }
  return payload + crc.toString(16).toUpperCase().padStart(4, '0');
}
