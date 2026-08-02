const $ = id => document.getElementById(id);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let adminPassword = sessionStorage.getItem('feedbackLedgerPassword') || '';
let loadedEvents = [];
let categories = [];
let currentCategory = '经验反馈';

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
function openModal(id) { $(id).classList.add('show'); $(id).setAttribute('aria-hidden', 'false'); }
function closeModals() { document.querySelectorAll('.modal').forEach(m => { m.classList.remove('show'); m.setAttribute('aria-hidden', 'true'); }); }
function sizeText(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
function fileIcon(file) {
  if (file.kind === 'image') return '图';
  if (file.kind === 'pdf') return 'PDF';
  if (file.kind === 'docx') return 'DOC';
  const ext = file.display_name.split('.').pop().toUpperCase();
  return ext.length <= 4 ? ext : 'FILE';
}
function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url; link.download = filename;
  document.body.appendChild(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1200);
}

// ── Events ────────────────────────────────────────────────────────────

async function loadEvents() {
  const keyword = $('keyword').value.trim();
  const params = new URLSearchParams();
  if (keyword) params.set('keyword', keyword);
  if (currentCategory) params.set('category', currentCategory);
  const data = await api('/api/feedback/events?' + params.toString());
  const events = data.items;
  loadedEvents = events;
  const totalFiles = events.reduce((sum, item) => sum + item.files.length, 0);
  $('eventCount').textContent = events.length;
  $('fileCount').textContent = totalFiles;
  $('resultText').textContent = keyword ? `找到 ${events.length} 条相关记录` : `共 ${events.length} 条记录，按日期由近到远排列`;
  $('eventList').innerHTML = events.length ? events.map(eventCard).join('') :
    `<div class="empty"><span>反</span><h3>${keyword ? '没有匹配的反馈记录' : '还没有反馈记录'}</h3><p>${adminPassword ? '点击右上角"新增事件"开始记录。' : '管理员新增记录后，内容会显示在这里。'}</p></div>`;
  bindInlineDropzones();
}

function eventCard(event) {
  const primaryCategory = categories.length ? categories[0].name : '经验反馈';
  const categoryBadge = event.category && event.category !== primaryCategory
    ? `<span class="category-badge">${esc(event.category)}</span>` : '';

  const files = event.files.length ? event.files.map(file => `
    <article class="file-card">
      ${file.kind === 'image' ? `<a class="thumb" href="${file.preview_url}" target="_blank"><img src="${file.preview_url}" alt="${esc(file.display_name)}" loading="lazy"></a>` : `<div class="file-type">${esc(fileIcon(file))}</div>`}
      <div class="file-info"><b title="${esc(file.display_name)}">${esc(file.display_name)}</b><span>${sizeText(file.size)} · ${file.kind === 'image' ? '图片' : file.kind === 'pdf' ? 'PDF' : file.kind === 'docx' ? 'Word文档' : '文件'}</span></div>
      <a class="download" href="${file.download_url}" title="下载">↓<span>下载</span></a>
      ${file.kind === 'docx' ? `<button class="preview-docx-btn" onclick="previewDocx(${file.id}, '${esc(file.display_name)}', event)" title="预览内容">阅</button>` : ''}
      ${adminPassword ? `<button class="delete-file-btn" onclick="deleteFile(${file.id}, event)" title="删除">×</button>` : ''}
    </article>`).join('') : `<div class="no-files">暂未上传文件</div>`;

  return `<section class="event-card">
    <div class="date-block"><strong>${esc(event.record_date.slice(8, 10))}</strong><span>${esc(event.record_date.slice(0, 7))}</span></div>
    <div class="event-main">
      <div class="event-heading">
        <div class="${adminPassword ? 'event-info-edit' : ''}" ${adminPassword ? `onclick="editEvent(${event.id})" title="点击修改事件"` : ''}>
          <h3>${esc(event.name)}${categoryBadge}</h3>
          ${event.content ? `<div class="feedback-content">${esc(event.content)}</div>` : ''}
        </div>
        <div class="event-actions">
          ${event.participant_count ? `<span>${event.participant_count} 人</span>` : ''}
          <span>${event.files.length} 个文件</span>
          ${adminPassword ? `<button class="delete-event" onclick="deleteEvent(${event.id}, event)">删除</button>` : ''}
        </div>
      </div>
      ${adminPassword ? `<label class="inline-dropzone" data-event-id="${event.id}">
        <input type="file" multiple accept="image/*,.pdf,.docx">
        <span>⇧</span><b>把 PDF、Word 文档或图片文件拖到这里直接上传</b><small>也可以点击选择</small>
      </label>` : ''}
      <div class="files-grid">${files}</div>
    </div>
  </section>`;
}

