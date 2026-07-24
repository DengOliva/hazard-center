const $ = id => document.getElementById(id);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let resultData = null;

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
  $('analyzeBtn').disabled = !$('rosterFile').files.length || !$('attendanceFile').files.length;
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
  body.append('roster', $('rosterFile').files[0]);
  body.append('attendance', $('attendanceFile').files[0]);
  $('analyzeBtn').disabled = true;
  $('analyzeBtn').textContent = '正在读取统计…';
  try {
    const response = await fetch('/api/subcontractor-attendance/analyze', {method:'POST', body});
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || '统计失败');
    resultData = data;
    renderResults();
  } catch (error) {
    toast(error.message);
  } finally {
    $('analyzeBtn').disabled = false;
    $('analyzeBtn').textContent = '开始统计';
  }
};

function renderResults() {
  const data = resultData;
  $('emptyState').classList.add('hidden');
  $('results').classList.remove('hidden');
  $('periodTitle').textContent = `${data.start} 至 ${data.end} · 共 ${data.period_days} 天`;
  $('sourceText').textContent = `${data.roster_filename} ＋ ${data.attendance_filename}`;
  $('kpiPeople').textContent = data.roster_count;
  $('kpiAverage').textContent = data.average_days;
  $('kpiRate').textContent = `${Math.round(data.overall_rate * 100)}%`;
  $('kpiFull').textContent = data.full_attendance_count;
  $('kpiZero').textContent = data.zero_attendance_count;
  $('tableSummary').textContent = `按签到天数从少到多排列 · 共读取 ${data.attendance_record_count} 条打卡记录`;
  renderDaily();
  renderPeople(data.people);
  const attention = data.people.filter(item => item.status !== '全勤').slice(0, 8);
  $('attentionList').innerHTML = attention.length ? attention.map(item =>
    `<div class="attention-item"><b>${esc(item.name)}</b><span>${item.status === '未签到' ? '0 天签到' : `${item.signed_days}/${data.period_days} 天`}</span></div>`
  ).join('') : '<div class="attention-ok">全部人员均已全勤</div>';
  $('unmatchedPanel').classList.toggle('hidden', !data.unmatched_names.length);
  $('unmatchedNames').innerHTML = data.unmatched_names.map(name => `<span>${esc(name)}</span>`).join('');
  $('results').scrollIntoView({behavior:'smooth', block:'start'});
}

function renderDaily() {
  const data = resultData;
  $('dailyChart').innerHTML = data.daily.map(day => {
    const height = Math.max(2, Math.round(day.rate * 100));
    return `<div class="day-bar"><div class="bar-track" title="${day.signed_count}/${data.roster_count} 人"><div class="bar-fill" style="height:${height}%"></div></div><b>${day.signed_count}人</b><span>${day.date.slice(5)}</span></div>`;
  }).join('');
}

function renderPeople(items) {
  $('peopleBody').innerHTML = items.map(item => {
    const statusClass = item.status === '全勤' ? 'full' : (item.status === '未签到' ? 'zero' : 'partial');
    return `<tr><td><strong>${esc(item.name)}</strong></td><td>${item.signed_days} 天</td><td>${item.missing_days} 天</td><td class="rate-cell">${Math.round(item.attendance_rate * 100)}%<div class="rate-line"><i style="width:${Math.round(item.attendance_rate * 100)}%"></i></div></td><td>${item.punch_count}</td><td>${item.first_date || '—'}</td><td>${item.last_date || '—'}</td><td><span class="status ${statusClass}">${item.status}</span></td></tr>`;
  }).join('');
}

$('personSearch').oninput = () => {
  const keyword = $('personSearch').value.trim().toLowerCase();
  renderPeople(resultData.people.filter(item => `${item.name} ${item.status}`.toLowerCase().includes(keyword)));
};
$('reanalyzeBtn').onclick = () => {
  $('results').classList.add('hidden');
  $('emptyState').classList.remove('hidden');
  window.scrollTo({top:0, behavior:'smooth'});
};
