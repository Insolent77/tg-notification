import {localDate, localToIso, shiftLocalDate} from './dates.js';

export function parseRequest(text, zone, now = new Date()) {
  const prefix = /^(?:\/task|(?:поставь|создай|добавь)(?: мне)? задач(?:у|ку)|напомни)\s*[:,]?\s+/iu;
  if (!prefix.test(text)) return null;
  const body = text.replace(prefix, '').trim();
  const schedule = body.match(/^(.+?)\s+(сегодня|завтра|\d{4}-\d{2}-\d{2})\s+(?:в\s+)?(\d{1,2}:\d{2})[.!]?$/iu);
  if (!schedule) {
    const plain = body.match(/^(.+?)\s+без напоминания[.!]?$/iu);
    if (plain) return {title: plain[1]};
    throw new Error('Например: «Поставь задачу купить масло завтра в 18:00». Можно также указать дату ГГГГ-ММ-ДД или написать «без напоминания».');
  }
  const [,title,day,time] = schedule;
  const date = /^\d/.test(day) ? day : shiftLocalDate(localDate(now, zone), Number(day.toLowerCase() === 'завтра'));
  return {title, dueAt: localToIso(date, time.padStart(5,'0'), zone)};
}

export async function transcribe(ctx, config) {
  if (!config.openaiApiKey) throw new Error('Для голосовых нужен OPENAI_API_KEY. Можно отправить текст.');
  const voice = ctx.message.voice;
  if (!voice.file_size || voice.file_size > 8_000_000 || voice.duration > 120) throw new Error('Пришли голосовое длительностью до двух минут.');
  const file = await ctx.getFile();
  const download = await fetch('https://api.telegram.org/file/bot'+config.botToken+'/'+file.file_path,{signal:AbortSignal.timeout(20000)});
  if (!download.ok) throw new Error('Не удалось получить голосовое.');
  const form = new FormData();
  form.set('file',await download.blob(),'message.ogg');
  form.set('model','whisper-1');
  form.set('language','ru');
  const response = await fetch('https://api.openai.com/v1/audio/transcriptions',{method:'POST',headers:{Authorization:'Bearer '+config.openaiApiKey},body:form,signal:AbortSignal.timeout(45000)});
  if (!response.ok) throw new Error('Распознавание сейчас недоступно.');
  return (await response.json()).text.trim();
}
