const $ = id => document.getElementById(id);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let resultData = null;
let hasSavedRoster = false;

function toast(message) {
  $('toast').textContent = message;
  $('toast').classList.add('show');
  setTimeout(() => $('toast').classList.remove('show'), 2800);
}
function setFile(kind, file) {
  const input = $(kind + 'File');
  const box = $(kind + 'Box');
  if (!file || !file.name.toLowerCase().endsWith('.xlsx')) {
    toast('请选择 .xlsx 文件');
    return;
  }
  const transfer = new DataTransfer();
  transfer.items.add(file);
  input.files = transfer.files;
  $(kind + 'Text').textContent = file.name;
  box.classList.add('ready');
  box.querySelector('em').textContent = '已选择';
  updateAnalyzeState();
}
function updateAnalyzeState() {
  $('analyzeBtn').disabled = !$('attendanceFile').files.length || (!hasSavedRoster && !$('rosterFile').files.length);
}
function bindFileBox(kind) {
  const input = $(kind + 'File');
  const box = $(kind + 'Box');
  input.onchange = () => setFile(kind, input.files[0]);
  ['dragenter','dragover'].forEach(name => box.addEventListener(name, event => {
    event.preventDefault();
    box.classList.add('dragging');
  }));
  ['dragleave','drop'].forEach(name => box.addEventListener(name, event => {
    event.preventDefault();
    box.classList.remove('dragging');
  }));
  box.addEventListener('drop', event => setFile(kind, event.dataTransfer.files[0]));
}
bindFileBox('roster');
bindFileBox('attendance');

$('analyzeBtn').onclick = async () => {
  const body = new FormData();
  if ($('rosterFile').files.length) body.append('roster', $('rosterFile').files[0]);
  body.append('attendance', $('attendanceFile').files[0]);
  $('analyzeBtn').disabled = true;
  $('analyzeBtn').textContent = '正在读取统计…';
  try {
    const response = await fetch('/api/subcontractor-attendance/analyze', {method:'POST', body});
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || '统计失败');
    resultData = data;
    hasSavedRoster = true;
    showSavedRoster(data);
    renderResults();
  } catch (error) {
    toast(error.message);
  } finally {
    $('analyzeBtn').textContent = hasSavedRoster ? '更新看板' : '开始统计';
    updateAnalyzeState();
  }
};

function renderResults() {
  const data = resultData;
  $('emptyState').classList.add('hidden');
  $('results').classList.remove('hidden');
  $('periodTitle').textContent = `${data.start} 至 ${data.end} · 共 ${data.period_days} 天`;
  const savedTime = data.imported_at ? data.imported_at.replace('T', ' ') : '';
  $('sourceText').textContent = `${data.roster_filename} ＋ ${data.attendance_filename}${savedTime ? ` · 更新于 ${savedTime}` : ''}`;
  $('kpiPeople').textContent = data.roster_count;
  $('kpiAverage').textContent = data.average_days;
  $('kpiRate').textContent = `${Math.round(data.overall_rate * 100)}%`;
  $('kpiFull').textContent = data.full_attendance_count;
  $('kpiZero').textContent = data.zero_attendance_count;
  $('tableSummary').textContent = `按签到天数从少到多排列 · 共读取 ${data.attendance_record_count} 条打卡记录`;
  renderPeople(data.people);
  $('unmatchedPanel').classList.toggle('hidden', !data.unmatched_names.length);
  $('unmatchedNames').innerHTML = data.unmatched_names.map(name => `<span>${esc(name)}</span>`).join('');
  $('results').scrollIntoView({behavior:'smooth', block:'start'});
}

function renderPeople(items) {
  $('peopleBody').innerHTML = items.map(item => {
    const statusClass = item.status === '全勤' ? 'full' : (item.status === '未签到' ? 'zero' : 'partial');
    return `<tr><td><strong>${esc(item.name)}</strong></td><td>${esc(item.role || '—')}</td><td>${item.signed_days} 天</td><td>${item.missing_days} 天</td><td class="rate-cell">${Math.round(item.attendance_rate * 100)}%<div class="rate-line"><i style="width:${Math.round(item.attendance_rate * 100)}%"></i></div></td><td>${item.punch_count}</td><td>${item.first_date || '—'}</td><td>${item.last_date || '—'}</td><td><span class="status ${statusClass}">${item.status}</span></td></tr>`;
  }).join('');
}

$('personSearch').oninput = () => {
  const keyword = $('personSearch').value.trim().toLowerCase();
  renderPeople(resultData.people.filter(item => `${item.name} ${item.status}`.toLowerCase().includes(keyword)));
};
function exportImage(role) {
  const label = role || '全部';
  const url = '/api/subcontractor-attendance/export-image' + (role ? '?role=' + encodeURIComponent(role) : '');
  const link = document.createElement('a');
  link.href = url;
  link.download = '';
  document.body.appendChild(link);
  link.click();
  link.remove();
  toast('正在下载 ' + label + ' 签到图片...');
}
$('exportTeamLeaderBtn').onclick = () => exportImage('班组长');
$('exportRepBtn').onclick = () => exportImage('驻场代表');
$('exportAllBtn').onclick = () => exportImage('');
$('reanalyzeBtn').onclick = () => {
  window.scrollTo({top:0, behavior:'smooth'});
  toast('选择新一期签到台账后点击”更新看板”');
};

function showSavedRoster(data) {
  $('rosterText').textContent = `已固定：${data.roster_filename}（可选择新文件替换）`;
  $('rosterBox').classList.add('ready');
  $('rosterState').textContent = '固定名单';
  $('analyzeBtn').textContent = '更新看板';
  updateAnalyzeState();
}

async function loadSavedDashboard() {
  try {
    const response = await fetch('/api/subcontractor-attendance/current');
    if (response.status === 404) return;
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || '读取看板失败');
    resultData = data;
    hasSavedRoster = true;
    showSavedRoster(data);
    renderResults();
  } catch (error) {
    toast(error.message);
  }
}

loadSavedDashboard();
