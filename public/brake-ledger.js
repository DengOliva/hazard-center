const $ = id => document.getElementById(id);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let adminPassword = sessionStorage.getItem('brakeLedgerPassword') || '';
let loadedEvents = [];
let categories = [];
let currentCategory = '工程公司整改单';

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
  const data = await api('/api/brake-ledger/events?' + params.toString());
  const events = data.items;
  loadedEvents = events;
  const totalFiles = events.reduce((sum, item) => sum + item.files.length, 0);
  $('eventCount').textContent = events.length;
  $('fileCount').textContent = totalFiles;
  $('resultText').textContent = keyword ? `找到 ${events.length} 条相关记录` : `共 ${events.length} 条记录，按日期由近到远排列`;
  $('eventList').innerHTML = events.length ? events.map(eventCard).join('') :
    `<div class="empty"><span>刹</span><h3>${keyword ? '没有匹配的预警记录' : '还没有预警记录'}</h3><p>${adminPassword ? '点击右上角"新增记录"开始归档。' : '管理员新增记录后，文件会显示在这里。'}</p></div>`;
  bindInlineDropzones();
}

function eventCard(event) {
  const primaryCategory = categories.length ? categories[0].name : '工程公司整改单';
  const categoryBadge = event.category && event.category !== primaryCategory
    ? `<span class="category-badge">${esc(event.category)}</span>` : '';
  const metaParts = [];
  if (event.responsible_dept) metaParts.push(`<span>责任部门<b>${esc(event.responsible_dept)}</b></span>`);
  if (event.responsible_person) metaParts.push(`<span>责任人<b>${esc(event.responsible_person)}</b></span>`);
  if (event.area) metaParts.push(`<span>区域<b>${esc(event.area)}</b></span>`);
  if (event.status) metaParts.push(`<span>状态<b>${esc(event.status)}</b></span>`);
  const meta = metaParts.join('');

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
        <div class="${adminPassword ? 'event-info-edit' : ''}" ${adminPassword ? `onclick="editEvent(${event.id})" title="点击修改记录"` : ''}>
          <h3>${esc(event.name)}${categoryBadge}</h3>
          ${event.description ? `<p>${esc(event.description)}</p>` : ''}
          ${meta ? `<div class="brake-meta">${meta}</div>` : ''}
          ${event.issue_dept ? `<div class="brake-meta"><span>签发<b>${esc(event.issue_dept)}</b></span></div>` : ''}
        </div>
        <div class="event-actions">
          <span>${event.files.length} 个文件</span>
          ${adminPassword ? `<button class="delete-event" onclick="deleteEvent(${event.id}, event)">删除</button>` : ''}
        </div>
      </div>
      ${adminPassword ? `<label class="inline-dropzone" data-event-id="${event.id}">
        <input type="file" multiple accept="image/*,.pdf,.docx,application/pdf">
        <span>⇧</span><b>把 PDF、Word 文档或图片拖到这里直接上传</b><small>也可以点击选择文件</small>
      </label>` : ''}
      <div class="files-grid">${files}</div>
    </div>
  </section>`;
}

function bindInlineDropzones() {
  document.querySelectorAll('.inline-dropzone').forEach(zone => {
    const eventId = Number(zone.dataset.eventId);
    const input = zone.querySelector('input');
    input.addEventListener('change', () => {
      uploadInline(eventId, input.files, zone);
      input.value = '';
    });
    ['dragenter', 'dragover'].forEach(name => zone.addEventListener(name, e => {
      e.preventDefault();
      zone.classList.add('dragging');
    }));
    ['dragleave', 'drop'].forEach(name => zone.addEventListener(name, e => {
      e.preventDefault();
      zone.classList.remove('dragging');
    }));
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
    await api(`/api/brake-ledger/events/${eventId}/files`, { method: 'POST', body });
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
  await api('/api/training/verify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password }) });
  adminPassword = password;
  sessionStorage.setItem('brakeLedgerPassword', password);
  $('adminBtn').textContent = '已进入管理模式';
  $('newEventBtn').classList.remove('hidden');
  $('importBtn').classList.remove('hidden');
  $('clearLedgerTopBtn').classList.remove('hidden');
  renderCategoryTabs();
  bindCategoryTabClicks();
  closeModals();
  await loadEvents();
}

$('adminBtn').onclick = () => adminPassword ? toast('当前已是管理模式') : openModal('passwordModal');
$('passwordForm').onsubmit = async e => {
  e.preventDefault();
  try { await enterAdmin($('passwordInput').value); } catch (error) { toast(error.message); }
};

// ── CRUD ──────────────────────────────────────────────────────────────

$('newEventBtn').onclick = () => {
  $('eventEditId').value = '';
  $('eventFormTitle').textContent = '新增预警记录';
  $('eventSubmitBtn').textContent = '创建记录';
  $('eventDate').value = new Date().toISOString().slice(0, 10);
  $('eventName').value = '';
  $('eventDescription').value = '';
  $('eventIssueDept').value = '';
  $('eventResponsibleDept').value = '';
  $('eventResponsiblePerson').value = '';
  $('eventArea').value = '';
  $('eventSubcontractor').value = '';
  $('eventTeam').value = '';
  $('eventStatus').value = '';
  $('eventCategory').value = currentCategory;
  $('moreFields').classList.remove('open');
  $('moreToggle').textContent = '▸ 更多信息';
  openModal('eventModal');
  $('eventName').focus();
};

function editEvent(id) {
  const event = loadedEvents.find(item => item.id === id);
  if (!event) return;
  $('eventEditId').value = event.id;
  $('eventFormTitle').textContent = '修改记录信息';
  $('eventSubmitBtn').textContent = '保存修改';
  $('eventName').value = event.name || '';
  $('eventDate').value = event.record_date || '';
  $('eventDescription').value = event.description || '';
  $('eventIssueDept').value = event.issue_dept || '';
  $('eventResponsibleDept').value = event.responsible_dept || '';
  $('eventResponsiblePerson').value = event.responsible_person || '';
  $('eventArea').value = event.area || '';
  $('eventSubcontractor').value = event.subcontractor || '';
  $('eventTeam').value = event.team || '';
  $('eventStatus').value = event.status || '';
  $('eventCategory').value = event.category || currentCategory;
  const hasMore = event.issue_dept || event.responsible_dept || event.responsible_person || event.area || event.subcontractor || event.team || event.status;
  if (hasMore) { $('moreFields').classList.add('open'); $('moreToggle').textContent = '▾ 更多信息'; }
  else { $('moreFields').classList.remove('open'); $('moreToggle').textContent = '▸ 更多信息'; }
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
    await api(`/api/brake-ledger/events/${id}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: adminPassword }),
    });
    await loadEvents();
    toast('记录已删除');
  } catch (error) { toast(error.message); }
}

