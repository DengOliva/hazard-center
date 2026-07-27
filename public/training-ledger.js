const $ = id => document.getElementById(id);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let adminPassword = sessionStorage.getItem('trainingLedgerPassword') || '';
let activeEventId = null;
let queuedFiles = [];
let loadedEvents = [];
let batchQueue = [];
let batchIndex = 0;
let batchPreviewUrl = '';
let batchEvents = [];
let currentCategory = new URLSearchParams(location.search).get('category') || '专题培训';

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

function openLedgerExport() {
  if (!loadedEvents.length) { toast('当前没有可导出的培训记录'); return; }
  $('exportEventList').innerHTML = loadedEvents.map(event => `
    <label class="export-event">
      <input type="checkbox" value="${event.id}">
      <time>${esc(event.training_date)}</time>
      <b>${esc(event.name)}</b>
      <small>${esc(event.audience || '未填写对象')}</small>
    </label>`).join('');
  $('exportEventList').querySelectorAll('input').forEach(input => input.onchange = updateExportSelection);
  updateExportSelection();
  openModal('ledgerExportModal');
}

function selectedExportEvents() {
  const ids = new Set(Array.from($('exportEventList').querySelectorAll('input:checked')).map(input => Number(input.value)));
  return loadedEvents.filter(event => ids.has(event.id)).sort((a, b) => a.training_date.localeCompare(b.training_date) || a.id - b.id);
}

function updateExportSelection() {
  const selected = selectedExportEvents();
  $('exportSelectedCount').textContent = `已选择 ${selected.length} 项`;
  $('exportConfirmBtn').disabled = !selected.length;
  const inputs = Array.from($('exportEventList').querySelectorAll('input'));
  $('selectAllExportBtn').textContent = inputs.length && inputs.every(input => input.checked) ? '取消全选' : '全选';
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1200);
}

function wrapCanvasText(ctx, text, x, y, maxWidth, lineHeight, maxLines=2) {
  const chars = Array.from(String(text || '—'));
  const lines = [];
  let line = '';
  for (const char of chars) {
    if (ctx.measureText(line + char).width > maxWidth && line) {
      lines.push(line);
      line = char;
      if (lines.length === maxLines - 1) break;
    } else {
      line += char;
    }
  }
  const used = lines.join('').length;
  if (used < chars.length) {
    line = chars.slice(used).join('');
    while (ctx.measureText(line + '…').width > maxWidth && line.length) line = line.slice(0, -1);
    line += '…';
  }
  lines.push(line);
  lines.slice(0, maxLines).forEach((value, index) => ctx.fillText(value, x, y + index * lineHeight));
}

function createLedgerImage(events) {
  const widths = [190, 390, 280, 260, 210, 130];
  const labels = ['培训日期','培训主题','培训对象','培训地点','培训讲师','培训人数'];
  const margin = 70;
  const headerHeight = 190;
  const tableHeaderHeight = 62;
  const rowHeight = 88;
  const footerHeight = 70;
  const canvas = document.createElement('canvas');
  canvas.width = widths.reduce((sum, width) => sum + width, 0) + margin * 2;
  canvas.height = headerHeight + tableHeaderHeight + events.length * rowHeight + footerHeight;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#eef5f2';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const gradient = ctx.createLinearGradient(0, 0, canvas.width, headerHeight);
  gradient.addColorStop(0, '#123b32');
  gradient.addColorStop(.65, '#176b57');
  gradient.addColorStop(1, '#2c987c');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, canvas.width, headerHeight);
  ctx.fillStyle = '#75d9bb';
  ctx.font = '700 18px "Microsoft YaHei"';
  ctx.fillText('TRAINING LEDGER', margin, 48);
  ctx.fillStyle = '#ffffff';
  ctx.font = '700 46px "Microsoft YaHei"';
  const categoryTitle = events[0].category === '入场培训' ? '入场培训台账' : '培训台账';
  ctx.fillText(categoryTitle, margin, 105);
  ctx.fillStyle = '#d8ebe5';
  ctx.font = '22px "Microsoft YaHei"';
  ctx.fillText(`已选 ${events.length} 场培训 · ${events[0].training_date} 至 ${events[events.length - 1].training_date}`, margin, 147);
  let x = margin;
  ctx.fillStyle = '#267b67';
  ctx.fillRect(margin, headerHeight, canvas.width - margin * 2, tableHeaderHeight);
  ctx.fillStyle = '#ffffff';
  ctx.font = '700 20px "Microsoft YaHei"';
  ctx.textBaseline = 'middle';
  labels.forEach((label, index) => {
    ctx.fillText(label, x + 18, headerHeight + tableHeaderHeight / 2);
    x += widths[index];
  });
  events.forEach((event, rowIndex) => {
    const y = headerHeight + tableHeaderHeight + rowIndex * rowHeight;
    ctx.fillStyle = rowIndex % 2 ? '#f5f9f7' : '#ffffff';
    ctx.fillRect(margin, y, canvas.width - margin * 2, rowHeight);
    ctx.strokeStyle = '#dce8e3';
    ctx.beginPath();
    ctx.moveTo(margin, y + rowHeight);
    ctx.lineTo(canvas.width - margin, y + rowHeight);
    ctx.stroke();
    const values = [
      event.training_date,
      event.name,
      event.audience || '未填写',
      event.training_location || '未填写',
      event.instructor || '未填写',
      `${event.participant_count || 0} 人`,
    ];
    x = margin;
    values.forEach((value, index) => {
      ctx.fillStyle = index === 1 ? '#17251f' : '#4e6059';
      ctx.font = `${index === 1 ? '700' : '400'} 19px "Microsoft YaHei"`;
      ctx.textBaseline = 'top';
      wrapCanvasText(ctx, value, x + 18, y + 22, widths[index] - 34, 27, 2);
      x += widths[index];
    });
  });
  ctx.fillStyle = '#71817b';
  ctx.font = '17px "Microsoft YaHei"';
  ctx.textBaseline = 'middle';
  ctx.fillText(`生成时间：${new Date().toLocaleString('zh-CN', {hour12:false})}`, margin, canvas.height - footerHeight / 2);
  ctx.textAlign = 'right';
  ctx.fillText('培训台账共享中心', canvas.width - margin, canvas.height - footerHeight / 2);
  ctx.textAlign = 'left';
  return canvas;
}

