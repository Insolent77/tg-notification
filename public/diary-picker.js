const pad=value=>String(value).padStart(2,'0');

export function dateTimePicker(root) {
  root.innerHTML=`<div class="picker-fields">
    <button type="button" data-open="date" aria-expanded="false"><small>Дата</small><strong></strong></button>
    <button type="button" data-open="time" aria-expanded="false"><small>Время</small><strong></strong></button>
  </div>
  <div class="picker-panel" data-panel="date" hidden><input type="hidden" class="calendar-source"></div>
  <div class="picker-panel" data-panel="time" hidden>
    <div class="clock-fields">
      <label>Часы<input inputmode="numeric" type="text" maxlength="2" pattern="(?:[01]?[0-9]|2[0-3])" required></label>
      <span aria-hidden="true">:</span>
      <label>Минуты<input inputmode="numeric" type="text" maxlength="2" pattern="[0-5]?[0-9]" required></label>
    </div>
    <button type="button" class="clock-done">Готово</button>
  </div>`;
  const [dateButton,timeButton]=root.querySelectorAll('[data-open]');
  const [datePanel,timePanel]=root.querySelectorAll('[data-panel]');
  const [hour,minute]=timePanel.querySelectorAll('input');
  for(const [button,panel] of [[dateButton,datePanel],[timeButton,timePanel]]){
    panel.id=root.id+'-'+panel.dataset.panel;
    button.setAttribute('aria-controls',panel.id);
  }
  let day='',calendar;
  function time(){
    if(!hour.value || !minute.value || !hour.validity.valid || !minute.validity.valid)throw new Error('Введи время от 00:00 до 23:59.');
    return pad(hour.value)+':'+pad(minute.value);
  }
  function paint(){
    dateButton.lastElementChild.textContent=new Intl.DateTimeFormat('ru-RU',{day:'numeric',month:'long',year:'numeric',timeZone:'UTC'}).format(new Date(day+'T12:00Z'));
    timeButton.lastElementChild.textContent=(hour.value?pad(hour.value):'––')+':'+(minute.value?pad(minute.value):'––');
  }
  function open(which){
    if(!timePanel.hidden && which!=='time' && (!hour.reportValidity() || !minute.reportValidity()))return;
    for(const [button,panel] of [[dateButton,datePanel],[timeButton,timePanel]]){
      panel.hidden=panel.dataset.panel!==which;
      button.setAttribute('aria-expanded',String(!panel.hidden));
    }
    if(which==='time'){hour.focus();hour.select();}
    if(which==='date')calendar.calendarContainer.querySelector('.selected,.today,.flatpickr-day:not(.flatpickr-disabled)')?.focus();
  }
  for(const btn of [dateButton,timeButton])btn.onclick=()=>open(btn.getAttribute('aria-expanded')==='true'?null:btn.dataset.open);
  for(const input of [hour,minute])input.oninput=paint;
  timePanel.querySelector('button').onclick=()=>{open(null);if(timePanel.hidden)timeButton.focus();};
  root.addEventListener('keydown',e=>{
    if(e.key==='Escape' && (!datePanel.hidden || !timePanel.hidden)){
      e.preventDefault();e.stopPropagation();const btn=datePanel.hidden?timeButton:dateButton;open(null);btn.focus();
    }
  });
  return {
    reset(date,clock,minDate){
      day=date;[hour.value,minute.value]=clock.split(':');
      if(!calendar)calendar=flatpickr(root.querySelector('.calendar-source'),{
        inline:true,disableMobile:true,locale:'ru',dateFormat:'Y-m-d',monthSelectorType:'static',
        onChange:(_,value)=>{if(value){day=value;paint();open(null);dateButton.focus();}}
      });
      calendar.set('minDate',minDate);calendar.setDate(date,false);open(null);paint();
    },
    enable(enabled){hour.disabled=minute.disabled=!enabled;},
    value(){return [day,time()];}
  };
}
