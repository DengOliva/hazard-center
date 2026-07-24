const $=id=>document.getElementById(id);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const api=async(url,opts)=>{const r=await fetch(url,opts);const data=await r.json();if(!r.ok)throw new Error(data.error||'请求失败');return data};
function toast(message){$('toast').textContent=message;$('toast').classList.add('show');setTimeout(()=>$('toast').classList.remove('show'),2600)}
function trainingWeekRange(base=new Date()){const d=new Date(base);const day=d.getDay()||7;d.setDate(d.getDate()-day+1);const start=d.toISOString().slice(0,10);d.setDate(d.getDate()+6);return [start,d.toISOString().slice(0,10)]}
function setTrainingThisWeek(){const [s,e]=trainingWeekRange();$('trainingStart').value=s;$('trainingEnd').value=e;loadTraining()}
function groupTraining(items){return items.reduce((acc,x)=>{(acc[x.date] ||= {date:x.date,weekday:x.weekday,items:[]}).items.push(x);return acc},{})}

/* ======== tab switching ======== */
document.querySelectorAll('.training-tabs .tab').forEach(btn=>{
  btn.addEventListener('click',()=>{
    document.querySelectorAll('.training-tabs .tab').forEach(b=>b.classList.remove('active'));
    btn.classList.add('active');
    document.querySelectorAll('.tab-panel').forEach(p=>p.classList.remove('active'));
    $('tab'+btn.dataset.tab.charAt(0).toUpperCase()+btn.dataset.tab.slice(1)).classList.add('active');
  });
});

/* ======== schedule (existing) ======== */
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
  $('editResetBtn').style.display = event.linked ? 'none' : '';
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
    materialsAdmin = true;
    $('materialsAddBtn').style.display = '';
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

async function openCreateTraining() {
  if (!await ensureMaterialsAdmin()) return;
  $('createTrainingDate').value = new Date().toISOString().slice(0, 10);
  $('createTrainingName').value = '';
  $('createTrainingTime').value = '19:30-21:00';
  $('createTrainingLocation').value = '';
  $('createTrainingInstructor').value = '';
  $('createTrainingAudience').value = '';
  $('createTrainingParticipantCount').value = '';
  $('createTrainingDescription').value = '';
  $('createTrainingModal').classList.add('show');
  $('createTrainingName').focus();
}

function closeCreateTraining() {
  $('createTrainingModal').classList.remove('show');
}

async function saveNewTraining() {
  const name = $('createTrainingName').value.trim();
  const trainingDate = $('createTrainingDate').value;
  if (!name) { toast('请输入培训名称'); return; }
  if (!trainingDate) { toast('请选择培训日期'); return; }
  try {
    await api('/api/training-ledger/events', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({
        password: editingPassword,
        name,
        training_date: trainingDate,
        description: $('createTrainingDescription').value.trim(),
        training_location: $('createTrainingLocation').value.trim(),
        instructor: $('createTrainingInstructor').value.trim(),
        audience: $('createTrainingAudience').value.trim(),
        participant_count: parseInt($('createTrainingParticipantCount').value) || 0,
        schedule_time: $('createTrainingTime').value.trim() || '19:30-21:00',
        schedule_period: '晚上',
      }),
    });
    closeCreateTraining();
    $('trainingStart').value = trainingDate;
    $('trainingEnd').value = trainingDate;
    await loadTraining();
    toast('培训已新增，并同步到培训台账');
  } catch (e) {
    toast(e.message);
  }
}

async function loadTraining(){
  const q=`start=${$('trainingStart').value}&end=${$('trainingEnd').value}&keyword=${encodeURIComponent($('trainingKeyword').value)}`;
  const data=await api('/api/training/schedule?'+q);
  if((!$('trainingStart').value||!$('trainingEnd').value)&&data.start){$('trainingStart').value=data.start;$('trainingEnd').value=data.end}
  allEvents = data.items;
  const groups=Object.values(groupTraining(data.items));
  $('trainingSummary').textContent=`${data.start} 至 ${data.end} · 共 ${data.items.length} 场 · 来源：${data.bounds.source||'未找到排班表'}`;
  $('trainingList').innerHTML=groups.length?groups.map(day=>`<section class="training-day"><div class="training-date"><b>${day.date}</b><span>${esc(day.weekday)}</span></div><div class="training-events">${day.items.map(x=>`<article class="${x.edited?'training-edited':''}"><div class="training-time">${esc(x.time)}<small>${esc(x.period)}</small></div><div><h3>${esc(x.title)}</h3><p>${x.items.map(i=>`<span>${esc(i)}</span>`).join('')}${x.linked ? `<span>对象：${esc(x.audience||'未填写')}</span><span>地点：${esc(x.training_location||'未填写')}</span><span>讲师：${esc(x.instructor||'未填写')}</span><span>人数：${esc(x.participant_count||0)}人</span>` : ''}</p></div><button class="training-edit-btn" onclick="openPasswordModal('${esc(x.id)}')" title="编辑">&#9998;</button></article>`).join('')}</div></section>`).join(''):`<div class="panel notice">当前日期范围没有培训安排，可调整日期或关键词再查。</div>`;
}

/* ======== materials ======== */
let materialsAdmin = false;
let materialsData = [];
let materialCategories = [];

async function verifyMaterialsPassword() {
  if (materialsAdmin) return true;
  const pwd = prompt('请输入管理密码');
  if (!pwd) return false;
  try {
    await api('/api/training/verify', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({password: pwd}),
    });
    materialsAdmin = true;
    editingPassword = pwd;
    $('materialsAddBtn').style.display = '';
    return true;
  } catch (e) {
    toast(e.message);
    return false;
  }
}