function bindInlineDropzones() {
  document.querySelectorAll('.inline-dropzone').forEach(zone => {
    const eventId = Number(zone.dataset.eventId);
    const input = zone.querySelector('input');
    input.addEventListener('change', () => { uploadInline(eventId, input.files, zone); input.value = ''; });
    ['dragenter','dragover'].forEach(name => zone.addEventListener(name, e => { e.preventDefault(); zone.classList.add('dragging'); }));
    ['dragleave','drop'].forEach(name => zone.addEventListener(name, e => { e.preventDefault(); zone.classList.remove('dragging'); }));
    zone.addEventListener('drop', e => uploadInline(eventId, Array.from(e.dataTransfer.files || []), zone));
  });
}

async function uploadInline(eventId, files, zone) {
  files = Array.from(files || []);
  if (!files.length || zone.classList.contains('uploading')) return;
  const body = new FormData();
  body.append('password', adminPassword);
  files.forEach(f => body.append('files', f));
  zone.classList.add('uploading');
  const label = zone.querySelector('b');
  const orig = label.textContent;
  label.textContent = `正在上传 ${files.length} 个文件…`;
  try {
    await api(`/api/feedback/events/${eventId}/files`, { method:'POST', body });
    await loadEvents();
    toast(`${files.length} 个文件已上传`);
  } catch (error) {
    zone.classList.remove('uploading');
    label.textContent = orig;
    toast(error.message);
  }
}

// ── Admin ─────────────────────────────────────────────────────────────

async function enterAdmin(password) {
  await api('/api/training/verify', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({password}) });
  adminPassword = password;
  sessionStorage.setItem('feedbackLedgerPassword', password);
  $('adminBtn').textContent = '已进入管理模式';
  $('newEventBtn').classList.remove('hidden');
  $('importBtn').classList.remove('hidden');
  $('exportBtn').classList.remove('hidden');
  renderCategoryTabs();
  bindCategoryTabClicks();
  closeModals();
  await loadEvents();
}

$('adminBtn').onclick = () => adminPassword ? toast('当前已是管理模式') : openModal('passwordModal');
$('passwordForm').onsubmit = async e => { e.preventDefault(); try { await enterAdmin($('passwordInput').value); } catch (error) { toast(error.message); } };

// ── CRUD ──────────────────────────────────────────────────────────────

$('newEventBtn').onclick = () => {
  $('eventEditId').value = '';
  $('eventFormTitle').textContent = '新增经验反馈';
  $('eventSubmitBtn').textContent = '创建事件';
  $('eventDate').value = new Date().toISOString().slice(0, 10);
  $('eventName').value = '';
  $('eventContent').value = '';
  $('eventParticipantCount').value = '';
  $('eventCategory').value = currentCategory;
  openModal('eventModal');
  $('eventName').focus();
};

function editEvent(id) {
  const event = loadedEvents.find(item => item.id === id);
  if (!event) return;
  $('eventEditId').value = event.id;
  $('eventFormTitle').textContent = '修改反馈信息';
  $('eventSubmitBtn').textContent = '保存修改';
  $('eventName').value = event.name || '';
  $('eventDate').value = event.record_date || '';
  $('eventContent').value = event.content || '';
  $('eventParticipantCount').value = event.participant_count || '';
  $('eventCategory').value = event.category || currentCategory;
  openModal('eventModal');
  $('eventName').focus();
}

