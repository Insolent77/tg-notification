import {localDate,localTime} from './dates.js';

const names={high:'важно',medium:'обычный',low:'может подождать'};
export function rankTasks(tasks,now=new Date()){
  const active=tasks.filter(t=>t.status==='active');
  const score=t=>{
    const priority={high:100,medium:50,low:10}[t.priority]||50;
    const due=t.due_at?Date.parse(t.due_at):Infinity;
    const hours=(due-now.getTime())/3600000;
    const urgency=hours<=0?40:hours<=3?25:hours<=24?12:0;
    return priority+urgency+Math.min(12,(t.postponed_count||0)*2);
  };
  return active.sort((a,b)=>score(b)-score(a)||(Date.parse(a.due_at||'9999')-Date.parse(b.due_at||'9999')));
}
export function priorityLabel(priority){return names[priority]||names.medium;}
export function morningBrief(tasks,timeZone,now=new Date()){
  const day=localDate(now,timeZone);
  const ranked=rankTasks(tasks.filter(t=>t.due_at && localDate(new Date(t.due_at),timeZone)<=day),now);
  if(!ranked.length)return 'Доброе утро! На сегодня задач с напоминаниями нет. Если планы поменяются, просто добавь задачу.';
  const top=ranked.slice(0,3);
  return 'Доброе утро! Сегодня '+ranked.length+' '+(ranked.length===1?'дело':'дел')+' в плане.\n\nЯ бы сосредоточился на этих:\n'+top.map((t,i)=>(i+1)+'. '+t.title+' ('+priorityLabel(t.priority)+')').join('\n')+'\n\nНе обязательно хвататься за всё сразу. Начнём с первого?';
}
export function eveningBrief(tasks,timeZone,now=new Date()){
  const day=localDate(now,timeZone);
  const done=tasks.filter(t=>t.completed_at&&localDate(new Date(t.completed_at),timeZone)===day);
  const unfinished=tasks.filter(t=>t.status==='active'&&t.due_at&&localDate(new Date(t.due_at),timeZone)<=day);
  const progressed=tasks.filter(t=>t.status==='active'&&t.progress_count>0&&t.due_at&&localDate(new Date(t.due_at),timeZone)<=day);
  let result='Итоги дня: выполнено '+done.length+', осталось '+unfinished.length+'.';
  if(progressed.length)result+=' Есть продвижение по '+progressed.length+' задачам — это тоже результат.';
  if(unfinished.length)result+='\n\nОсталось: '+rankTasks(unfinished,now).slice(0,3).map(t=>t.title).join('; ')+'.\nМожно перенести их на завтра, если сегодня уже неактуально.';
  else if(done.length)result+='\nХорошо поработал. На сегодня можно закрывать список.';
  return result;
}
export function behavioralHint(task,events=[]){
  if((task.postponed_count||0)>=3)return 'Мы уже несколько раз переносили это дело. Оно ещё важно? Если да, давай выберем время, когда реально сможешь заняться.';
  const blockers=events.filter(e=>e.task_id===task.id&&e.action==='blocker');
  if(blockers.length>=2&&blockers.slice(0,2).every(e=>e.reason==='stuck'))return 'Кажется, с этой задачей сложно начать. Попробуй выделить первый маленький шаг, который займёт 5 минут.';
  return null;
}