async function deleteFile(fileId, clickEvent) {
  clickEvent?.stopPropagation();
  clickEvent?.preventDefault();
  if (!confirm('确定删除该文件吗？此操作无法撤销。')) return;
  try {
    await api(`/api/brake-ledger/files/${fileId}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: adminPassword }),
    });
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
      description: $('eventDescription').value.trim(),
      issue_dept: $('eventIssueDept').value.trim(),
      responsible_dept: $('eventResponsibleDept').value.trim(),
      responsible_person: $('eventResponsiblePerson').value.trim(),
      area: $('eventArea').value.trim(),
      subcontractor: $('eventSubcontractor').value.trim(),
      team: $('eventTeam').value.trim(),
      status: $('eventStatus').value,
    };
    await api(eventId ? `/api/brake-ledger/events/${eventId}` : '/api/brake-ledger/events', {
      method: eventId ? 'PATCH' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    closeModals();
    $('eventForm').reset();
    await loadEvents();
    toast(eventId ? '记录已更新' : '记录已新增');
  } catch (error) { toast(error.message); }
};

$('moreToggle').onclick = () => {
  const fields = $('moreFields');
  const isOpen = fields.classList.toggle('open');
  $('moreToggle').textContent = isOpen ? '▾ 更多信息' : '▸ 更多信息';
};

// ── DOCX Preview ──────────────────────────────────────────────────────

async function previewDocx(fileId, name, clickEvent) {
  clickEvent?.stopPropagation();
  clickEvent?.preventDefault();
  $('docxPreviewTitle').textContent = name;
  $('docxPreviewText').value = '正在加载…';
  openModal('docxPreviewModal');
  try {
    const data = await api(`/api/brake-ledger/files/${fileId}/preview`);
    $('docxPreviewText').value = data.text || '(文档内容为空)';
  } catch (error) {
    $('docxPreviewText').value = `加载失败: ${error.message}`;
  }
}

$('copyDocxBtn').onclick = () => {
  const text = $('docxPreviewText').value;
  if (!text || text === '正在加载…') return;
  navigator.clipboard.writeText(text).then(() => toast('已复制全文')).catch(() => {
    $('docxPreviewText').select();
    document.execCommand('copy');
    toast('已复制全文');
  });
};

// ── Export ────────────────────────────────────────────────────────────

async function exportFullLedger() {
  $('exportLedgerBtn').disabled = true;
  $('exportLedgerBtn').textContent = '正在生成…';
  try {
    const response = await fetch('/api/brake-ledger/export', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || '生成失败');
    }
    downloadBlob(await response.blob(), `外部刹车预警台账_${new Date().toISOString().slice(0, 10)}.xlsx`);
    toast('台账已生成');
  } catch (error) {
    toast(error.message);
  } finally {
    $('exportLedgerBtn').disabled = false;
    $('exportLedgerBtn').textContent = '生成台账';
  }
}

// ── Stats ─────────────────────────────────────────────────────────────

async function loadStats() {
  const from = $('statsDateFrom').value;
  const to = $('statsDateTo').value;
  if (!from || !to) return;
  const params = new URLSearchParams({ start_date: from, end_date: to });
  if (currentCategory) params.set('category', currentCategory);
  try {
    const data = await api('/api/brake-ledger/stats?' + params.toString());
    $('statsRecords').textContent = data.records;
    $('statsFiles').textContent = data.files;
  } catch (error) {
    $('statsRecords').textContent = '—';
    $('statsFiles').textContent = '—';
  }
}

function setStatsDefaults() {
  const now = new Date();
  $('statsDateTo').value = now.toISOString().slice(0, 10);
  $('statsDateFrom').value = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
}

// ── Categories ────────────────────────────────────────────────────────

function setCategory(category) {
  currentCategory = category;
  document.querySelectorAll('.cat-tab').forEach(tab => {
    tab.classList.toggle('active', tab.dataset.category === category);
  });
  $('eventCategory').value = category;
  const primary = categories.length ? categories[0].name : '工程公司整改单';
  $('introTitle').textContent = category !== primary ? `${category}归档` : '刹车预警，一处归档';
  const url = new URL(location);
  url.searchParams.set('category', category);
  history.replaceState(null, '', url);
  document.title = '外部刹车预警台账';
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

async function loadCategories() {
  const data = await api('/api/brake-ledger/categories');
  categories = data.items;
  renderCategoryTabs();
  populateDropdowns();
  bindCategoryTabClicks();
}

function renderCategoryTabs() {
  const primary = categories.length ? categories[0].name : '工程公司整改单';
  if (!categories.find(c => c.name === currentCategory)) {
    currentCategory = primary;
  }
  $('categoryTabs').innerHTML = categories.map(cat => {
    const active = cat.name === currentCategory ? ' active' : '';
    return `<a class="cat-tab${active}" data-category="${esc(cat.name)}" href="?category=${encodeURIComponent(cat.name)}">${esc(cat.name)}</a>`;
  }).join('') + (adminPassword ? `<button class="manage-categories-btn" id="manageCategoriesBtn" title="管理分类">⚙</button>` : '');
  if (adminPassword) {
    $('manageCategoriesBtn').onclick = openCategoryManager;
  }
}

function populateDropdowns() {
  const options = categories.map(cat => `<option value="${esc(cat.name)}">${esc(cat.name)}</option>`).join('');
  $('eventCategory').innerHTML = options;
  $('eventCategory').value = currentCategory;
}

function openCategoryManager() {
  renderCategoryList();
  openModal('categoryModal');
}

function renderCategoryList() {
  $('categoryList').innerHTML = categories.map((cat, i) => `
    <div class="category-row" draggable="true" data-id="${cat.id}">
      <span class="drag-handle" title="拖拽排序">⠿</span>
      <input class="category-name-input" value="${esc(cat.name)}" data-id="${cat.id}" placeholder="模块名称">
      <button class="save-cat-btn" data-id="${cat.id}" data-idx="${i}" title="保存名称">✓</button>
      <button class="delete-cat-btn" data-id="${cat.id}" title="删除模块">×</button>
    </div>
  `).join('');

  document.querySelectorAll('.save-cat-btn').forEach(btn => {
    btn.onclick = async () => {
      const id = Number(btn.dataset.id);
      const idx = Number(btn.dataset.idx);
      const input = document.querySelector(`.category-name-input[data-id="${id}"]`);
      const newName = input.value.trim();
      if (!newName) { toast('模块名称不能为空'); return; }
      if (newName === categories[idx].name) { toast('名称未变更'); return; }
      try {
        await api(`/api/brake-ledger/categories/${id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password: adminPassword, name: newName }),
        });
        categories[idx].name = newName;
        renderCategoryTabs();
        populateDropdowns();
        bindCategoryTabClicks();
        renderCategoryList();
        toast('模块已重命名');
      } catch (error) { toast(error.message); }
    };
  });

  document.querySelectorAll('.delete-cat-btn').forEach(btn => {
    btn.onclick = async () => {
      const id = Number(btn.dataset.id);
      const cat = categories.find(c => c.id === id);
      if (!cat) return;
      if (!confirm(`确定删除"${cat.name}"模块吗？该模块下的记录将归入默认模块。`)) return;
      try {
        await api(`/api/brake-ledger/categories/${id}`, {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password: adminPassword }),
        });
        categories = categories.filter(c => c.id !== id);
        if (currentCategory === cat.name) {
          currentCategory = categories.length ? categories[0].name : '工程公司整改单';
        }
        await loadEvents();
        renderCategoryTabs();
        populateDropdowns();
        bindCategoryTabClicks();
        renderCategoryList();
        toast('模块已删除');
      } catch (error) { toast(error.message); }
    };
  });

  document.querySelectorAll('.category-row').forEach(row => {
    row.addEventListener('dragstart', e => {
      e.dataTransfer.effectAllowed = 'move';
      row.classList.add('dragging-row');
    });
    row.addEventListener('dragend', () => {
      row.classList.remove('dragging-row');
      document.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
    });
    row.addEventListener('dragover', e => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      const dragging = document.querySelector('.dragging-row');
      if (dragging && dragging !== row) row.classList.add('drag-over');
    });
    row.addEventListener('dragleave', () => { row.classList.remove('drag-over'); });
    row.addEventListener('drop', async e => {
      e.preventDefault();
      row.classList.remove('drag-over');
      const dragging = document.querySelector('.dragging-row');
      if (!dragging || dragging === row) return;
      const rows = Array.from($('categoryList').querySelectorAll('.category-row'));
      const fromIdx = rows.indexOf(dragging);
      const toIdx = rows.indexOf(row);
      if (fromIdx < 0 || toIdx < 0) return;
      const moved = categories.splice(fromIdx, 1)[0];
      categories.splice(toIdx, 0, moved);
      renderCategoryList();
      try {
        await api('/api/brake-ledger/categories/reorder', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password: adminPassword, ids: categories.map(c => c.id) }),
        });
        renderCategoryTabs();
        populateDropdowns();
        bindCategoryTabClicks();
        toast('排序已保存');
      } catch (error) { toast(error.message); }
    });
  });
}