async function exportSelectedLedger() {
  const events = selectedExportEvents();
  if (!events.length) return;
  $('exportConfirmBtn').disabled = true;
  $('exportConfirmBtn').textContent = '正在生成…';
  try {
    const response = await fetch('/api/training-ledger/export', {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({ids:events.map(event => event.id)}),
    });
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Excel 生成失败');
    }
    const prefix = currentCategory === '入场培训' ? '入场培训台账' : '培训台账';
    const dateStr = new Date().toISOString().slice(0, 10);
    downloadBlob(await response.blob(), `${prefix}_${dateStr}.xlsx`);
    const canvas = createLedgerImage(events);
    canvas.toBlob(blob => {
      if (blob) downloadBlob(blob, `${prefix}_${dateStr}.png`);
    }, 'image/png');
    closeModals();
    toast(`已生成 ${events.length} 场培训的 Excel 和图片`);
  } catch (error) {
    toast(error.message);
  } finally {
    $('exportConfirmBtn').disabled = false;
    $('exportConfirmBtn').textContent = '生成 Excel ＋ 美化图片';
  }
}

async function loadEvents() {
  const keyword = $('keyword').value.trim();
  const params = new URLSearchParams();
  if (keyword) params.set('keyword', keyword);
  params.set('category', currentCategory);
  const data = await api('/api/training-ledger/events?' + params.toString());
  const events = data.items;
  loadedEvents = events;
  const totalFiles = events.reduce((sum, item) => sum + item.files.length, 0);
  $('eventCount').textContent = events.length;
  $('fileCount').textContent = totalFiles;
  $('resultText').textContent = keyword ? `找到 ${events.length} 场相关培训` : `共 ${events.length} 场培训，按日期由近到远排列`;
  $('eventList').innerHTML = events.length ? events.map(eventCard).join('') :
    `<div class="empty"><span>档</span><h3>${keyword ? '没有匹配的培训记录' : '还没有培训台账'}</h3><p>${adminPassword ? '点击右上角“新增培训”开始归档。' : '管理员新增培训后，记录会显示在这里。'}</p></div>`;
  bindInlineDropzones();
}

