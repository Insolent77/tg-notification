const tg=window.Telegram?.WebApp;
tg?.ready();
tg?.expand();
const state={tasks:[],tab:'today',category:'Все'};
const $=id=>document.getElementById(id);
const labels={today:'Сегодня',tomorrow:'Завтра',all:'Все задачи'};
const dateKey=date=>[date.getFullYear(),String(date.getMonth()+1).padStart(2,'0'),String(date.getDate()).padStart(2,'0')].join('-');
const today=dateKey(new Date());
const tomorrow=dateKey(new Date(Date.now()+86400000));
$('today-label').textContent=new Intl.DateTimeFormat('ru-RU',{weekday:'long',day:'numeric',month:'long'}).format(new Date());
function showError(message,id='error'){const el=$(id);el.hidden=!message;el.textContent=message||'';}
async function request(path,options={}) {
  if(!tg?.initData)throw new Error('Открой приложение через кнопку в Telegram.');
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
function filtered() {
  return state.tasks.filter(t=>{
    if(state.category!=='Все'&&t.category!==state.category)return false;
    if(state.tab==='all')return true;
    if(!t.due_at)return false;
    const key=dateKey(new Date(t.due_at));
    return key===(state.tab==='today'?today:tomorrow);
  });
}
function renderCategories() {
  const categories=['Все',...new Set([...['Личное','Дом','Работа','Автомобиль'],...state.tasks.map(t=>t.category)])];
  const root=$('categories');root.replaceChildren();
  for(const category of categories){
    const btn=make('button','category'+(state.category===category?' active':''),category);
    btn.onclick=()=>{state.category=category;render();};
    root.append(btn);
  }
}
function formatDue(value){
  if(!value)return 'Без напоминания';
  return '◷ '+new Intl.DateTimeFormat('ru-RU',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'}).format(new Date(value));
}
async function complete(id){
  try {await request('/api/tasks/'+id+'/done',{method:'POST'});await refresh();}
  catch(e){showError(e.message);}
}
async function snooze(id){
  const options=['10','30','60'];
  const selected=prompt('Отложить на сколько минут? 10, 30 или 60','10');
  if(selected===null)return;
  if(!options.includes(selected.trim())){showError('Выбери 10, 30 или 60 минут');return;}
  try {await request('/api/tasks/'+id+'/snooze',{method:'POST',body:JSON.stringify({minutes:Number(selected)})});await refresh();}
  catch(e){showError(e.message);}
}
function render() {
  $('active-count').textContent=state.tasks.filter(t=>t.status==='active').length;
  $('done-count').textContent=state.tasks.filter(t=>t.status==='done').length;
  $('section-title').textContent=labels[state.tab];
  document.querySelectorAll('.tab').forEach(btn=>btn.classList.toggle('active',btn.dataset.tab===state.tab));
  renderCategories();
  const tasks=filtered();
  $('visible-count').textContent=tasks.length;
  const root=$('task-list');root.replaceChildren();
  if(!tasks.length){
    const empty=make('div','empty');
    empty.append(make('strong','',state.tab==='today'?'На сегодня всё свободно':'Здесь пока нет задач'),make('span','','Нажми «Создать задачу», чтобы добавить дело.'));
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
    meta.append(make('span','',task.category),make('span','',formatDue(task.due_at)));
    content.append(meta);
    item.append(check,content);
    if(!done&&task.due_at){
      const delay=make('button','snooze-button','Отложить');
      delay.onclick=()=>snooze(task.id);
      item.append(delay);
    }
    root.append(item);
  }
}
async function refresh(){
  try{state.tasks=(await request('/api/tasks')).tasks;showError('');render();}
  catch(e){showError(e.message);}
}
document.querySelectorAll('.tab').forEach(btn=>btn.onclick=()=>{state.tab=btn.dataset.tab;state.category='Все';render();});
const dialog=$('task-dialog');
$('add-button').onclick=()=>{
  $('task-form').reset();
  $('date-time').value=new Date(Date.now()+3600000-new Date().getTimezoneOffset()*60000).toISOString().slice(0,16);
  $('date-time').disabled=false;
  $('date-time').required=true;
  $('category').value='Личное';
  showError('','form-error');
  dialog.showModal();
};
$('close-dialog').onclick=()=>dialog.close();
$('remind').onchange=()=>{
  $('date-time').disabled=!$('remind').checked;
  $('date-time').required=$('remind').checked;
  $('date-time-label').style.opacity=$('remind').checked?'1':'0.4';
};
$('task-form').onsubmit=async event=>{
  event.preventDefault();
  const title=$('title').value.trim();
  const category=$('category').value.trim()||'Личное';
  const when=$('remind').checked?new Date($('date-time').value).toISOString():null;
  try {
    await request('/api/tasks',{method:'POST',body:JSON.stringify({title,category,due_at:when})});
    dialog.close();await refresh();
  } catch(e){showError(e.message,'form-error');}
};
refresh();