$('addCategoryBtn').onclick = async () => {
  const name = $('newCategoryName').value.trim();
  if (!name) { toast('请输入模块名称'); return; }
  try {
    const result = await api('/api/brake-ledger/categories', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: adminPassword, name }),
    });
    categories.push({ id: result.id, name: result.name, sort_order: result.sort_order });
    $('newCategoryName').value = '';
    renderCategoryTabs();
    populateDropdowns();
    bindCategoryTabClicks();
    renderCategoryList();
    toast(`模块"${name}"已添加`);
  } catch (error) { toast(error.message); }
};

// ── Event Listeners ───────────────────────────────────────────────────

$('exportLedgerBtn').onclick = exportFullLedger;
$('importBtn').onclick = () => { openModal('importModal'); $('importResult').style.display = 'none'; $('importFileInput').value = ''; };
$('refreshBtn').onclick = loadEvents;
$('keyword').addEventListener('input', (() => {
  let timer;
  return () => { clearTimeout(timer); timer = setTimeout(loadEvents, 250); };
})());
$('statsMonthBtn').onclick = () => { setStatsDefaults(); loadStats().catch(() => {}); };
$('statsRefreshBtn').onclick = () => loadStats().catch(() => {});
$('statsDateFrom').addEventListener('change', () => loadStats().catch(() => {}));
$('statsDateTo').addEventListener('change', () => loadStats().catch(() => {}));