async function deleteEvent(id, clickEvent) {
  clickEvent?.stopPropagation();
  const event = loadedEvents.find(item => item.id === id);
  if (!event) return;
  const fileNotice = event.files.length ? `，以及其中 ${event.files.length} 个已上传文件` : '';
  if (!confirm(`确定删除"${event.name}"${fileNotice}吗？此操作无法撤销。`)) return;
  try {
    await api(`/api/feedback/events/${id}`, { method:'DELETE', headers:{'Content-Type':'application/json'}, body:JSON.stringify({password:adminPassword}) });
    await loadEvents();
    toast('事件已删除');
  } catch (error) { toast(error.message); }
}

async function deleteFile(fileId, clickEvent) {
  clickEvent?.stopPropagation(); clickEvent?.preventDefault();
  if (!confirm('确定删除该文件吗？此操作无法撤销。')) return;
  try {
    await api(`/api/feedback/files/${fileId}`, { method:'DELETE', headers:{'Content-Type':'application/json'}, body:JSON.stringify({password:adminPassword}) });
    await loadEvents();
    toast('文件已删除');
  } catch (error) { toast(error.message); }
}

$('eventForm').onsubmit = async e => {
  e.preventDefault();
  try {
    const eventId = $('eventEditId').value;
    const payload = {
      password: adminPassword,
      name: $('eventName').value.trim(),
      record_date: $('eventDate').value,
      category: $('eventCategory').value,
      content: $('eventContent').value.trim(),
      participant_count: parseInt($('eventParticipantCount').value) || 0,
    };
    await api(eventId ? `/api/feedback/events/${eventId}` : '/api/feedback/events', {
      method: eventId ? 'PATCH' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    closeModals();
    $('eventForm').reset();
    await loadEvents();
    toast(eventId ? '反馈已更新' : '反馈已新增');
  } catch (error) { toast(error.message); }
};

// ── DOCX Preview ──────────────────────────────────────────────────────

async function previewDocx(fileId, name, clickEvent) {
  clickEvent?.stopPropagation(); clickEvent?.preventDefault();
  $('docxPreviewTitle').textContent = name;
  $('docxPreviewText').value = '正在加载…';
  openModal('docxPreviewModal');
  try {
    const data = await api(`/api/feedback/files/${fileId}/preview`);
    $('docxPreviewText').value = data.text || '(文档内容为空)';
  } catch (error) { $('docxPreviewText').value = `加载失败: ${error.message}`; }
}

$('copyDocxBtn').onclick = () => {
  const text = $('docxPreviewText').value;
  if (!text || text === '正在加载…') return;
  navigator.clipboard.writeText(text).then(() => toast('已复制全文')).catch(() => { $('docxPreviewText').select(); document.execCommand('copy'); toast('已复制全文'); });
};

// ── Stats ─────────────────────────────────────────────────────────────

async function loadStats() {
  const from = $('statsDateFrom').value; const to = $('statsDateTo').value;
  if (!from || !to) return;
  const params = new URLSearchParams({ start_date: from, end_date: to });
  if (currentCategory) params.set('category', currentCategory);
  try {
    const data = await api('/api/feedback/stats?' + params.toString());
    $('statsRecords').textContent = data.records;
    $('statsParticipants').textContent = data.participants || 0;
    $('statsFiles').textContent = data.files;
  } catch (e) { $('statsRecords').textContent = '—'; $('statsParticipants').textContent = '—'; $('statsFiles').textContent = '—'; }
}

function setStatsDefaults() {
  const now = new Date();
  $('statsDateTo').value = now.toISOString().slice(0, 10);
  $('statsDateFrom').value = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
}

// ── Import ──────────────────────────────────────────────────────────────

let importFiles = [];

$('importBtn').onclick = () => {
  importFiles = [];
  renderImportQueue();
  $('importResult').style.display = 'none';
  $('importFileInput').value = '';
  openModal('importModal');
};

$('importFileInput').onchange = e => { addImportFiles(e.target.files); };
['dragenter', 'dragover'].forEach(name => $('importDropzone').addEventListener(name, e => {
  e.preventDefault();
  $('importDropzone').classList.add('dragging');
}));
['dragleave', 'drop'].forEach(name => $('importDropzone').addEventListener(name, e => {
  e.preventDefault();
  $('importDropzone').classList.remove('dragging');
}));
$('importDropzone').addEventListener('drop', e => { addImportFiles(e.dataTransfer.files); });

function addImportFiles(files) {
  const xlsx = Array.from(files || []).filter(f => f.name.toLowerCase().endsWith('.xlsx') || f.name.toLowerCase().endsWith('.xls'));
  importFiles.push(...xlsx);
  renderImportQueue();
}

function renderImportQueue() {
  $('importQueue').innerHTML = importFiles.length
    ? importFiles.map((f, i) => `<div><span>xlsx</span><b>${esc(f.name)}</b><small>${sizeText(f.size)}</small><button onclick="removeImportFile(${i})">×</button></div>`).join('')
    : '';
  $('importStartBtn').disabled = !importFiles.length;
}

function removeImportFile(index) { importFiles.splice(index, 1); renderImportQueue(); }

$('importStartBtn').onclick = async () => {
  if (!importFiles.length) return;
  const resultDiv = $('importResult');
  resultDiv.style.display = 'block';
  resultDiv.innerHTML = '正在导入…';
  $('importStartBtn').disabled = true;
  const body = new FormData();
  body.append('password', adminPassword);
  importFiles.forEach(f => body.append('files', f));
  try {
    const response = await fetch('/api/feedback/import', { method: 'POST', body });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || '导入失败');
    let lines = [];
    if (data.items && data.items.length) {
      lines = data.items.map(item => `<div>+ ${esc(item.name)} · ${item.participant_count} 人</div>`);
    }
    if (data.skipped) lines.push(`<div style="color:var(--muted)">跳过 ${data.skipped} 条已存在</div>`);
    resultDiv.innerHTML = lines.join('') || `导入完成：新增 ${data.imported} 条`;
    toast(`导入 ${data.imported} 条，跳过 ${data.skipped} 条`);
    importFiles = [];
    renderImportQueue();
    await loadEvents();
    loadStats().catch(() => {});
  } catch (error) {
    resultDiv.innerHTML = `<b style="color:#b33b32">${esc(error.message)}</b>`;
    toast(error.message);
  } finally {
    $('importStartBtn').disabled = false;
  }
};

// ── Export ──────────────────────────────────────────────────────────────

function openFeedbackExport() {
  if (!loadedEvents.length) { toast('当前没有可导出的记录'); return; }
  $('exportEventList').innerHTML = loadedEvents.map(event => `
    <label class="export-event">
      <input type="checkbox" value="${event.id}">
      <time>${esc(event.record_date)}</time>
      <b>${esc(event.name)}</b>
      <small>${event.participant_count || 0} 人</small>
    </label>`).join('');
  $('exportEventList').querySelectorAll('input').forEach(input => input.onchange = updateFeedbackExportSelection);
  updateFeedbackExportSelection();
  openModal('exportModal');
}

function selectedFeedbackExportEvents() {
  const ids = new Set(Array.from($('exportEventList').querySelectorAll('input:checked')).map(i => Number(i.value)));
  return loadedEvents.filter(e => ids.has(e.id)).sort((a, b) => a.record_date.localeCompare(b.record_date) || a.id - b.id);
}

function updateFeedbackExportSelection() {
  const selected = selectedFeedbackExportEvents();
  $('exportSelectedCount').textContent = `已选择 ${selected.length} 项`;
  $('exportConfirmBtn').disabled = !selected.length;
  const inputs = Array.from($('exportEventList').querySelectorAll('input'));
  $('selectAllExportBtn').textContent = inputs.length && inputs.every(i => i.checked) ? '取消全选' : '全选';
}

async function exportFeedbackLedger() {
  const events = selectedFeedbackExportEvents();
  if (!events.length) return;
  $('exportConfirmBtn').disabled = true;
  $('exportConfirmBtn').textContent = '正在生成…';
  try {
    const response = await fetch('/api/feedback/export', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: events.map(e => e.id) }),
    });
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || '生成失败');
    }
    downloadBlob(await response.blob(), `经验反馈台账_${new Date().toISOString().slice(0, 10)}.xlsx`);
    closeModals();
    toast(`已导出 ${events.length} 条记录`);
  } catch (error) {
    toast(error.message);
  } finally {
    $('exportConfirmBtn').disabled = false;
    $('exportConfirmBtn').textContent = '生成 Excel 台账';
  }
}

