const tg = window.Telegram.WebApp;
const params = new URLSearchParams(location.search);
const zone = params.get('zone') || 'Europe/Moscow';
const form = document.querySelector('#picker');
const fields = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
  timeZone: zone, year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'
}).formatToParts(new Date(Date.now()+60000)).map(part=>[part.type,part.value]));
const today = [fields.year,fields.month,fields.day].join('-');
const day = document.querySelector('#day');
flatpickr(day,{inline:true,locale:'ru',disableMobile:true,minDate:today,
  defaultDate:params.get('date') || today,dateFormat:'Y-m-d'});
form.hour.value=fields.hour;
form.minute.value=fields.minute;
document.querySelector('#zone').textContent=zone;
document.querySelector('#cancel').onclick=()=>tg.close();
form.onsubmit=async event=>{
  event.preventDefault();
  const save=document.querySelector('#save');
  if(save.disabled) return;
  save.disabled=true;
  const time=[form.hour.value,form.minute.value].map(value=>value.padStart(2,'0')).join(':');
  try {
    const response=await fetch('/api/picker',{method:'POST',headers:{'Content-Type':'application/json','X-Telegram-Init-Data':tg.initData},
      body:JSON.stringify({session:params.get('session'),date:day.value,time})});
    const result=await response.json();
    if(!response.ok) throw new Error(result.error || 'Не удалось сохранить время.');
    document.querySelector('#status').textContent='Сохранено';
    tg.close();
  } catch(error) {
    document.querySelector('#status').textContent=error.message;
    save.disabled=false;
  }
};
tg.ready();