async function clearAllLedger() {
  if (!confirm('确定清除全部外部刹车预警记录和文件吗？此操作无法撤销。')) return;
  try {
    const response = await fetch('/api/brake-ledger/clear', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: adminPassword }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || '清除失败');
    closeModals();
    await loadCategories();
    renderCategoryTabs();
    bindCategoryTabClicks();
    populateDropdowns();
    await loadEvents();
    loadStats().catch(() => {});
    toast(`已清除 ${data.deleted} 个文件，可重新导入`);
  } catch (error) { toast(error.message); }
}

$('clearLedgerBtn').onclick = clearAllLedger;
$('clearLedgerTopBtn').onclick = clearAllLedger;

document.querySelectorAll('[data-close]').forEach(btn => btn.onclick = closeModals);
document.querySelectorAll('.modal').forEach(modal => modal.addEventListener('click', e => { if (e.target === modal) closeModals(); }));

// ── Import ──────────────────────────────────────────────────────────────

$('importFileInput').onchange = e => {
  if (e.target.files.length) doImport(e.target.files[0]);
};

['dragenter', 'dragover'].forEach(name => $('importDropzone').addEventListener(name, e => {
  e.preventDefault();
  $('importDropzone').classList.add('dragging');
}));
['dragleave', 'drop'].forEach(name => $('importDropzone').addEventListener(name, e => {
  e.preventDefault();
  $('importDropzone').classList.remove('dragging');
}));
$('importDropzone').addEventListener('drop', e => {
  const files = Array.from(e.dataTransfer.files || []);
  if (files.length) doImport(files[0]);
});

