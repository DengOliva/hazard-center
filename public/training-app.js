const $=id=>document.getElementById(id);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const api=async(url,opts)=>{const r=await fetch(url,opts);const data=await r.json();if(!r.ok)throw new Error(data.error||'请求失败');return data};
function toast(message){$('toast').textContent=message;$('toast').classList.add('show');setTimeout(()=>$('toast').classList.remove('show'),2600)}
function trainingWeekRange(base=new Date()){const d=new Date(base);const day=d.getDay()||7;d.setDate(d.getDate()-day+1);const start=d.toISOString().slice(0,10);d.setDate(d.getDate()+6);return [start,d.toISOString().slice(0,10)]}
function setTrainingThisWeek(){const [s,e]=trainingWeekRange();$('trainingStart').value=s;$('trainingEnd').value=e;loadTraining()}
function groupTraining(items){return items.reduce((acc,x)=>{(acc[x.date] ||= {date:x.date,weekday:x.weekday,items:[]}).items.push(x);return acc},{})}

let editingPassword = '';

function openPasswordModal(eventId) {
  editingEventId = eventId;
  $('editPassword').value = '';
  $('passwordModal').classList.add('show');
  $('editPassword').focus();
}

function closePasswordModal() {
  $('passwordModal').classList.remove('show');
  editingEventId = null;
}

function openEditModal(event) {
  $('editEventId').value = event.id;
  $('editTime').value = event.time || '';
  $('editPeriod').value = event.period || '';
  $('editTitle').value = event.title || '';
  $('editItems').value = (event.items || []).join('、');
  $('editModal').classList.add('show');
}

function closeEditModal() {
  $('editModal').classList.remove('show');
}

async function saveEdit() {
  const id = $('editEventId').value;
  const itemsRaw = $('editItems').value.trim();
  const items = itemsRaw ? itemsRaw.split(/[、，,\n\r]+/).map(s=>s.trim()).filter(Boolean) : [];
  try {
    await api('/api/training/save', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({
        id,
        password: editingPassword,
        time: $('editTime').value.trim(),
        period: $('editPeriod').value.trim(),
        title: $('editTitle').value.trim(),
        items,
      }),
    });
    closeEditModal();
    await loadTraining();
    toast('已保存');
  } catch (e) {
    toast(e.message);
  }
}

async function resetEdit() {
  const id = $('editEventId').value;
  if (!confirm('确定要恢复为默认安排吗？')) return;
  try {
    await api('/api/training/reset', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({id, password: editingPassword}),
    });
    closeEditModal();
    await loadTraining();
    toast('已恢复默认');
  } catch (e) {
    toast(e.message);
  }
}

$('passwordConfirmBtn').addEventListener('click', async () => {
  const pwd = $('editPassword').value;
  if (!pwd) { toast('请输入密码'); return; }
  try {
    await api('/api/training/save', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({id: editingEventId, password: pwd}),
    });
    editingPassword = pwd;
    closePasswordModal();
    const event = allEvents.find(e => e.id === editingEventId);
    if (event) openEditModal(event);
  } catch (e) {
    toast(e.message);
  }
});

$('editPassword').addEventListener('keydown', e => {
  if (e.key === 'Enter') $('passwordConfirmBtn').click();
});

let allEvents = [];

async function loadTraining(){
  const q=`start=${$('trainingStart').value}&end=${$('trainingEnd').value}&keyword=${encodeURIComponent($('trainingKeyword').value)}`;
  const data=await api('/api/training/schedule?'+q);
  if((!$('trainingStart').value||!$('trainingEnd').value)&&data.start){$('trainingStart').value=data.start;$('trainingEnd').value=data.end}
  allEvents = data.items;
  const groups=Object.values(groupTraining(data.items));
  $('trainingSummary').textContent=`${data.start} 至 ${data.end} · 共 ${data.items.length} 场 · 来源：${data.bounds.source||'未找到排班表'}`;
  $('trainingList').innerHTML=groups.length?groups.map(day=>`<section class="training-day"><div class="training-date"><b>${day.date}</b><span>${esc(day.weekday)}</span></div><div class="training-events">${day.items.map(x=>`<article class="${x.edited?'training-edited':''}"><div class="training-time">${esc(x.time)}<small>${esc(x.period)}</small></div><div><h3>${esc(x.title)}</h3><p>${x.items.map(i=>`<span>${esc(i)}</span>`).join('')}</p></div><button class="training-edit-btn" onclick="openPasswordModal('${esc(x.id)}')" title="编辑">&#9998;</button></article>`).join('')}</div></section>`).join(''):`<div class="panel notice">当前日期范围没有培训安排，可调整日期或关键词再查。</div>`;
}

async function init(){const [s,e]=trainingWeekRange();$('trainingStart').value=s;$('trainingEnd').value=e;await loadTraining()}
init().catch(e=>toast(e.message));
