import {localDate,localTime,localToIso,shiftLocalDate} from './dates.js';
const tg=window.Telegram?.WebApp;
tg?.ready();
tg?.expand();
const state={tasks:[],movingId:null};
const $=id=>document.getElementById(id);
const dateKey=date=>localDate(date,state.zone);
const inputValue=date=>dateKey(date)+'T'+localTime(date,state.zone);
const fromInput=value=>localToIso(...value.split('T'),state.zone);
function showError(message,id='error'){const el=$(id);el.hidden=!message;el.textContent=message||'';}
const keyboardTicket=new URLSearchParams(location.hash.slice(1)).get('keyboard') || window.Telegram?.WebView?.initParams?.keyboard;
function authHeaders() {
  if (tg?.initData) return {'X-Telegram-Init-Data':tg.initData};
  if (!keyboardTicket) throw new Error('Открой приложение из личного чата с ботом.');
  let device=localStorage.getItem('taskKeyboardDevice');
  if (!device) {
    device=Array.from(crypto.getRandomValues(new Uint8Array(32)),byte=>byte.toString(16).padStart(2,'0')).join('');
    localStorage.setItem('taskKeyboardDevice',device);
  }
  return {'X-Keyboard-Ticket':keyboardTicket,'X-Keyboard-Device':device};
}
async function request(path,options={}) {
  const response=await fetch(path,{
    ...options,
    headers:{'Content-Type':'application/json',...authHeaders(),...options.headers}
  });
  const json=await response.json().catch(()=>({}));
  if(response.status===401 && keyboardTicket)throw new Error('Обнови кнопки командой /start и открой приложение ещё раз на этом устройстве.');
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
  $('move-task-title').textContent=task.title;
  $('move-error').hidden=true;
  const date=new Date(Date.now()+3600000);
  $('move-time').value=inputValue(date);
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
  const value=$('move-time').value;
  if(!value)return;
  try{reschedule(fromInput(value));}catch(error){showError(error.message,'move-error');}
};
function render() {
  const tasks=state.tasks.filter(task=>task.status==='active');
  const root=$('task-list');root.replaceChildren();
  if(!tasks.length){
    const empty=make('div','empty');
    empty.append(make('strong','','Пока нет активных задач'),make('span','','Нажми «Создать задачу», чтобы добавить дело.'));
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
    meta.append(make('span','',task.category),badge,make('span','',formatDue(task.due_at)));
    if(task.progress_count)meta.append(make('span','','Прогресс: '+task.progress_count));
    content.append(meta);
    item.append(check,content);
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
  try{const data=await request('/api/tasks');state.zone=data.timeZone;$('zone').textContent='Часовой пояс · '+state.zone;$('add-button').disabled=false;state.tasks=data.tasks;showError('');render();return true;}
  catch(e){showError(e.message);}
}
const dialog=$('task-dialog');
function openCreateForm(){
  $('task-form').reset();
  const initial=new Date(Date.now()+3600000);
  $('schedule').hidden=false;
  $('day').disabled=false;
  $('time').disabled=false;
  $('day').value=dateKey(initial);
  $('time').value=localTime(initial,state.zone);
  $('day').min=dateKey(new Date());
  showError('','form-error');
  dialog.showModal();
}
$('add-button').onclick=openCreateForm;
$('close-dialog').onclick=()=>dialog.close();
$('remind').onchange=()=>{
  $('schedule').hidden=!$('remind').checked;
  $('day').disabled=$('time').disabled=!$('remind').checked;
};
$('task-form').onsubmit=async event=>{
  event.preventDefault();
  const title=$('title').value.trim();
  const submit=event.submitter || $('task-form').querySelector('button[type=submit]');
  if(submit.disabled) return;
  submit.disabled=true;
  try {
    const when=$('remind').checked?localToIso($('day').value,$('time').value,state.zone):null;
    const recurrence=when && $('weekly').checked?'weekly':null;
    await request('/api/tasks',{method:'POST',body:JSON.stringify({title,due_at:when,recurrence,priority:$('task-form').elements.priority.value})});
    dialog.close();await refresh();
  } catch(e){showError(e.message,'form-error');} finally {submit.disabled=false;}
};
$('add-button').disabled=true;
refresh().then(loaded=>{
  if (loaded && new URLSearchParams(location.search).get('view')==='create') openCreateForm();
});