async function doImport(file) {
  const resultDiv = $('importResult');
  resultDiv.style.display = 'block';
  resultDiv.innerHTML = '正在上传并解析文件…';
  try {
    const body = new FormData();
    body.append('password', adminPassword);
    body.append('file', file);
    if ($('importOverwrite').checked) body.append('overwrite', 'true');
    const response = await fetch('/api/brake-ledger/import', { method: 'POST', body });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || '导入失败');
    let msg = `导入完成：新增 ${data.imported} 条记录`;
    if (data.overwritten) msg += `，覆盖 ${data.overwritten} 条`;
    if (data.skipped_existing) msg += `，${data.skipped_existing} 条已存在`;
    if (data.skipped_filter) msg += `，过滤 ${data.skipped_filter} 条`;
    if (data.file_attached) msg += `，源文件已上传`;
    resultDiv.innerHTML = `<b style="color:var(--green)">${msg}</b>`;
    toast(msg);
    await loadCategories();
    renderCategoryTabs();
    bindCategoryTabClicks();
    populateDropdowns();
    await loadEvents();
    loadStats().catch(() => {});
  } catch (error) {
    resultDiv.innerHTML = `<b style="color:#b33b32">导入失败：${esc(error.message)}</b>`;
    toast(error.message);
  }
}

// ── Init ──────────────────────────────────────────────────────────────

async function initialize() {
  await loadCategories();
  setCategory(currentCategory);
  setStatsDefaults();
  if (adminPassword) {
    enterAdmin(adminPassword).catch(() => {
      adminPassword = '';
      sessionStorage.removeItem('brakeLedgerPassword');
      loadEvents();
    });
  } else {
    loadEvents().catch(error => toast(error.message));
  }
  loadStats().catch(() => {});
}

initialize();