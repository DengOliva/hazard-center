const $ = id => document.getElementById(id);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let adminPassword = sessionStorage.getItem('trainingLedgerPassword') || '';
let activeEventId = null;
let queuedFiles = [];
let loadedEvents = [];

function toast(message) {
  $('toast').textContent = message;
  $('toast').classList.add('show');
  setTimeout(() => $('toast').classList.remove('show'), 2600);
}
async function api(url, options) {
  const response = await fetch(url, options);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || '请求失败');
  return data;
}
function openModal(id) {
  $(id).classList.add('show');
  $(id).setAttribute('aria-hidden', 'false');
}
function closeModals() {
  document.querySelectorAll('.modal').forEach(m => {
    m.classList.remove('show');
    m.setAttribute('aria-hidden', 'true');
  });
}
function sizeText(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
function fileIcon(file) {
  if (file.kind === 'image') return '图';
  const ext = file.display_name.split('.').pop().toUpperCase();
  return ext.length <= 4 ? ext : 'FILE';
}

async function loadEvents() {
  const keyword = $('keyword').value.trim();
  const data = await api('/api/training-ledger/events?keyword=' + encodeURIComponent(keyword));
  const events = data.items;
  loadedEvents = events;
  const totalFiles = events.reduce((sum, item) => sum + item.files.length, 0);
  $('eventCount').textContent = events.length;
  $('fileCount').textContent = totalFiles;
  $('resultText').textContent = keyword ? `找到 ${events.length} 场相关培训` : `共 ${events.length} 场培训，按日期由近到远排列`;
  $('eventList').innerHTML = events.length ? events.map(eventCard).join('') :
    `<div class="empty"><span>档</span><h3>${keyword ? '没有匹配的培训记录' : '还没有培训台账'}</h3><p>${adminPassword ? '点击右上角“新增培训”开始归档。' : '管理员新增培训后，记录会显示在这里。'}</p></div>`;
}

function eventCard(event) {
  const files = event.files.length ? event.files.map(file => `
    <article class="file-card">
      ${file.kind === 'image' ? `<a class="thumb" href="${file.preview_url}" target="_blank"><img src="${file.preview_url}" alt="${esc(file.display_name)}" loading="lazy"></a>` : `<div class="file-type">${esc(fileIcon(file))}</div>`}
      <div class="file-info"><b title="${esc(file.display_name)}">${esc(file.display_name)}</b><span>${sizeText(file.size)} · ${file.kind === 'image' ? '培训照片' : '培训文件'}</span></div>
      <a class="download" href="${file.download_url}" title="下载 ${esc(file.display_name)}">↓<span>下载</span></a>
    </article>`).join('') : `<div class="no-files">暂未上传资料</div>`;
  return `<section class="event-card">
    <div class="date-block"><strong>${esc(event.training_date.slice(8, 10))}</strong><span>${esc(event.training_date.slice(0, 7))}</span></div>
    <div class="event-main">
      <div class="event-heading">
        <div><h3>${esc(event.name)}</h3>${event.description ? `<p>${esc(event.description)}</p>` : ''}</div>
        <div class="event-actions"><span>${event.files.length} 个文件</span>${adminPassword ? `<button onclick="openUpload(${event.id})">＋ 上传资料</button>` : ''}</div>
      </div>
      <div class="files-grid">${files}</div>
    </div>
  </section>`;
}

async function enterAdmin(password) {
  await api('/api/training/verify', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({password})});
  adminPassword = password;
  sessionStorage.setItem('trainingLedgerPassword', password);
  $('adminBtn').textContent = '已进入管理模式';
  $('newEventBtn').classList.remove('hidden');
  closeModals();
  await loadEvents();
}

function openUpload(id, name) {
  activeEventId = id;
  queuedFiles = [];
  name = name || loadedEvents.find(item => item.id === id)?.name || '培训资料';
  $('uploadTitle').textContent = `上传资料 · ${name}`;
  $('fileInput').value = '';
  renderQueue();
  openModal('uploadModal');
}
function addFiles(files) {
  queuedFiles.push(...Array.from(files));
  renderQueue();
}
function renderQueue() {
  $('fileQueue').innerHTML = queuedFiles.map((file, index) => `<div><span>${file.type.startsWith('image/') ? '图' : '文'}</span><b>${esc(file.name)}</b><small>${sizeText(file.size)}</small><button onclick="removeQueued(${index})">×</button></div>`).join('');
  $('uploadBtn').disabled = !queuedFiles.length;
}
function removeQueued(index) {
  queuedFiles.splice(index, 1);
  renderQueue();
}

$('adminBtn').onclick = () => adminPassword ? toast('当前已是管理模式') : openModal('passwordModal');
$('newEventBtn').onclick = () => {
  $('eventDate').value = new Date().toISOString().slice(0, 10);
  openModal('eventModal');
  $('eventName').focus();
};
$('refreshBtn').onclick = loadEvents;
$('keyword').addEventListener('input', (() => {
  let timer;
  return () => { clearTimeout(timer); timer = setTimeout(loadEvents, 250); };
})());
document.querySelectorAll('[data-close]').forEach(btn => btn.onclick = closeModals);
document.querySelectorAll('.modal').forEach(modal => modal.addEventListener('click', e => { if (e.target === modal) closeModals(); }));

$('passwordForm').onsubmit = async e => {
  e.preventDefault();
  try { await enterAdmin($('passwordInput').value); } catch (error) { toast(error.message); }
};
$('eventForm').onsubmit = async e => {
  e.preventDefault();
  try {
    const result = await api('/api/training-ledger/events', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body:JSON.stringify({password:adminPassword, name:$('eventName').value.trim(), training_date:$('eventDate').value, description:$('eventDescription').value.trim()})
    });
    closeModals();
    $('eventForm').reset();
    await loadEvents();
    openUpload(result.id, '新建培训');
  } catch (error) { toast(error.message); }
};
$('fileInput').onchange = e => addFiles(e.target.files);
['dragenter','dragover'].forEach(name => $('dropzone').addEventListener(name, e => { e.preventDefault(); $('dropzone').classList.add('dragging'); }));
['dragleave','drop'].forEach(name => $('dropzone').addEventListener(name, e => { e.preventDefault(); $('dropzone').classList.remove('dragging'); }));
$('dropzone').addEventListener('drop', e => addFiles(e.dataTransfer.files));
$('uploadBtn').onclick = async () => {
  if (!queuedFiles.length) return;
  const body = new FormData();
  body.append('password', adminPassword);
  queuedFiles.forEach(file => body.append('files', file));
  $('uploadBtn').disabled = true;
  $('uploadBtn').textContent = '正在上传…';
  try {
    await api(`/api/training-ledger/events/${activeEventId}/files`, {method:'POST', body});
    closeModals();
    await loadEvents();
    toast('资料已上传并自动重命名');
  } catch (error) {
    toast(error.message);
  } finally {
    $('uploadBtn').textContent = '开始上传';
    $('uploadBtn').disabled = !queuedFiles.length;
  }
};

if (adminPassword) enterAdmin(adminPassword).catch(() => {
  adminPassword = '';
  sessionStorage.removeItem('trainingLedgerPassword');
  loadEvents();
});
else loadEvents().catch(error => toast(error.message));
