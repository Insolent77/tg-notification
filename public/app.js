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
async function request(path,options={}) {
  if(!tg?.initData)throw new Error('Закрой это окно, отправь боту /start и нажми «📋 Мои задачи» под новым сообщением.');
  const response=await fetch(path,{
    ...options,
    headers:{'Content-Type':'application/json','X-Telegram-Init-Data':tg.initData,...options.headers}
  });
  const json=await response.json().catch(()=>({}));
  if(!response.ok)throw new Error(json.error||'Ошибка сервера ('+response.status+')');
  return json;
}
const make=(tag,cls,text)=>{
  const el=document.createElement(tag);
  if(cls)el.className=cls;
  if(text!==undefined)el.textContent=text;
  return el;
};
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
    root.append(empty);return;
  }
  for(const task of tasks){
    const done=task.status==='done';
    const item=make('article','task'+(done?' done':''));
    const check=make('button','check-task',done?'✓':'');
    check.type='button';check.setAttribute('aria-label',done?'Выполнено':'Отметить выполненной');
    check.disabled=done;
    check.onclick=()=>complete(task.id);
    const content=make('div','task-content');
    content.append(make('div','task-name',task.title));
    const meta=make('div','meta');
    const priorityName={high:'🔴 Важно',medium:'🟡 Обычно',low:'⚪ Не срочно'}[task.priority]||'🟡 Обычно';
    meta.append(make('span','',task.category),make('span','',priorityName),make('span','',formatDue(task.due_at)));
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
      const select=make('select','priority-select');
      [['high','🔴 Важно'],['medium','🟡 Обычно'],['low','⚪ Не срочно']].forEach(([value,label])=>{
        const option=make('option','',label);option.value=value;select.append(option);
      });
      select.value=task.priority||'medium';
      select.setAttribute('aria-label','Приоритет задачи '+task.title);
      select.onchange=async()=>{
        try{await request('/api/tasks/'+task.id+'/priority',{method:'POST',body:JSON.stringify({priority:select.value})});await refresh();}
        catch(e){showError(e.message);}
      };
      controls.append(begin,progress,delay,select);
      const details=make('details');
      details.append(make('summary','','Действия'),controls);
      content.append(details);
    }
    root.append(item);
  }
}
async function refresh(){
  try{const data=await request('/api/tasks');state.zone=data.timeZone;$('zone').textContent='('+state.zone+')';$('add-button').disabled=false;state.tasks=data.tasks;showError('');render();}
  catch(e){showError(e.message);}
}
const dialog=$('task-dialog');
$('add-button').onclick=()=>{
  $('task-form').reset();
  const initial=new Date(Date.now()+3600000);
  $('schedule').hidden=false;
  $('day').disabled=false;
  $('time').disabled=false;
  $('day').value=dateKey(initial);
  $('time').value=localTime(initial,state.zone);
  if(window.flatpickr) flatpickr($('day'),{locale:'ru',disableMobile:true,inline:true,minDate:dateKey(new Date()),defaultDate:dateKey(initial),dateFormat:'Y-m-d'});
  showError('','form-error');
  dialog.showModal();
};
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
    await request('/api/tasks',{method:'POST',body:JSON.stringify({title,due_at:when,recurrence})});
    dialog.close();await refresh();
  } catch(e){showError(e.message,'form-error');} finally {submit.disabled=false;}
};
$('add-button').disabled=true;
refresh();