async function ensureMaterialsAdmin() {
  if (materialsAdmin) return true;
  return await verifyMaterialsPassword();
}

async function loadMaterials() {
  const cat = $('materialCategoryFilter').value;
  const q = cat ? '?category=' + encodeURIComponent(cat) : '';
  const data = await api('/api/training/materials' + q);
  materialsData = data.items;
  materialCategories = data.categories || [];
  renderMaterials();
  if (!$('materialCategoryFilter').options.length || $('materialCategoryFilter').options.length !== materialCategories.length + 1) {
    $('materialCategoryFilter').innerHTML = '<option value="">全部分类</option>' + materialCategories.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join('');
  }
}

function renderMaterials() {
  if (!materialsData.length) {
    $('materialsContent').innerHTML = '<div class="material-empty">暂无培训资料，点击「添加资料」开始录入。</div>';
    return;
  }
  const groups = {};
  for (const m of materialsData) {
    (groups[m.category] ||= []).push(m);
  }
  let html = '<div class="materials-list">';
  for (const [cat, items] of Object.entries(groups)) {
    html += `<div class="panel"><h2 style="margin:0 0 14px;font-size:18px">${esc(cat)}</h2>`;
    for (const m of items) {
      html += `<div class="material-card">
        <div class="material-header">
          <h3>${esc(m.title)}</h3>
          <div class="material-meta">
            <span class="material-cat">${esc(m.category)}</span>
            ${materialsAdmin ? `<button class="training-edit-btn" onclick="openMaterialEdit('${esc(m.id)}')" title="编辑">&#9998;</button>` : ''}
          </div>
        </div>
        <div class="material-body">${esc(m.content)}</div>
      </div>`;
    }
    html += '</div>';
  }
  html += '</div>';
  $('materialsContent').innerHTML = html;
}

function openMaterialEdit(id) {
  if (!materialsAdmin) { ensureMaterialsAdmin().then(ok => { if (ok) openMaterialEdit(id); }); return; }
  if (id) {
    const m = materialsData.find(x => x.id === id);
    if (!m) return;
    $('materialEditId').value = m.id;
    $('materialEditTitle').textContent = '编辑资料';
    $('materialEditCategory').value = m.category;
    $('materialEditName').value = m.title;
    $('materialEditContent').value = m.content;
    $('materialEditSort').value = m.sort || 0;
    $('materialDeleteBtn').style.display = '';
  } else {
    $('materialEditId').value = '';
    $('materialEditTitle').textContent = '添加资料';
    $('materialEditCategory').value = materialCategories[0] || '其他';
    $('materialEditName').value = '';
    $('materialEditContent').value = '';
    $('materialEditSort').value = '0';
    $('materialDeleteBtn').style.display = 'none';
  }
  if (!$('materialEditCategory').options.length) {
    $('materialEditCategory').innerHTML = materialCategories.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join('');
  }
  $('materialEditModal').classList.add('show');
}

function closeMaterialEditModal() {
  $('materialEditModal').classList.remove('show');
}

async function saveMaterial() {
  const id = $('materialEditId').value;
  const body = {
    id: id || undefined,
    password: editingPassword,
    category: $('materialEditCategory').value,
    title: $('materialEditName').value.trim(),
    content: $('materialEditContent').value.trim(),
    sort: parseInt($('materialEditSort').value) || 0,
  };
  if (!body.title) { toast('请输入标题'); return; }
  try {
    await api('/api/training/materials/save', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify(body),
    });
    closeMaterialEditModal();
    await loadMaterials();
    toast(id ? '已保存' : '已添加');
  } catch (e) {
    toast(e.message);
  }
}

async function deleteMaterial() {
  const id = $('materialEditId').value;
  if (!id || !confirm('确定要删除这条资料吗？')) return;
  try {
    await api('/api/training/materials/delete', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({id, password: editingPassword}),
    });
    closeMaterialEditModal();
    await loadMaterials();
    toast('已删除');
  } catch (e) {
    toast(e.message);
  }
}

$('materialDeleteBtn').addEventListener('click', deleteMaterial);

$('materialsAddBtn').addEventListener('click', async () => {
  if (!await ensureMaterialsAdmin()) return;
  openMaterialEdit();
});

/* init */
async function init(){
  const [s,e]=trainingWeekRange();
  $('trainingStart').value=s;
  $('trainingEnd').value=e;
  await loadTraining();
  await loadMaterials();
}

init().catch(e=>toast(e.message));
