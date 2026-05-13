// ── Estado ────────────────────────────────────────────────────────────────────
let filtroAtual = null;
let comprasData = [];
let sorteioRealizado = false;

// ── Init ──────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  verificarSessao();
  document.getElementById('login-senha').addEventListener('keydown', e => {
    if (e.key === 'Enter') fazerLogin();
  });
});

async function verificarSessao() {
  try {
    const res = await fetch('/admin/verificar-sessao');
    const data = await res.json();
    if (data.logado) mostrarAdmin();
  } catch {}
}

// ── Auth ──────────────────────────────────────────────────────────────────────
async function fazerLogin() {
  const usuario = document.getElementById('login-usuario').value.trim();
  const senha = document.getElementById('login-senha').value;
  const erroEl = document.getElementById('login-erro');
  const btn = document.querySelector('.btn-login');

  erroEl.style.display = 'none';
  btn.disabled = true;
  btn.textContent = 'Entrando...';

  try {
    const res = await fetch('/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ usuario, senha })
    });
    const data = await res.json();

    if (data.sucesso) {
      mostrarAdmin();
    } else {
      erroEl.textContent = data.erro || 'Credenciais inválidas';
      erroEl.style.display = 'block';
    }
  } catch {
    erroEl.textContent = 'Erro de conexão';
    erroEl.style.display = 'block';
  } finally {
    btn.disabled = false;
    btn.textContent = 'Entrar';
  }
}

async function fazerLogout() {
  await fetch('/admin/logout', { method: 'POST' });
  document.getElementById('tela-admin').style.display = 'none';
  document.getElementById('tela-login').style.display = 'flex';
}

function mostrarAdmin() {
  document.getElementById('tela-login').style.display = 'none';
  document.getElementById('tela-admin').style.display = 'block';
  carregarDashboard();
  carregarCompras();
  setInterval(carregarDashboard, 30000);
  setInterval(carregarCompras, 15000);
}

// ── Dashboard ─────────────────────────────────────────────────────────────────
async function carregarDashboard() {
  try {
    const res = await fetch('/admin/dashboard');
    if (res.status === 401) return;
    const data = await res.json();
    const s = data.stats;

    document.getElementById('s-livres').textContent = s.livres;
    document.getElementById('s-reservados').textContent = s.reservados;
    document.getElementById('s-vendidos').textContent = s.vendidos;
    document.getElementById('s-pendentes').textContent = s.compras_pendentes;
    document.getElementById('s-confirmadas').textContent = s.compras_confirmadas;
    document.getElementById('s-arrecadado').textContent = `R$${s.total_arrecadado.toFixed(0)}`;

    const infoEl = document.getElementById('sorteio-info');
    const btnSorteio = document.getElementById('btn-sorteio');

    if (data.sorteio && data.sorteio.numero_sorteado) {
      sorteioRealizado = true;
      btnSorteio.disabled = true;
      btnSorteio.textContent = '✅ Sorteio já realizado';
      infoEl.innerHTML = `
        <div style="background:rgba(0,200,81,0.08);border:1px solid rgba(0,200,81,0.3);border-radius:10px;padding:1rem;margin-bottom:1rem;font-size:0.9rem">
          <strong>Número sorteado: ${data.sorteio.numero_sorteado}</strong><br>
          Ganhador: ${data.sorteio.nome_ganhador}<br>
          Endereço: ${data.sorteio.endereco_parcial}<br>
          Método: ${data.sorteio.metodo}<br>
          <small style="color:var(--texto-muted)">Realizado em: ${formatarData(data.sorteio.realizado_at)}</small>
        </div>
      `;
    } else {
      infoEl.innerHTML = `<p style="color:var(--texto-muted);font-size:0.9rem;margin-bottom:1rem">Sorteio ainda não realizado.</p>`;
    }
  } catch (err) {
    console.error('Erro ao carregar dashboard:', err);
  }
}

// ── Compras ───────────────────────────────────────────────────────────────────
async function carregarCompras(status = filtroAtual) {
  try {
    const url = status ? `/admin/compras?status=${status}` : '/admin/compras';
    const res = await fetch(url);
    if (res.status === 401) return;
    comprasData = await res.json();
    renderTabela(comprasData);
  } catch (err) {
    console.error('Erro ao carregar compras:', err);
  }
}

function filtrar(status, btn) {
  document.querySelectorAll('.btn-filtro').forEach(b => b.classList.remove('ativo'));
  btn.classList.add('ativo');
  filtroAtual = status === 'todos' ? null : status;
  carregarCompras(filtroAtual);
}

