import {localDate,localTime,localToIso,shiftLocalDate} from './dates.js';
import {dateTimePicker} from './diary-picker.js';
const tg=window.Telegram?.WebApp;
tg?.ready();
tg?.expand();
const state={tasks:[],movingId:null,day:null};
let launchCreate=new URLSearchParams(location.search).get('view')==='create';
const $=id=>document.getElementById(id);
const dateKey=date=>localDate(date,state.zone);
const createWhen=dateTimePicker($('create-when'));
const moveWhen=dateTimePicker($('move-when'));
function showError(message,id='error'){const el=$(id);el.hidden=!message;el.textContent=message||'';}
const keyboardTicket=new URLSearchParams(location.hash.slice(1)).get('keyboard') || window.Telegram?.WebView?.initParams?.keyboard;
function deviceKey() {
  let device=localStorage.getItem('taskKeyboardDevice');
  if (!device) {
    device=Array.from(crypto.getRandomValues(new Uint8Array(32)),byte=>byte.toString(16).padStart(2,'0')).join('');
    localStorage.setItem('taskKeyboardDevice',device);
  }
  return device;
}
function authHeaders() {
  if (new URLSearchParams(tg?.initData).has('user')) return {'X-Telegram-Init-Data':tg.initData};
  if (keyboardTicket) return {'X-Keyboard-Ticket':keyboardTicket,'X-Keyboard-Device':deviceKey()};
  if (tg?.initData) return {'X-Telegram-Init-Data':tg.initData};
  throw new Error('Открой приложение из личного чата с ботом.');
}
async function hashForConfirmation(value) {
  const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes),byte=>byte.toString(16).padStart(2,'0')).join('');
}
$('confirm-device').onclick=async()=>{
  try {
    const ticketHash=await hashForConfirmation(keyboardTicket);
    const deviceHash=await hashForConfirmation(deviceKey());
    tg.sendData(JSON.stringify({type:'confirm-keyboard',ticketHash,deviceHash,view:launchCreate?'create':'list'}));
  } catch {showError('Не удалось отправить подтверждение. Закрой окно и снова нажми кнопку в чате.');}
};
async function request(path,options={}) {
  const response=await fetch(path,{
    ...options,
    headers:{'Content-Type':'application/json',...authHeaders(),...options.headers}
  });
  const json=await response.json().catch(()=>({}));
  if(response.status===401 && keyboardTicket && tg?.sendData){
    $('confirm-device').hidden=false;
    throw new Error('Подтверди вход с этого устройства через личный чат с ботом.');
  }
  if(!response.ok)throw new Error(json.error||'Ошибка сервера ('+response.status+')');
  return json;
}
const make=(tag,cls,text)=>{
  const el=document.createElement(tag);
  if(cls)el.className=cls;
  if(text!==undefined)el.textContent=text;
  return el;
};
const priorityLabels={low:'⚪ Не срочно',medium:'🟡 Обычно',high:'🔴 Важно'};
function priorityPicker(name, selected){
  const group=make('fieldset','priority-picker');
  group.append(make('legend','','Приоритет'));
  for(const [value,text] of Object.entries(priorityLabels)){
    const label=make('label');
    const input=make('input');
    input.type='radio';
    input.name=name;
    input.value=value;
    input.defaultChecked=value===selected;
    label.append(input,make('span','',text));
    group.append(label);
  }
  return group;
}
$('create-priority').append(priorityPicker('priority','medium'));
function formatDue(value){
  if(!value)return 'Без напоминания';
  return '◷ '+new Intl.DateTimeFormat('ru-RU',{timeZone:state.zone,day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'}).format(new Date(value));
}
async function doAction(id,action){
  try {await request('/api/tasks/'+id+'/'+action,{method:'POST'});await refresh();}
  catch(e){showError(e.message);}
}
async function complete(id){
  try {await request('/api/tasks/'+id+'/done',{method:'POST'});await refresh();}
  catch(e){showError(e.message);}
}
const moveDialog=$('move-dialog');
function openMove(id){
  const task=state.tasks.find(t=>t.id===id);
  if(!task)return;
  state.movingId=id;
  $('move-reason').value='unspecified';
  $('move-task-title').textContent=task.title;
  $('move-error').hidden=true;
  const date=new Date(Date.now()+3600000);
  moveWhen.reset(dateKey(date),localTime(date,state.zone),dateKey(new Date()));
  moveDialog.showModal();
}
async function reschedule(due_at){
  try {
    await request('/api/tasks/'+state.movingId+'/reschedule',{method:'POST',body:JSON.stringify({due_at,reason:$('move-reason').value})});
    moveDialog.close();await refresh();
  }catch(e){showError(e.message,'move-error');}
}
$('move-close').onclick=()=>moveDialog.close();
document.querySelectorAll('[data-minutes]').forEach(btn=>btn.onclick=()=>reschedule(new Date(Date.now()+Number(btn.dataset.minutes)*60000).toISOString()));
$('move-tomorrow').onclick=()=>{
  reschedule(localToIso(shiftLocalDate(dateKey(new Date()),1),'09:00',state.zone));
};
$('move-form').onsubmit=e=>{
  e.preventDefault();
  try{reschedule(localToIso(...moveWhen.value(),state.zone));}catch(error){showError(error.message,'move-error');}
};
function dayLabel(key,options){
  return new Intl.DateTimeFormat('ru-RU',{timeZone:'UTC',...options}).format(new Date(key+'T12:00:00Z'));
}
function render() {
  const today=dateKey(new Date());
  const tomorrow=shiftLocalDate(today,1);
  const active=state.tasks.filter(task=>task.status==='active');
  const taskDay=task=>task.due_at ? dateKey(new Date(task.due_at)) : 'none';
  const later=[...new Set(active.map(taskDay))].filter(key=>key>shiftLocalDate(today,2) && key!=='none').sort();
  const keys=[today,tomorrow,shiftLocalDate(today,2),'none',...later];
  if(!keys.includes(state.day))state.day=today;
  $('today-label').textContent=dayLabel(today,{weekday:'short',day:'numeric',month:'long'});
  const tabs=keys.map(key=>{
    const tab=make('button','day-tab');
    const undated=key==='none';
    tab.append(make('span','',undated?'Без даты':dayLabel(key,{weekday:'short'})),
      make('strong','',undated?'∞':dayLabel(key,key>shiftLocalDate(today,2)?{day:'numeric',month:'short'}:{day:'numeric'})));
    tab.setAttribute('aria-pressed',String(key===state.day));
    tab.setAttribute('aria-label',undated?'Без даты':dayLabel(key,{day:'numeric',month:'long',year:'numeric'}));
    tab.onclick=()=>{state.day=key;render();$('days').querySelector('[aria-pressed=true]').focus({preventScroll:true});};
    return tab;
  });
  $('days').replaceChildren(...tabs);
  $('days').querySelector('[aria-pressed=true]').scrollIntoView({block:'nearest',inline:'nearest'});
  $('day-heading').textContent=state.day==='none'?'Без даты':state.day===today?'Сегодня':state.day===tomorrow?'Завтра':dayLabel(state.day,{day:'numeric',month:'long'});
  const tasks=active.filter(task=>taskDay(task)===state.day || (state.day===today && taskDay(task)<today))
    .sort((a,b)=>(a.due_at||'').localeCompare(b.due_at||''));
  const root=$('task-list');root.replaceChildren();
  if(!tasks.length){
    const empty=make('div','empty');
    empty.append(make('strong','',state.day==='none'?'Нет задач без даты':'На этот день задач нет'),make('span','','Нажми «Создать задачу», чтобы добавить дело.'));
    root.append(empty);
  }
  const completed=state.tasks.filter(task=>task.status==='done')
    .sort((a,b)=>(b.completed_at || '').localeCompare(a.completed_at || ''));
  $('completed-tasks').hidden=completed.length===0;
  $('completed-count').textContent=String(completed.length);
  const completedList=$('completed-list');
  completedList.replaceChildren();
  for(const task of [...tasks,...completed]){
    const done=task.status==='done';
    const item=make('article','task'+(done?' done':''));
    const check=make('button','check-task',done?'✓':'');
    check.type='button';check.setAttribute('aria-label',done?'Выполнено':'Отметить выполненной');
    check.disabled=done;
    check.onclick=()=>complete(task.id);
    const content=make('div','task-content');
    content.append(make('div','task-name',task.title));
    const meta=make('div','meta');
    const badge=make('span','',priorityLabels[task.priority] || priorityLabels.medium);
    meta.append(make('span','',task.category),badge);
    if(done || (task.due_at && taskDay(task)<today))meta.append(make('span','', (done?'':'Просрочено · ')+formatDue(task.due_at)));
    if(task.progress_count)meta.append(make('span','','Прогресс: '+task.progress_count));
    content.append(meta);
    item.append(make('span','clock',task.due_at?localTime(new Date(task.due_at),state.zone):'—'),content,check);
    if(!done){
      const controls=make('div','task-actions');
      const begin=make('button','action-button','▶ Начинаю');
      begin.onclick=()=>doAction(task.id,'start');
      const progress=make('button','action-button','↗ Прогресс');
      progress.onclick=()=>doAction(task.id,'progress');
      const delay=make('button','action-button','↷ Перенести');
      delay.onclick=()=>openMove(task.id);
      const picker=priorityPicker('priority-'+task.id,task.priority);
      picker.onchange=async event=>{
        const priority=event.target.value;
        picker.disabled=true;
        try{
          const {task:updated}=await request('/api/tasks/'+task.id+'/priority',{method:'POST',body:JSON.stringify({priority})});
          task.priority=updated.priority;
          badge.textContent=priorityLabels[task.priority];
          showError('');
        }catch(e){
          picker.querySelector('input[value="'+task.priority+'"]').checked=true;
          showError(e.message);
        }finally{picker.disabled=false;}
      };
      controls.append(begin,progress,delay,picker);
      const details=make('details');
      details.append(make('summary','','Действия'),controls);
      content.append(details);
    }
    (done ? completedList : root).append(item);
  }
}
async function refresh(){
  try{const data=await request('/api/tasks');state.zone=data.timeZone;$('zone').textContent='Часовой пояс · '+state.zone;$('add-button').disabled=false;state.tasks=data.tasks;showError('');$('confirm-device').hidden=true;$('retry').hidden=true;render();if(launchCreate){launchCreate=false;openCreateForm();}return true;}
  catch(e){showError(e.message);$('retry').hidden=!$('confirm-device').hidden;}
}
$('retry').onclick=refresh;
const dialog=$('task-dialog');
function openCreateForm(){
  $('task-form').reset();
  const initial=new Date(Date.now()+3600000);
  $('schedule').hidden=false;
  createWhen.enable(true);
  const day=state.day && state.day!=='none' && state.day>dateKey(new Date()) ? state.day : dateKey(initial);
  createWhen.reset(day,localTime(initial,state.zone),dateKey(new Date()));
  if(state.day==='none'){ $('remind').checked=false;$('remind').onchange(); }
  showError('','form-error');
  dialog.showModal();
}
$('add-button').onclick=openCreateForm;
$('close-dialog').onclick=()=>dialog.close();
$('remind').onchange=()=>{
  $('schedule').hidden=!$('remind').checked;
  createWhen.enable($('remind').checked);
};
$('task-form').onsubmit=async event=>{
  event.preventDefault();
  const title=$('title').value.trim();
  const submit=event.submitter || $('task-form').querySelector('button[type=submit]');
  if(submit.disabled) return;
  submit.disabled=true;
  try {
    const when=$('remind').checked?localToIso(...createWhen.value(),state.zone):null;
    const recurrence=when && $('weekly').checked?'weekly':null;
    await request('/api/tasks',{method:'POST',body:JSON.stringify({title,due_at:when,recurrence,priority:$('task-form').elements.priority.value})});
    state.day=when?dateKey(new Date(when)):'none';
    dialog.close();await refresh();
  } catch(e){showError(e.message,'form-error');} finally {submit.disabled=false;}
};
$('add-button').disabled=true;
refresh();