$('exportBtn').onclick = openFeedbackExport;
$('selectAllExportBtn').onclick = () => {
  const inputs = Array.from($('exportEventList').querySelectorAll('input'));
  const shouldSelect = !inputs.every(i => i.checked);
  inputs.forEach(i => { i.checked = shouldSelect; });
  updateFeedbackExportSelection();
};
$('exportConfirmBtn').onclick = exportFeedbackLedger;

// ── Categories ────────────────────────────────────────────────────────

function setCategory(category) {
  currentCategory = category;
  document.querySelectorAll('.cat-tab').forEach(tab => tab.classList.toggle('active', tab.dataset.category === category));
  $('eventCategory').value = category;
  const primary = categories.length ? categories[0].name : '经验反馈';
  $('introTitle').textContent = category !== primary ? `${category}` : '经验反馈，持续改进';
  const url = new URL(location);
  url.searchParams.set('category', category);
  history.replaceState(null, '', url);
  document.title = '经验反馈共享中心';
  loadStats().catch(() => {});
}

function bindCategoryTabClicks() {
  document.querySelectorAll('.cat-tab').forEach(tab => {
    tab.addEventListener('click', e => {
      e.preventDefault();
      setCategory(tab.dataset.category);
      loadEvents().catch(error => toast(error.message));
    });
  });
}