function renderTabela(compras) {
  const tbody = document.getElementById('tbody-compras');
  if (compras.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" class="msg-vazio">Nenhuma compra encontrada</td></tr>';
    return;
  }

  tbody.innerHTML = compras.map(c => {
    const acoes = c.status === 'pendente' ? `
      <div class="acoes">
        <button class="btn-confirmar-pag" onclick="abrirModalPag('${c.id}')">✅ Confirmar</button>
        <button class="btn-cancelar-pag" onclick="cancelarCompra('${c.id}')">✕ Cancelar</button>
      </div>
    ` : '—';

    return `
      <tr>
        <td style="white-space:nowrap">${formatarData(c.created_at)}</td>
        <td>
          <strong>${escapeHtml(c.nome_comprador)}</strong><br>
          <small style="color:var(--texto-muted)">${escapeHtml(c.endereco || '').substring(0, 40)}${c.endereco && c.endereco.length > 40 ? '…' : ''}</small>
        </td>
        <td>${escapeHtml(c.telefone || '—')}</td>
        <td style="font-size:0.82rem">${c.numeros.join(', ')}</td>
        <td style="white-space:nowrap">R$ ${c.total_valor.toFixed(2).replace('.', ',')}</td>
        <td><span class="badge-status ${c.status}">${traduzirStatus(c.status)}</span></td>
        <td>${acoes}</td>
      </tr>
    `;
  }).join('');
}

// ── Sorteio ───────────────────────────────────────────────────────────────────
function confirmarSorteio() {
  if (sorteioRealizado) return;
  document.getElementById('modal-sorteio').classList.add('show');
}

function fecharModalSorteio() {
  document.getElementById('modal-sorteio').classList.remove('show');
}

async function executarSorteio() {
  fecharModalSorteio();
  const btn = document.getElementById('btn-sorteio');
  btn.disabled = true;
  btn.textContent = 'Sorteando...';

  try {
    const res = await fetch('/admin/executar-sorteio', { method: 'POST' });
    const data = await res.json();

    if (res.ok && data.sucesso) {
      mostrarToast('🎉 Sorteio realizado com sucesso!', 'sucesso');
      setTimeout(carregarDashboard, 500);
    } else {
      mostrarToast(data.erro || 'Erro ao executar sorteio', 'erro');
      btn.disabled = false;
      btn.textContent = '🎲 Executar Sorteio Agora';
    }
  } catch {
    mostrarToast('Erro de conexão', 'erro');
    btn.disabled = false;
    btn.textContent = '🎲 Executar Sorteio Agora';
  }
}

// ── Pagamentos ────────────────────────────────────────────────────────────────
function abrirModalPag(compraId) {
  document.getElementById('modal-compra-id').value = compraId;
  document.getElementById('modal-obs').value = '';
  document.getElementById('modal-confirmar-pag').classList.add('show');
}

function fecharModalPag() {
  document.getElementById('modal-confirmar-pag').classList.remove('show');
}

async function confirmarPagamento() {
  const compra_id = document.getElementById('modal-compra-id').value;
  const observacao = document.getElementById('modal-obs').value.trim();
  fecharModalPag();

  try {
    const res = await fetch('/admin/confirmar-pagamento', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ compra_id, observacao })
    });
    const data = await res.json();

    if (res.ok) {
      mostrarToast(`✅ Pagamento confirmado! Números: ${data.numeros_confirmados.join(', ')}`, 'sucesso');
      carregarCompras();
      carregarDashboard();
    } else {
      mostrarToast(data.erro || 'Erro ao confirmar', 'erro');
    }
  } catch {
    mostrarToast('Erro de conexão', 'erro');
  }
}

async function cancelarCompra(compra_id) {
  if (!confirm('Cancelar esta compra e liberar os números?')) return;

  try {
    const res = await fetch('/admin/cancelar-compra', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ compra_id })
    });
    const data = await res.json();

    if (res.ok) {
      mostrarToast('Compra cancelada e números liberados', 'sucesso');
      carregarCompras();
      carregarDashboard();
    } else {
      mostrarToast(data.erro || 'Erro ao cancelar', 'erro');
    }
  } catch {
    mostrarToast('Erro de conexão', 'erro');
  }
}

// ── Utils ─────────────────────────────────────────────────────────────────────
function mostrarToast(msg, tipo = 'sucesso') {
  const toast = document.getElementById('toast');
  toast.textContent = msg;
  toast.className = `toast ${tipo} show`;
  setTimeout(() => { toast.classList.remove('show'); }, 4000);
}

function formatarData(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}

function traduzirStatus(s) {
  return { pendente: 'Pendente', confirmado: 'Confirmado', cancelado: 'Cancelado' }[s] || s;
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
