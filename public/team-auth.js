const $ = id => document.getElementById(id);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let adminPassword = sessionStorage.getItem('brakeLedgerPassword') || '';

function toast(message) {
  $('toast').textContent = message;
  $('toast').classList.add('show');
  setTimeout(() => $('toast').classList.remove('show'), 2800);
}

async function api(url, options) {
  const response = await fetch(url, options);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || '请求失败');
  return data;
}

// ── File handling ─────────────────────────────────────────────────────

function setFile(file) {
  if (!file || !file.name.toLowerCase().endsWith('.xlsx')) {
    toast('请选择 .xlsx 文件');
    return false;
  }
  const transfer = new DataTransfer();
  transfer.items.add(file);
  $('authFile').files = transfer.files;
  $('fileText').textContent = file.name;
  $('fileText').classList.add('ready');
  $('fileBox').querySelector('em').textContent = '已选择';
  return true;
}

$('authFile').onchange = () => setFile($('authFile').files[0]);

['dragenter', 'dragover'].forEach(name => $('fileBox').addEventListener(name, e => {
  e.preventDefault();
  $('fileBox').style.borderColor = 'var(--teal)';
}));
['dragleave', 'drop'].forEach(name => $('fileBox').addEventListener(name, e => {
  e.preventDefault();
  $('fileBox').style.borderColor = '';
}));
$('fileBox').addEventListener('drop', e => {
  if (setFile(e.dataTransfer.files[0])) doImport();
});

// ── Import ────────────────────────────────────────────────────────────

$('importBtn').onclick = () => {
  if (!$('authFile').files.length) {
    toast('请先选择授权列表文件');
    return;
  }
  doImport();
};

async function doImport() {
  // Ensure admin password
  if (!adminPassword) {
    let pw = prompt('请输入管理密码');
    if (!pw) return;
    try {
      await api('/api/training/verify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: pw }) });
      adminPassword = pw;
      sessionStorage.setItem('brakeLedgerPassword', pw);
    } catch (e) {
      toast('密码错误');
      return;
    }
  }
  $('importBtn').disabled = true;
  $('importBtn').textContent = '正在统计…';
  try {
    const body = new FormData();
    body.append('password', adminPassword);
    body.append('file', $('authFile').files[0]);
    const response = await fetch('/api/team-auth/import', { method: 'POST', body });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || '导入失败');
    renderMatrix(data);
    toast(`已统计：${data.auth_filename} · ${data.matrix.length} 个班组`);
  } catch (error) {
    toast(error.message);
  } finally {
    $('importBtn').textContent = '导入统计';
    $('importBtn').disabled = false;
  }
}

// ── Render ────────────────────────────────────────────────────────────

function renderMatrix(data) {
  $('emptyState').style.display = 'none';
  $('results').style.display = 'block';
  $('sourceInfo').textContent = `${data.auth_filename} · 更新于 ${(data.imported_at || '').replace('T', ' ')} · ${data.matrix.length} 个班组 · ${data.auth_columns.length} 项授权`;

  // Header
  $('teamHeader').innerHTML = `班组（${data.matrix.length}）`;
  const theadRow = $('teamHeader').parentElement;
  // Remove existing auth columns (keep first th)
  while (theadRow.children.length > 1) theadRow.removeChild(theadRow.lastChild);
  data.auth_columns.forEach(auth => {
    const th = document.createElement('th');
    th.textContent = auth;
    th.title = `${auth}（总计 ${data.auth_totals[auth] || 0} 人）`;
    theadRow.appendChild(th);
  });

  // Body
  $('tableBody').innerHTML = data.matrix.map(row => {
    const cells = row.cells.map(c => {
      const cls = c.count > 0 ? (c.over ? 'red' : 'green') : '';
      return `<td class="${cls}">${c.count || ''}</td>`;
    }).join('');
    return `<tr><td title="${esc(row.team)}">${esc(row.team)}</td>${cells}</tr>`;
  }).join('');
}

// ── Init ──────────────────────────────────────────────────────────────

async function loadSaved() {
  try {
    const response = await fetch('/api/team-auth/current');
    if (response.status === 404) return;
    const data = await response.json();
    if (!response.ok) return;
    renderMatrix(data);
    $('fileText').textContent = data.auth_filename;
    $('fileText').classList.add('ready');
  } catch (e) { /* saved data not available */ }
}

// ── Export over-threshold ─────────────────────────────────────────────

$('exportOverBtn').onclick = () => {
  const link = document.createElement('a');
  link.href = '/api/team-auth/export-over';
  link.download = '';
  document.body.appendChild(link);
  link.click();
  link.remove();
  toast('正在生成超标台账…');
};

loadSaved();
