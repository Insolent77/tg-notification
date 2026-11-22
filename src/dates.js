export function localDate(date, timeZone) {
  return new Intl.DateTimeFormat('en-CA', {timeZone, year:'numeric', month:'2-digit', day:'2-digit'}).format(date);
}
export function localTime(date, timeZone) {
  return new Intl.DateTimeFormat('ru-RU', {timeZone, hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(date);
}
export function localToIso(dateText, timeText, timeZone) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateText) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(timeText)) throw new Error('Дата или время указаны неверно');
  const [year,month,day] = dateText.split('-').map(Number);
  const [hour,minute] = timeText.split(':').map(Number);
  const wall = Date.UTC(year,month-1,day,hour,minute);
  if (new Date(Date.UTC(year,month-1,day)).toISOString().slice(0,10) !== dateText) throw new Error('Некорректная дата');
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone, year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'
  });
  let guess = wall;
  for (let i=0;i<4;i++) {
    const p = Object.fromEntries(parts.formatToParts(new Date(guess)).filter(x=>x.type!=='literal').map(x=>[x.type,Number(x.value)]));
    const mapped = Date.UTC(p.year,p.month-1,p.day,p.hour,p.minute,p.second);
    const delta = wall-mapped;
    guess += delta;
    if (delta === 0) break;
  }
  const candidate = new Date(guess);
  const p = Object.fromEntries(parts.formatToParts(candidate).filter(x=>x.type!=='literal').map(x=>[x.type,Number(x.value)]));
  if (p.year!==year||p.month!==month||p.day!==day||p.hour!==hour||p.minute!==minute) throw new Error('Такого местного времени нет в выбранном часовом поясе');
  return candidate.toISOString();
}
export function shiftLocalDate(dateText, delta) {
  const [y,m,d] = dateText.split('-').map(Number);
  return new Date(Date.UTC(y,m-1,d+delta)).toISOString().slice(0,10);
}
