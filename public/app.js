let meta={}, people=[], stats=[], hazardStats=null, categoryStats=null, hazardPage=1, hazardPages=1;
const $=id=>document.getElementById(id);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const api=async(url,options={})=>{const r=await fetch(url,options);const data=await r.json();if(!r.ok)throw new Error(data.error||'请求失败');return data};
function toast(message){$('toast').textContent=message;$('toast').classList.add('show');setTimeout(()=>$('toast').classList.remove('show'),2600)}
const pageInfo={dashboard:['统计看板','隐患录入达标情况与单位对比'],hazards:['隐患列表','查询最新导入的全部隐患记录'],people:['人员与标准','维护人员分类、部门和考核标准'],imports:['数据更新','拖入最新安全隐患信息表，完整替换数据快照']};
function showPage(id){document.querySelectorAll('.page').forEach(x=>x.classList.toggle('active',x.id===id));document.querySelectorAll('nav button').forEach(x=>x.classList.toggle('active',x.dataset.page===id));[$('pageTitle').textContent,$('pageSub').textContent]=pageInfo[id];if(id==='hazards')loadHazards(1);if(id==='people')loadPeople()}
document.querySelectorAll('nav button').forEach(b=>b.onclick=()=>showPage(b.dataset.page));
function dates(){return `start=${$('startDate').value}&end=${$('endDate').value}`}
function hazardDates(){return `start=${$('hazardStartDate').value}&end=${$('hazardEndDate').value}`}
function isoLocal(d){return d.toISOString().slice(0,10)}
function dateRange(kind){const now=new Date(),start=new Date(now),end=new Date(now);if(kind==='yesterday'){start.setDate(start.getDate()-1);end.setDate(end.getDate()-1)}else if(kind==='week'){const day=start.getDay()||7;start.setDate(start.getDate()-day+1)}else if(kind==='month'){start.setDate(1)}return [isoLocal(start),isoLocal(end)]}
function setDateRange(kind,target='dashboard'){const [start,end]=dateRange(kind);if(target==='hazards'){$('hazardStartDate').value=start;$('hazardEndDate').value=end;loadHazards(1)}else{$('startDate').value=start;$('endDate').value=end;loadStatistics()}}
async function init(){meta=await api('/api/meta');const today=new Date().toISOString().slice(0,10);$('endDate').value=today;$('startDate').value=today;$('hazardEndDate').value=today;$('hazardStartDate').value=today;fillFilters();renderMeta();await loadStatistics()}
function fillFilters(){const fill=(id,items,label)=>{$(id).innerHTML=`<option value="">${label}</option>`+items.map(x=>`<option>${esc(x)}</option>`).join('')};fill('categoryFilter',meta.categories,'全部种类');fill('departmentFilter',meta.departments,'全部部门');$('categories').innerHTML=meta.categories.map(x=>`<option>${esc(x)}</option>`).join('');$('departments').innerHTML=[...new Set([...meta.defaultDepartments,...meta.departments])].map(x=>`<option>${esc(x)}</option>`).join('')}
function parseFileTime(fn){if(!fn)return'';const nums=fn.match(/\d+/g);if(!nums)return'';const n=nums.filter(x=>x.length>=8).sort((a,b)=>b.length-a.length)[0]||nums[0];if(!n)return'';if(n.length>=14)return`${n.slice(0,4)}-${n.slice(4,6)}-${n.slice(6,8)} ${n.slice(8,10)}:${n.slice(10,12)}`;if(n.length>=8)return`${n.slice(0,4)}-${n.slice(4,6)}-${n.slice(6,8)}`;return n}
function renderMeta(){const b=meta.bounds,imp=meta.lastImport,ft=parseFileTime(imp?.filename);const t=ft?` · 更新于 ${ft}`:'';$('dataState').textContent=`${b.count.toLocaleString()} 条 · ${b.max||'暂无日期'}${t}`;$('headerUpdateTime').textContent=ft?`数据更新：${ft}`:'';$('headerUpdateTime').style.display=ft?'':'none';$('updateNote').textContent=ft?'（如数据过时请在ics系统导出缺失数据并导入系统，共同维护系统）':'';$('importInfo').textContent=imp?`${imp.filename} · ${imp.row_count.toLocaleString()} 条 · ${imp.min_date} 至 ${imp.max_date} · 更新于 ${ft}`:'尚未导入数据';$('datasetTypes').innerHTML=(meta.datasetTypes||[]).map(x=>`<div class="dataset-type"><b>${esc(x.label)}</b><div><code>${esc(x.filenameExample)}</code><small>${esc(x.description)}</small></div></div>`).join('')}
async function loadStatistics(){const q=`${dates()}&category=${encodeURIComponent($('categoryFilter').value)}&department=${encodeURIComponent($('departmentFilter').value)}`;const data=await api('/api/statistics?'+q);stats=data.people;const c=data.comparison,total=c.internal+c.external,ratio=c.ratio===null?'∞ : 1':`${c.ratio} : 1`;$('internalCount').textContent=c.internal.toLocaleString();$('externalCount').textContent=c.external.toLocaleString();$('ratioCount').textContent=ratio;$('ratioBadge').textContent=c.met?'符合比例要求':'未达到比例要求';$('ratioBadge').className='badge '+(c.met?'':'bad');const max=Math.max(c.internal,c.external,1);$('internalBar').style.width=`${c.internal/max*100}%`;$('externalBar').style.width=`${c.external/max*100}%`;$('internalBarText').textContent=`${c.internal} 条`;$('externalBarText').textContent=`${c.external} 条`;const met=stats.filter(x=>x.met).length,rate=stats.length?Math.round(met/stats.length*100):0;$('metRate').textContent=rate+'%';$('metSummary').textContent=`${met} / ${stats.length} 人达标`;$('metCount').textContent=met;$('unmetCount').textContent=stats.length-met;$('donutText').textContent=rate+'%';$('donut').style.background=`conic-gradient(var(--green) ${rate}%,#e9efed ${rate}%)`;renderStats()}
const exportData=new Map();
function exportGroupImage(key){const d=exportData.get(key);if(!d)return;const c=document.createElement('canvas'),ctx=c.getContext('2d'),px=24,py=16,rowH=32,headH=34,titleH=46,noteH=20;ctx.font='14px "Microsoft YaHei",sans-serif';const colW=d.headers.map((h,i)=>{let w=ctx.measureText(h).width;d.rows.forEach(r=>{w=Math.max(w,ctx.measureText(String(r[i]||'')).width)});return Math.ceil(w)+24});const tw=colW.reduce((a,b)=>a+b,0),th=py*2+titleH+noteH+headH+d.rows.length*rowH,cw=tw+px*2;c.width=cw;c.height=th;ctx.fillStyle='#fff';ctx.fillRect(0,0,cw,th);ctx.font='bold 18px "Microsoft YaHei",sans-serif';ctx.fillStyle='#17312f';ctx.fillText(`${d.title} · ${d.dateRange}`,px,py+24);ctx.font='12px "Microsoft YaHei",sans-serif';ctx.fillStyle='#72817f';ctx.fillText(d.note,px,py+titleH-6);let y=py+titleH+noteH;ctx.fillStyle='#f7f9f8';ctx.fillRect(0,y,cw,headH);ctx.font='bold 13px "Microsoft YaHei",sans-serif';ctx.fillStyle='#657875';let x=px;d.headers.forEach((h,i)=>{ctx.fillText(h,x+8,y+23);x+=colW[i]});y+=headH;ctx.font='14px "Microsoft YaHei",sans-serif';d.rows.forEach(row=>{ctx.fillStyle=row[row.length-1]==='已达标'?'#e7f5f0':'#fdecec';ctx.fillRect(0,y,cw,rowH);ctx.fillStyle='#17312f';x=px;row.forEach((cell,i)=>{ctx.fillText(String(cell??''),x+8,y+23);x+=colW[i]});ctx.strokeStyle='#edf1f0';ctx.beginPath();ctx.moveTo(0,y+rowH);ctx.lineTo(cw,y+rowH);ctx.stroke();y+=rowH});const a=document.createElement('a');a.download=`${d.title}_${d.dateRange}.png`;a.href=c.toDataURL('image/png');a.click()}
function orderKey(group){return `hazard_people_order_${group}`}
function getSavedOrder(group){try{return JSON.parse(localStorage.getItem(orderKey(group))||'[]')}catch{return []}}
function saveOrder(group,names){localStorage.setItem(orderKey(group),JSON.stringify(names));toast(`${group}排序已保存`)}
function resetGroupOrder(group){localStorage.removeItem(orderKey(group));renderStats();toast(`${group}已恢复默认排序`)}
function defaultSortPeople(group,items){
  const safetyTop=['果机吃沙','龚天顺','刘友三'];
  return [...items].sort((a,b)=>{
    if(group==='安全员'){
      const ai=safetyTop.indexOf(a.name),bi=safetyTop.indexOf(b.name);
      if(ai!==-1||bi!==-1)return (ai===-1?999:ai)-(bi===-1?999:bi);
    }
    if(group==='班组长和驻场代表'&&a.category!==b.category){
      return a.category==='班组长'?-1:1;
    }
    return (a.department||'').localeCompare(b.department||'','zh-Hans')||a.name.localeCompare(b.name,'zh-Hans');
  });
}
function applySavedOrder(group,items){
  const order=getSavedOrder(group);
  if(!order.length)return items;
  const rank=new Map(order.map((name,i)=>[name,i]));
  return [...items].sort((a,b)=>{
    const ai=rank.has(a.name)?rank.get(a.name):99999;
    const bi=rank.has(b.name)?rank.get(b.name):99999;
    return ai-bi;
  });
}
function enableGroupDrag(group){
  const tbody=document.querySelector(`tbody[data-group="${CSS.escape(group)}"]`);
  if(!tbody)return;
  let dragging=null;
  tbody.querySelectorAll('tr[data-name]').forEach(row=>{
    row.addEventListener('dragstart',()=>{dragging=row;row.classList.add('dragging')});
    row.addEventListener('dragend',()=>{row.classList.remove('dragging');dragging=null;saveOrder(group,[...tbody.querySelectorAll('tr[data-name]')].map(r=>r.dataset.name));renderStats()});
    row.addEventListener('dragover',e=>{
      e.preventDefault();
      const target=e.currentTarget;
      if(!dragging||dragging===target)return;
      const rect=target.getBoundingClientRect();
      const after=e.clientY>rect.top+rect.height/2;
      tbody.insertBefore(dragging,after?target.nextSibling:target);
    });
  });
}
function renderStats(){
  const start=$('startDate').value,end=$('endDate').value,dateRange=`${start} 至 ${end}`;
  const groups=[
    {title:'安全员',roles:['安全员'],note:'标准：10 条 / 天'},
    {title:'班组长和驻场代表',roles:['班组长','驻场代表'],note:'班组长 2 条 / 天 · 驻场代表 3 条 / 周'},
    {title:'执行岗以上',roles:['执行岗及以上'],note:'标准：5 条 / 周'}
  ];
  $('statsGroups').innerHTML=groups.map(g=>{
    let items=stats.filter(x=>g.roles.includes(x.category));
    items=applySavedOrder(g.title,defaultSortPeople(g.title,items));
    const isSafetyGroup=g.title==='安全员';
    const isExecGroup=g.title==='执行岗以上';
    const headers=isSafetyGroup?['拖动','姓名','录入标准','实际录入','B级隐患','状态']:(isExecGroup?['拖动','部门','姓名','录入标准','实际录入','状态']:['拖动','人员类型','姓名','录入标准','实际录入','状态']);
    const std=x=>`${x.periodTarget} 条`;
    const displayDept=x=>x.department||x.category||'—';
    const expRows=items.map(x=>{
      const row=[];
      if(isExecGroup)row.push(displayDept(x));
      if(!isSafetyGroup&& !isExecGroup)row.push(x.category);
      row.push(x.name,std(x),`${x.count} 条`);
      if(isSafetyGroup)row.push(String(x.bCount));
      row.push(x.met?'已达标':'未达标');
      return row;
    });
    const htmlRows=items.map(x=>{
      const bCell=isSafetyGroup?`<td>${x.bCount}</td>`:'';
      const deptCell=isExecGroup?`<td>${esc(displayDept(x))}</td>`:'';
      const typeCell=(!isSafetyGroup&&!isExecGroup)?`<td>${esc(x.category)}</td>`:'';
      return `<tr draggable="true" data-name="${esc(x.name)}" class="${x.met?'row-met':'row-unmet'}"><td class="drag-handle" title="拖动调整顺序">⋮⋮</td>${deptCell}${typeCell}<td><b>${esc(x.name)}</b></td><td>${std(x)}</td><td><b>${x.count}</b> 条</td>${bCell}<td>${x.met?'已达标':'未达标'}</td></tr>`;
    }).join('');
    exportData.set(g.title,{title:g.title,note:g.note,dateRange,headers:headers.slice(1),rows:expRows});
    return `<section class="score-group"><div class="score-heading"><div><h3>${g.title}</h3><small>${g.note} · 可拖动人员行调整顺序</small></div><div class="score-heading-right"><b>${items.filter(x=>x.met).length} / ${items.length} 达标</b><button class="btn-sm" onclick="resetGroupOrder('${g.title}')">恢复默认排序</button><button class="btn-sm" onclick="exportGroupImage('${g.title}')">导出图片</button></div></div><div class="table-wrap"><table><thead><tr>${headers.map(h=>`<th>${h}</th>`).join('')}</tr></thead><tbody data-group="${esc(g.title)}">${htmlRows||`<tr><td colspan="${headers.length}">当前筛选下暂无人员</td></tr>`}</tbody></table></div></section>`;
  }).join('');
  groups.forEach(g=>enableGroupDrag(g.title));
}
async function loadHazardStats(){const q=`${hazardDates()}&search=${encodeURIComponent($('hazardSearch').value)}&unit=${encodeURIComponent($('unitFilter').value)}`;hazardStats=await api('/api/hazards/stats?'+q);const c=hazardStats;$('hzBCount').textContent=`共 ${(c.bHazards||[]).length} 条`;$('hzBBody').innerHTML=(c.bHazards||[]).length?c.bHazards.map(x=>`<tr><td>${x.check_date}</td><td>${esc(x.checker_name)}</td><td>${esc(x.description)}</td></tr>`).join(''):'<tr><td colspan="3">当前筛选下无 B 级隐患</td></tr>';const bInternal=c.bInternal||0,bExternal=c.bExternal||0,bTotal=bInternal+bExternal;$('rectificationRate').textContent='隐患整改率 '+c.rectificationRate+'%（'+c.rectificationCount+'/'+c.total+'）';if(bTotal>0){const ip=Math.round(bInternal/bTotal*100),ep=100-ip;$('hzBBlue').style.width=`${ip}%`;$('hzBRed').style.width=`${ep}%`;$('hzBInternal').textContent=`${bInternal} 条`;$('hzBExternal').textContent=`${bExternal} 条`;$('hzBRatioText').textContent=`中建二局 ${ip}% · 工程公司 ${ep}%`}else{$('hzBBlue').style.width='0%';$('hzBRed').style.width='0%';$('hzBInternal').textContent='—';$('hzBExternal').textContent='—';$('hzBRatioText').textContent='暂无 B 级隐患'}try{await loadCategoryStats()}catch(e){console.error('category stats failed',e)}}
const HZ_COLORS=['#087b68','#e6a23c','#409eff','#c84d4d','#8b5cf6','#ec4899','#14b8a6','#f97316','#6366f1','#0ea5e9'];
function buildCatTree(cats){const major={};for(const c of cats){const segs=c.category.split('/');const m=segs[0]||'其他';const s=segs.length>1?segs.slice(1).join('/'):m;if(!major[m])major[m]={name:m,total:0,internal:0,external:0,subs:{}};major[m].total+=c.total;major[m].internal+=c.internal;major[m].external+=c.external;if(!major[m].subs[s])major[m].subs[s]={name:s,total:0};major[m].subs[s].total+=c.total}return Object.values(major).sort((a,b)=>b.total-a.total)}
async function loadCategoryStats(){const q=`${hazardDates()}&search=${encodeURIComponent($('hazardSearch').value)}&unit=${encodeURIComponent($('unitFilter').value)}`;categoryStats=await api('/api/hazards/category-stats?'+q);renderCategoryDonut(categoryStats.categories);renderCategoryRank(categoryStats.categories)}
function renderCategoryDonut(cats){if(!cats||!cats.length){$('hzPie').style.background='#edf2f1';$('hzPieTotal').textContent='—';$('hzPieLegend').innerHTML='';return}
const tree=buildCatTree(cats);const total=tree.reduce((s,x)=>s+x.total,0);let grad=[],acc=0;const items=[];
tree.forEach((m,i)=>{const pct=m.total/total*100;const c=HZ_COLORS[i%HZ_COLORS.length];const start=acc;acc+=pct;grad.push(`${c} ${start}% ${acc}%`);items.push({name:m.name,total:m.total,pct:Math.round(pct),color:c})});
$('hzPie').style.background=`conic-gradient(${grad.join(',')})`;$('hzPieTotal').textContent=total.toLocaleString();
$('hzPieLegend').innerHTML=items.map(s=>`<span><i style="background:${s.color}"></i><b>${esc(s.name)}</b><em>${s.total} 条 · ${s.pct}%</em></span>`).join('')}
let popupTimer=null;
function showRankPopup(e,cat){clearTimeout(popupTimer);const p=$('hzPopup');popupTimer=setTimeout(async()=>{try{const data=await api(`/api/hazards/category-descriptions?${hazardDates()}&category=${encodeURIComponent(cat)}`);const items=(data.descriptions||[]).slice(0,15);if(!items.length){p.innerHTML='';return}const rect=e.target.closest('.rank-row').getBoundingClientRect();const panel=p.parentElement.getBoundingClientRect();p.style.top=(rect.top-panel.top-8)+'px';p.style.left=(rect.right-panel.left+12)+'px';p.innerHTML=`<div class="popup-head">${esc(cat)} · ${items.length} 条</div>`+items.map(x=>`<div class="popup-item"><span class="popup-date">${x.check_date}</span><span class="popup-lv ${(x.hazard_level||'').toLowerCase()}">${esc(x.hazard_level)}</span><span>${esc(x.description)}</span></div>`).join('');p.style.display='block'}catch(e){}},200)}
function hideRankPopup(){clearTimeout(popupTimer);popupTimer=setTimeout(()=>{$('hzPopup').style.display='none'},150)}
$('hzPopup').addEventListener('mouseenter',()=>clearTimeout(popupTimer));
$('hzPopup').addEventListener('mouseleave',()=>{$('hzPopup').style.display='none'});
function renderCategoryRank(cats){if(!cats||!cats.length){$('hzRankBars').innerHTML='<div class="notice">暂无数据</div>';return}
const filtered=cats.filter(x=>{const segs=x.category.split('/');const last=segs[segs.length-1];return last!=='其他'&&last!=='其它'&&x.category!=='所有其他'});
const max=Math.max(...filtered.map(x=>x.total),1);
$('hzRankBars').innerHTML=filtered.map((x,i)=>{const pct=x.total/max*100;const ci=i%HZ_COLORS.length;return`<div class="rank-row" onmouseenter="showRankPopup(event,'${esc(x.category).replace(/'/g,"\\'")}')" onmouseleave="hideRankPopup()"><span class="rank-label" title="${esc(x.category)}">${esc(x.category)}</span><span class="rank-track"><i style="width:${pct}%;background:${HZ_COLORS[ci]}"></i></span><b>${x.total}</b></div>`}).join('')}
async function loadHazards(page){if(page===1)await loadHazardStats();if(page<1||page>hazardPages)return;hazardPage=page;const data=await api(`/api/hazards?${hazardDates()}&page=${page}&search=${encodeURIComponent($('hazardSearch').value)}&unit=${encodeURIComponent($('unitFilter').value)}`);hazardPages=Math.max(1,Math.ceil(data.total/data.size));$('hazardTotal').textContent=`共 ${data.total.toLocaleString()} 条`;$('pageInfo').textContent=`第 ${data.page} / ${hazardPages} 页`;$('hazardBody').innerHTML=data.items.map(x=>`<tr><td>${x.check_date}</td><td>${esc(x.checker_name)}</td><td>${esc(x.check_unit||'—')}</td><td>${esc(x.hazard_category||'—')}</td><td title="${esc(x.description)}">${esc(x.description)}</td><td>${esc(x.area)}</td><td>${esc(x.status)}</td></tr>`).join('');if($('unitFilter').options.length===1)$('unitFilter').innerHTML='<option value="">全部单位</option>'+data.units.map(x=>`<option>${esc(x)}</option>`).join('')}
async function loadPeople(){const data=await api('/api/people');people=data.items;$('peopleBody').innerHTML=people.map(x=>`<tr><td>${esc(x.category)}</td><td>${esc(x.department||'—')}</td><td><b>${esc(x.name)}</b></td><td>${x.target_count} 条 / ${x.target_period==='day'?'日':'周'}</td><td>${x.active?'是':'否'}</td><td><button onclick="openPerson(${x.id})">编辑</button> <button onclick="deletePerson(${x.id})">删除</button></td></tr>`).join('')}
async function importPeopleFile(file){if(!file)return;const mode=$('peopleImportMode').value;const form=new FormData();form.append('file',file);form.append('mode',mode);$('peopleImportResult').textContent=`正在${mode==='overwrite'?'覆盖':'去重追加'}导入：${file.name}…`;try{const result=await api('/api/people/import',{method:'POST',body:form});$('peopleImportResult').textContent=`导入成功：识别 ${result.count} 人，新增 ${result.inserted}，更新 ${result.updated}；表：${result.source.sheet} 第 ${result.source.headerRow} 行`;toast('人员导入成功');await loadPeople();meta=await api('/api/meta');fillFilters();await loadStatistics()}catch(err){$('peopleImportResult').textContent='导入失败：'+err.message;toast(err.message)}finally{$('peopleImportInput').value=''}}
function trainingWeekRange(base=new Date()){const d=new Date(base);const day=d.getDay()||7;d.setDate(d.getDate()-day+1);const start=d.toISOString().slice(0,10);d.setDate(d.getDate()+6);return [start,d.toISOString().slice(0,10)]}
async function initTraining(){if(!$('trainingStart').value||!$('trainingEnd').value){const [s,e]=trainingWeekRange();$('trainingStart').value=s;$('trainingEnd').value=e}await loadTraining()}
function setTrainingThisWeek(){const [s,e]=trainingWeekRange();$('trainingStart').value=s;$('trainingEnd').value=e;loadTraining()}
function groupTraining(items){return items.reduce((acc,x)=>{(acc[x.date] ||= {date:x.date,weekday:x.weekday,items:[]}).items.push(x);return acc},{})}
async function loadTraining(){const q=`start=${$('trainingStart').value}&end=${$('trainingEnd').value}&keyword=${encodeURIComponent($('trainingKeyword').value)}`;const data=await api('/api/training/schedule?'+q);if((!$('trainingStart').value||!$('trainingEnd').value)&&data.start){$('trainingStart').value=data.start;$('trainingEnd').value=data.end}const groups=Object.values(groupTraining(data.items));$('trainingSummary').textContent=`${data.start} 至 ${data.end} · 共 ${data.items.length} 场 · 来源：${data.bounds.source||'未找到排班表'}`;$('trainingList').innerHTML=groups.length?groups.map(day=>`<section class="training-day"><div class="training-date"><b>${day.date}</b><span>${esc(day.weekday)}</span></div><div class="training-events">${day.items.map(x=>`<article><div class="training-time">${esc(x.time)}<small>${esc(x.period)}</small></div><div><h3>${esc(x.title)}</h3><p>${x.items.map(i=>`<span>${esc(i)}</span>`).join('')}</p></div></article>`).join('')}</div></section>`).join(''):`<div class="panel notice">当前日期范围没有培训安排，可调整日期或关键词再查。</div>`}
function openPerson(id){const x=people.find(p=>p.id===id)||{active:1,target_count:5,target_period:'week'};$('personDialogTitle').textContent=id?'编辑人员':'添加人员';$('personId').value=x.id||'';$('personName').value=x.name||'';$('personCategory').value=x.category||'';$('personDepartment').value=x.department||'';$('personTarget').value=x.target_count;$('personPeriod').value=x.target_period;$('personActive').checked=!!x.active;$('personDialog').showModal()}
async function savePerson(e){e.preventDefault();const body={id:$('personId').value||null,name:$('personName').value,category:$('personCategory').value,department:$('personDepartment').value,target_count:$('personTarget').value,target_period:$('personPeriod').value,active:$('personActive').checked};try{await api('/api/people',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});$('personDialog').close();toast('人员标准已保存');await loadPeople();meta=await api('/api/meta');fillFilters()}catch(err){toast(err.message)}}
async function deletePerson(id){if(!confirm('确定删除这名人员及其标准吗？'))return;await api('/api/people/'+id,{method:'DELETE'});toast('已删除');loadPeople()}
const drop=$('dropZone'),fileInput=$('fileInput');['dragenter','dragover'].forEach(e=>drop.addEventListener(e,x=>{x.preventDefault();drop.classList.add('drag')}));['dragleave','drop'].forEach(e=>drop.addEventListener(e,x=>{x.preventDefault();drop.classList.remove('drag')}));drop.addEventListener('drop',e=>prepareFile(e.dataTransfer.files[0]));fileInput.addEventListener('change',()=>prepareFile(fileInput.files[0]));
$('peopleImportInput').addEventListener('change',()=>importPeopleFile($('peopleImportInput').files[0]));
function recognizeFile(file){if(!file)return null;const hazard=/^安全隐患信息表_[0-9]{6,20}(?:\s*\([0-9]+\))?\.xlsx$/i;if(hazard.test(file.name))return {id:'hazard_entry',label:'隐患录入统计'};return null}
function prepareFile(file){if(!file)return;const type=recognizeFile(file);$('fileRecognition').textContent=type?`已识别：${type.label} · ${file.name}`:`无法识别：${file.name}`;$('fileRecognition').className='file-recognition '+(type?'good':'bad');if(!type){$('importResult').textContent='文件未上传。请确认文件名符合下方已支持的数据文件规则。';toast('无法识别这个文件名');return}uploadFile(file,type)}
async function uploadFile(file,type){const form=new FormData();form.append('file',file);$('importResult').textContent=`正在更新“${type.label}”：${file.name}，请稍候…`;try{const result=await api('/api/import',{method:'POST',body:form});$('importResult').textContent=`${result.datasetLabel}更新成功：${result.count.toLocaleString()} 条，日期 ${result.minDate} 至 ${result.maxDate}`;toast(`${result.datasetLabel}更新成功`);meta=await api('/api/meta');renderMeta();$('endDate').value=result.maxDate;await loadStatistics()}catch(err){$('importResult').textContent='导入失败：'+err.message;toast(err.message)}}
function downloadStats(){const rows=[['人员种类','部门/班组','姓名','实际录入','B级隐患','是否达标'],...stats.map(x=>[x.category,x.department,x.name,x.count,x.category==='安全员'?x.bCount:'',x.met?'是':'否'])];const csv='\ufeff'+rows.map(r=>r.map(v=>'"'+String(v??'').replaceAll('"','""')+'"').join(',')).join('\r\n');const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([csv],{type:'text/csv'}));a.download=`人员隐患统计_${$('startDate').value}_${$('endDate').value}.csv`;a.click();URL.revokeObjectURL(a.href)}
init().catch(e=>toast(e.message));