async function loadCategories() { const data = await api('/api/feedback/categories'); categories = data.items; renderCategoryTabs(); populateDropdowns(); bindCategoryTabClicks(); }

function renderCategoryTabs() {
  const primary = categories.length ? categories[0].name : '经验反馈';
  if (!categories.find(c => c.name === currentCategory)) currentCategory = primary;
  $('categoryTabs').innerHTML = categories.map(cat => {
    const active = cat.name === currentCategory ? ' active' : '';
    return `<a class="cat-tab${active}" data-category="${esc(cat.name)}" href="?category=${encodeURIComponent(cat.name)}">${esc(cat.name)}</a>`;
  }).join('') + (adminPassword ? `<button class="manage-categories-btn" id="manageCategoriesBtn" title="管理分类">⚙</button>` : '');
  if (adminPassword) $('manageCategoriesBtn').onclick = openCategoryManager;
}

function populateDropdowns() {
  $('eventCategory').innerHTML = categories.map(c => `<option value="${esc(c.name)}">${esc(c.name)}</option>`).join('');
  $('eventCategory').value = currentCategory;
}

function openCategoryManager() { renderCategoryList(); openModal('categoryModal'); }

function renderCategoryList() {
  $('categoryList').innerHTML = categories.map((cat, i) => `
    <div class="category-row" draggable="true" data-id="${cat.id}">
      <span class="drag-handle" title="拖拽排序">⠿</span>
      <input class="category-name-input" value="${esc(cat.name)}" data-id="${cat.id}" placeholder="模块名称">
      <button class="save-cat-btn" data-id="${cat.id}" data-idx="${i}" title="保存名称">✓</button>
      <button class="delete-cat-btn" data-id="${cat.id}" title="删除模块">×</button>
    </div>`).join('');

  document.querySelectorAll('.save-cat-btn').forEach(btn => {
    btn.onclick = async () => {
      const id = Number(btn.dataset.id); const idx = Number(btn.dataset.idx);
      const input = document.querySelector(`.category-name-input[data-id="${id}"]`);
      const newName = input.value.trim();
      if (!newName) { toast('模块名称不能为空'); return; }
      if (newName === categories[idx].name) { toast('名称未变更'); return; }
      try {
        await api(`/api/feedback/categories/${id}`, { method:'PATCH', headers:{'Content-Type':'application/json'}, body:JSON.stringify({password:adminPassword, name:newName}) });
        categories[idx].name = newName;
        renderCategoryTabs(); populateDropdowns(); bindCategoryTabClicks(); renderCategoryList();
        toast('模块已重命名');
      } catch (error) { toast(error.message); }
    };
  });

  document.querySelectorAll('.delete-cat-btn').forEach(btn => {
    btn.onclick = async () => {
      const id = Number(btn.dataset.id); const cat = categories.find(c => c.id === id);
      if (!cat) return;
      if (!confirm(`确定删除"${cat.name}"模块吗？该模块下的事件将归入默认模块。`)) return;
      try {
        await api(`/api/feedback/categories/${id}`, { method:'DELETE', headers:{'Content-Type':'application/json'}, body:JSON.stringify({password:adminPassword}) });
        categories = categories.filter(c => c.id !== id);
        if (currentCategory === cat.name) currentCategory = categories.length ? categories[0].name : '经验反馈';
        await loadEvents();
        renderCategoryTabs(); populateDropdowns(); bindCategoryTabClicks(); renderCategoryList();
        toast('模块已删除');
      } catch (error) { toast(error.message); }
    };
  });

  document.querySelectorAll('.category-row').forEach(row => {
    row.addEventListener('dragstart', e => { e.dataTransfer.effectAllowed = 'move'; row.classList.add('dragging-row'); });
    row.addEventListener('dragend', () => { row.classList.remove('dragging-row'); document.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over')); });
    row.addEventListener('dragover', e => { e.preventDefault(); const d = document.querySelector('.dragging-row'); if (d && d !== row) row.classList.add('drag-over'); });
    row.addEventListener('dragleave', () => row.classList.remove('drag-over'));
    row.addEventListener('drop', async e => {
      e.preventDefault(); row.classList.remove('drag-over');
      const dragging = document.querySelector('.dragging-row');
      if (!dragging || dragging === row) return;
      const rows = Array.from($('categoryList').querySelectorAll('.category-row'));
      const from = rows.indexOf(dragging); const to = rows.indexOf(row);
      if (from < 0 || to < 0) return;
      const moved = categories.splice(from, 1)[0];
      categories.splice(to, 0, moved);
      renderCategoryList();
      try {
        await api('/api/feedback/categories/reorder', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({password:adminPassword, ids:categories.map(c => c.id)}) });
        renderCategoryTabs(); populateDropdowns(); bindCategoryTabClicks();
        toast('排序已保存');
      } catch (error) { toast(error.message); }
    });
  });
}

$('addCategoryBtn').onclick = async () => {
  const name = $('newCategoryName').value.trim();
  if (!name) { toast('请输入模块名称'); return; }
  try {
    const result = await api('/api/feedback/categories', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({password:adminPassword, name}) });
    categories.push({ id: result.id, name: result.name, sort_order: result.sort_order });
    $('newCategoryName').value = '';
    renderCategoryTabs(); populateDropdowns(); bindCategoryTabClicks(); renderCategoryList();
    toast(`模块"${name}"已添加`);
  } catch (error) { toast(error.message); }
};

// ── Listeners & Init ──────────────────────────────────────────────────

$('refreshBtn').onclick = loadEvents;
$('keyword').addEventListener('input', (() => { let t; return () => { clearTimeout(t); t = setTimeout(loadEvents, 250); }; })());
$('statsMonthBtn').onclick = () => { setStatsDefaults(); loadStats().catch(() => {}); };
$('statsRefreshBtn').onclick = () => loadStats().catch(() => {});
$('statsDateFrom').addEventListener('change', () => loadStats().catch(() => {}));
$('statsDateTo').addEventListener('change', () => loadStats().catch(() => {}));
document.querySelectorAll('[data-close]').forEach(b => b.onclick = closeModals);
document.querySelectorAll('.modal').forEach(m => m.addEventListener('click', e => { if (e.target === m) closeModals(); }));

async function initialize() {
  await loadCategories();
  setCategory(currentCategory);
  setStatsDefaults();
  if (adminPassword) {
    enterAdmin(adminPassword).catch(() => { adminPassword = ''; sessionStorage.removeItem('feedbackLedgerPassword'); loadEvents(); });
  } else {
    loadEvents().catch(error => toast(error.message));
  }
  loadStats().catch(() => {});
}
initialize();