function eventCard(event) {
  const categoryBadge = event.category && event.category !== '专题培训'
    ? `<span class="category-badge">${esc(event.category)}</span>` : '';
  const meta = [
    ['培训对象', event.audience],
    ['培训地点', event.training_location],
    ['培训讲师', event.instructor],
    ['培训人数', event.participant_count ? `${event.participant_count} 人` : ''],
  ].map(([label, value]) => `<span>${label}<b>${esc(value || '未填写')}</b></span>`).join('');
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
        <div class="${adminPassword ? 'event-info-edit' : ''}" ${adminPassword ? `onclick="editEvent(${event.id})" title="点击修改培训信息"` : ''}><h3>${esc(event.name)}${categoryBadge}</h3>${event.description ? `<p>${esc(event.description)}</p>` : ''}<div class="event-meta">${meta}</div></div>
        <div class="event-actions"><span>${event.files.length} 个文件</span>${adminPassword ? `<button class="delete-event" onclick="deleteEvent(${event.id}, event)">删除</button>` : ''}</div>
      </div>
      ${adminPassword ? `<label class="inline-dropzone" data-event-id="${event.id}">
        <input type="file" multiple>
        <span>⇧</span><b>把签到单、培训照片或其他文件拖到这里直接上传</b><small>也可以点击选择文件</small>
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
    ['dragenter', 'dragover'].forEach(name => zone.addEventListener(name, event => {
      event.preventDefault();
      zone.classList.add('dragging');
    }));
    ['dragleave', 'drop'].forEach(name => zone.addEventListener(name, event => {
      event.preventDefault();
      zone.classList.remove('dragging');
    }));
    zone.addEventListener('drop', event => uploadInline(eventId, droppedFiles(event.dataTransfer), zone));
  });
}

async function uploadInline(eventId, files, zone) {
  files = Array.from(files || []);
  if (!files.length || zone.classList.contains('uploading')) return;
  const body = new FormData();
  body.append('password', adminPassword);
  files.forEach(file => body.append('files', file));
  zone.classList.add('uploading');
  const label = zone.querySelector('b');
  const originalText = label.textContent;
  label.textContent = `正在上传 ${files.length} 个文件…`;
  try {
    await api(`/api/training-ledger/events/${eventId}/files`, {method:'POST', body});
    await loadEvents();
    toast(`${files.length} 个文件已上传并自动命名`);
  } catch (error) {
    zone.classList.remove('uploading');
    label.textContent = originalText;
    toast(error.message);
  }
}

async function enterAdmin(password) {
  await api('/api/training/verify', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({password})});
  adminPassword = password;
  sessionStorage.setItem('trainingLedgerPassword', password);
  $('adminBtn').textContent = '已进入管理模式';
  $('newEventBtn').classList.remove('hidden');
  $('batchImportBtn').classList.remove('hidden');
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
$('generateLedgerBtn').onclick = openLedgerExport;
$('selectAllExportBtn').onclick = () => {
  const inputs = Array.from($('exportEventList').querySelectorAll('input'));
  const shouldSelect = !inputs.every(input => input.checked);
  inputs.forEach(input => { input.checked = shouldSelect; });
  updateExportSelection();
};
$('exportConfirmBtn').onclick = exportSelectedLedger;
$('newEventBtn').onclick = () => {
  $('eventEditId').value = '';
  $('eventFormTitle').textContent = '新增培训名目';
  $('eventSubmitBtn').textContent = '创建培训';
  $('eventDate').value = new Date().toISOString().slice(0, 10);
  $('eventName').value = '';
  $('eventLocation').value = '';
  $('eventInstructor').value = '';
  $('eventAudience').value = '';
  $('eventParticipantCount').value = '';
  $('eventDescription').value = '';
  $('eventCategory').value = currentCategory;
  openModal('eventModal');
  $('eventName').focus();
};

function editEvent(id) {
  const event = loadedEvents.find(item => item.id === id);
  if (!event) return;
  $('eventEditId').value = event.id;
  $('eventFormTitle').textContent = '修改培训信息';
  $('eventSubmitBtn').textContent = '保存修改';
  $('eventName').value = event.name || '';
  $('eventDate').value = event.training_date || '';
  $('eventLocation').value = event.training_location || '';
  $('eventInstructor').value = event.instructor || '';
  $('eventAudience').value = event.audience || '';
  $('eventParticipantCount').value = event.participant_count || '';
  $('eventDescription').value = event.description || '';
  $('eventCategory').value = event.category || '专题培训';
  openModal('eventModal');
  $('eventName').focus();
}

async function deleteEvent(id, clickEvent) {
  clickEvent?.stopPropagation();
  const event = loadedEvents.find(item => item.id === id);
  if (!event) return;
  const fileNotice = event.files.length ? `，以及其中 ${event.files.length} 个已上传文件` : '';
  if (!confirm(`确定删除“${event.name}”${fileNotice}吗？此操作无法撤销。`)) return;
  try {
    await api(`/api/training-ledger/events/${id}`, {
      method:'DELETE',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({password:adminPassword}),
    });
    await loadEvents();
    toast('培训名录已删除');
  } catch (error) {
    toast(error.message);
  }
}
$('batchImportBtn').onclick = () => {
  batchQueue = [];
  batchIndex = 0;
  $('batchFiles').value = '';
  $('batchWorkspace').classList.add('hidden');
  $('batchSkipTopBtn').classList.add('hidden');
  $('batchProgress').textContent = '尚未选择文件';
  $('batchCategory').value = currentCategory;
  openModal('batchModal');
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
    const eventId = $('eventEditId').value;
    const payload = {
      password:adminPassword,
      name:$('eventName').value.trim(),
      training_date:$('eventDate').value,
      training_location:$('eventLocation').value.trim(),
      instructor:$('eventInstructor').value.trim(),
      audience:$('eventAudience').value.trim(),
      participant_count:parseInt($('eventParticipantCount').value) || 0,
      description:$('eventDescription').value.trim(),
      category:$('eventCategory').value,
    };
    await api(eventId ? `/api/training-ledger/events/${eventId}` : '/api/training-ledger/events', {
      method:eventId ? 'PATCH' : 'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify(payload),
    });
    closeModals();
    $('eventForm').reset();
    await loadEvents();
    toast(eventId ? '培训信息已更新' : '培训名录已新增');
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

function loadBatchFiles(files) {
  const accepted = Array.from(files || []).filter(file => file.type.startsWith('image/') || file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf'));
  if (!accepted.length) { toast('请选择 PDF 或图片文件'); return; }
  batchQueue = accepted;
  batchIndex = 0;
  $('batchWorkspace').classList.remove('hidden');
  $('batchSkipTopBtn').classList.remove('hidden');
  showBatchFile();
}

function droppedFiles(dataTransfer) {
  const fromItems = Array.from(dataTransfer?.items || [])
    .filter(item => item.kind === 'file')
    .map(item => item.getAsFile())
    .filter(Boolean);
  return fromItems.length ? fromItems : Array.from(dataTransfer?.files || []);
}

async function showBatchFile() {
  if (batchPreviewUrl) URL.revokeObjectURL(batchPreviewUrl);
  if (batchIndex >= batchQueue.length) {
    batchPreviewUrl = '';
    $('batchSkipTopBtn').classList.add('hidden');
    closeModals();
    await loadEvents();
    toast(`批量导入完成，共处理 ${batchQueue.length} 个文件`);
    return;
  }
  const file = batchQueue[batchIndex];
  batchPreviewUrl = URL.createObjectURL(file);
  $('batchProgress').textContent = `第 ${batchIndex + 1} / ${batchQueue.length} 个`;
  $('batchFileName').textContent = file.name;
  $('batchFileSize').textContent = sizeText(file.size);
  $('batchPreviewContent').innerHTML = file.type.startsWith('image/')
    ? `<img src="${batchPreviewUrl}" alt="${esc(file.name)}">`
    : `<embed src="${batchPreviewUrl}" type="application/pdf">`;
  if (!$('batchDate').value) $('batchDate').value = new Date().toISOString().slice(0, 10);
  await refreshBatchEvents();
}

async function refreshBatchEvents() {
  const data = await api('/api/training-ledger/events?category=' + encodeURIComponent($('batchCategory').value));
  batchEvents = data.items.filter(item => item.training_date === $('batchDate').value);
  $('batchEventSelect').innerHTML = `<option value="new">＋ 新建培训名录</option>` +
    batchEvents.map(item => `<option value="${item.id}">${esc(item.name)}</option>`).join('');
  $('batchEventSelect').value = batchEvents.length ? String(batchEvents[0].id) : 'new';
  fillBatchEventFields();
}

function fillBatchEventFields() {
  const selectedId = $('batchEventSelect').value;
  const event = batchEvents.find(item => String(item.id) === selectedId);
  $('batchNewNameWrap').style.display = event ? 'none' : '';
  $('batchNewName').value = event ? event.name : '';
  $('batchLocation').value = event?.training_location || '';
  $('batchInstructor').value = event?.instructor || '';
  $('batchAudience').value = event?.audience || '';
  $('batchParticipantCount').value = event?.participant_count || '';
}

async function saveBatchCurrent() {
  const file = batchQueue[batchIndex];
  const trainingDate = $('batchDate').value;
  if (!file || !trainingDate) { toast('请选择培训日期'); return; }
  const metadata = {
    password: adminPassword,
    training_location: $('batchLocation').value.trim(),
    instructor: $('batchInstructor').value.trim(),
    audience: $('batchAudience').value.trim(),
    participant_count: parseInt($('batchParticipantCount').value) || 0,
  };
  $('batchSaveBtn').disabled = true;
  $('batchSaveBtn').textContent = '正在归档…';
  try {
    let eventId = $('batchEventSelect').value;
    if (eventId === 'new') {
      const name = $('batchNewName').value.trim();
      if (!name) throw new Error('请输入新培训名称');
      const created = await api('/api/training-ledger/events', {
        method:'POST', headers:{'Content-Type':'application/json'},
        body:JSON.stringify({...metadata, name, training_date:trainingDate, category:$('batchCategory').value}),
      });
      eventId = created.id;
    } else {
      await api(`/api/training-ledger/events/${eventId}`, {
        method:'PATCH', headers:{'Content-Type':'application/json'},
        body:JSON.stringify(metadata),
      });
    }
    const upload = new FormData();
    upload.append('password', adminPassword);
    upload.append('files', file);
    await api(`/api/training-ledger/events/${eventId}/files`, {method:'POST', body:upload});
    batchIndex += 1;
    await showBatchFile();
  } catch (error) {
    toast(error.message);
  } finally {
    $('batchSaveBtn').disabled = false;
    $('batchSaveBtn').textContent = '归档并查看下一个';
  }
}

$('batchFiles').onchange = event => loadBatchFiles(event.target.files);
['dragenter','dragover'].forEach(name => $('batchPicker').addEventListener(name, event => {
  event.preventDefault();
  $('batchPicker').classList.add('dragging');
}));
['dragleave','drop'].forEach(name => $('batchPicker').addEventListener(name, event => {
  event.preventDefault();
  $('batchPicker').classList.remove('dragging');
}));
$('batchPicker').addEventListener('drop', event => {
  event.stopPropagation();
  loadBatchFiles(droppedFiles(event.dataTransfer));
});
$('batchDate').onchange = refreshBatchEvents;
$('batchCategory').onchange = refreshBatchEvents;
$('batchEventSelect').onchange = fillBatchEventFields;
$('batchSaveBtn').onclick = saveBatchCurrent;
async function skipBatchCurrent() {
  if (batchIndex >= batchQueue.length) return;
  batchIndex += 1;
  await showBatchFile();
}
$('batchSkipBtn').onclick = skipBatchCurrent;
$('batchSkipTopBtn').onclick = skipBatchCurrent;

let pageDragDepth = 0;
document.addEventListener('dragenter', event => {
  if (!adminPassword || !Array.from(event.dataTransfer?.types || []).includes('Files')) return;
  if (event.target.closest('.inline-dropzone,.batch-picker')) return;
  event.preventDefault();
  pageDragDepth += 1;
  $('wechatDropOverlay').classList.add('show');
});
document.addEventListener('dragover', event => {
  if (!adminPassword || !Array.from(event.dataTransfer?.types || []).includes('Files')) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = 'copy';
});
document.addEventListener('dragleave', event => {
  if (!adminPassword) return;
  pageDragDepth = Math.max(0, pageDragDepth - 1);
  if (!pageDragDepth) $('wechatDropOverlay').classList.remove('show');
});
document.addEventListener('drop', event => {
  pageDragDepth = 0;
  $('wechatDropOverlay').classList.remove('show');
  if (!adminPassword || event.target.closest('.inline-dropzone,.batch-picker')) return;
  event.preventDefault();
  const files = droppedFiles(event.dataTransfer);
  if (!files.length) {
    toast('微信没有提供可读取的文件，请先在微信中完成下载');
    return;
  }
  batchQueue = [];
  batchIndex = 0;
  $('batchFiles').value = '';
  $('batchWorkspace').classList.add('hidden');
  $('batchSkipTopBtn').classList.add('hidden');
  $('batchProgress').textContent = '正在读取微信文件…';
  $('batchCategory').value = currentCategory;
  openModal('batchModal');
  loadBatchFiles(files);
});

function setCategory(category) {
  currentCategory = category;
  document.querySelectorAll('.cat-tab').forEach(tab => {
    tab.classList.toggle('active', tab.dataset.category === category);
  });
  $('eventCategory').value = category;
  $('batchCategory').value = category;
  const title = category === '入场培训' ? '入场培训归档' : '每场培训，一处归档';
  $('introTitle').textContent = title;
  const url = new URL(location);
  url.searchParams.set('category', category);
  history.replaceState(null, '', url);
  document.title = category === '入场培训' ? '入场培训台账共享中心' : '培训台账共享中心';
}

document.querySelectorAll('.cat-tab').forEach(tab => {
  tab.addEventListener('click', e => {
    e.preventDefault();
    setCategory(tab.dataset.category);
    loadEvents().catch(error => toast(error.message));
  });
});

setCategory(currentCategory);

if (adminPassword) enterAdmin(adminPassword).catch(() => {
  adminPassword = '';
  sessionStorage.removeItem('trainingLedgerPassword');
  loadEvents();
});
else loadEvents().catch(error => toast(error.message));
