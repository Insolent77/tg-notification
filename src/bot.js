import { Bot, InlineKeyboard, Keyboard } from 'grammy';
import { localDate, localTime, localToIso, shiftLocalDate } from './dates.js';

const categories = ['Личное','Работа','Дом','Автомобиль'];
const safeText = s => String(s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));

export function createBot(config, store) {
  const bot = new Bot(config.botToken);
  const flows = new Map();
  const today = () => localDate(new Date(), config.timeZone);
  const menu = () => {
    const k = new Keyboard().text('➕ Создать задачку').text('📋 Мои задачи').row();
    if (config.publicUrl) k.webApp('📱 Открыть мои дела', config.publicUrl);
    return k.resized().persistent();
  };
  const actions = task => new InlineKeyboard().text('✅ Сделано', 'done:'+task.id).text('⏰ Отложить', 'snooze:'+task.id);
  const showTasks = async ctx => {
    const tasks = store.list().filter(t=>t.status==='active');
    if (!tasks.length) return ctx.reply('Активных задач пока нет. Нажми «➕ Создать задачку».');
    const heading = '📋 <b>Твои активные задачи</b>\n\n';
    let message = heading;
    for (const t of tasks.slice(0,30)) {
      const when = t.due_at ? new Date(t.due_at) : null;
      message += '• <b>'+safeText(t.title)+'</b> — '+safeText(t.category)+(when ? ' · '+localDate(when,config.timeZone)+' '+localTime(when,config.timeZone) : ' · без напоминания')+'\n';
    }
    if (tasks.length>30) message+='\nПоказаны первые 30 задач. Остальные — в Mini App.';
    return ctx.reply(message, {parse_mode:'HTML'});
  };
  bot.use(async (ctx,next) => {
    if (ctx.from?.id !== config.owner) {
      if (ctx.message) await ctx.reply('Этот бот предназначен только для владельца.');
      else if (ctx.callbackQuery) await ctx.answerCallbackQuery({text:'Нет доступа',show_alert:true});
      return;
    }
    await next();
  });
  bot.command('start',ctx=>ctx.reply('Привет! Я напомню о задачах и буду повторять уведомления до выполнения.\n\nВыбери действие ниже.', {reply_markup:menu()}));
  bot.command('id',ctx=>ctx.reply('Твой Telegram ID: '+ctx.from.id));
  bot.command('tasks',showTasks);
  bot.command('cancel',ctx=>{flows.delete(ctx.from.id);return ctx.reply('Создание задачи отменено.',{reply_markup:menu()});});
  const start = async ctx => {
    flows.set(ctx.from.id,{step:'title'});
    await ctx.reply('Как назовём задачу? Напиши название одним сообщением.\n/cancel — отмена');
  };
  bot.command('new',start);
  bot.hears('➕ Создать задачку',start);
  bot.hears('📋 Мои задачи',showTasks);

  bot.on('message:text',async ctx=>{
    const state=flows.get(ctx.from.id);
    if (!state) return;
    const text=ctx.message.text.trim();
    if (state.step==='title') {
      if (!text || text.length>200) return ctx.reply('Название должно содержать от 1 до 200 символов.');
      state.title=text;
      state.step='date';
      return ctx.reply('Когда напомнить?',{reply_markup:new InlineKeyboard().text('Сегодня','date:today').text('Завтра','date:tomorrow').row().text('Без напоминания','date:none').row().text('Ввести дату вручную','date:custom')});
    }
    if (state.step==='custom-date') {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return ctx.reply('Напиши дату в формате ГГГГ-ММ-ДД, например 2026-11-24.');
      state.date=text;state.step='time';return ctx.reply('Укажи время в формате ЧЧ:ММ, например 18:30. Часовой пояс: '+config.timeZone);
    }
    if (state.step==='time') {
      try { state.dueAt=localToIso(state.date,text,config.timeZone); if (Date.parse(state.dueAt)<=Date.now()) throw new Error('Время должно быть в будущем'); }
      catch(e){return ctx.reply(e.message);}
      state.step='category';
      return ctx.reply('Выбери категорию:',{reply_markup:categoryButtons()});
    }
    if (state.step==='custom-category') {
      if (!text || text.length>40) return ctx.reply('Категория должна содержать от 1 до 40 символов.');
      state.category=text;
      return finish(ctx,state);
    }
  });
  function categoryButtons() {
    const k=new InlineKeyboard();
    categories.forEach((c,i)=>{k.text(c,'cat:'+i);if(i%2===1)k.row();});
    return k.text('Другая категория','cat:other');
  }
  async function finish(ctx,state) {
    try {
      const t=store.create({title:state.title,category:state.category||'Личное',dueAt:state.dueAt||null});
      flows.delete(ctx.from.id);
      await ctx.reply('✅ Задача создана: <b>'+safeText(t.title)+'</b>\nКатегория: '+safeText(t.category)+(t.due_at?'\nНапомню: '+localDate(new Date(t.due_at),config.timeZone)+' '+localTime(new Date(t.due_at),config.timeZone):'\nБез напоминания'),{parse_mode:'HTML',reply_markup:menu()});
    } catch(e) { await ctx.reply('Не удалось создать задачу: '+e.message); }
  }
  bot.callbackQuery(/^date:(today|tomorrow|none|custom)$/,async ctx=>{
    const state=flows.get(ctx.from.id);
    await ctx.answerCallbackQuery();
    if (!state||state.step!=='date') return;
    const choice=ctx.match[1];
    if (choice==='custom') {state.step='custom-date';return ctx.reply('Напиши дату в формате ГГГГ-ММ-ДД, например 2026-11-24.');}
    if(choice==='none'){state.dueAt=null;state.step='category';return ctx.reply('Выбери категорию:',{reply_markup:categoryButtons()});}
    state.date=choice==='today'?today():shiftLocalDate(today(),1);
    state.step='time';
    return ctx.reply('Укажи время в формате ЧЧ:ММ, например 18:30. Часовой пояс: '+config.timeZone);
  });
  bot.callbackQuery(/^cat:(\d+|other)$/,async ctx=>{
    const state=flows.get(ctx.from.id);
    await ctx.answerCallbackQuery();
    if (!state||state.step!=='category') return;
    if(ctx.match[1]==='other'){state.step='custom-category';return ctx.reply('Напиши название категории (до 40 символов).');}
    const category=categories[Number(ctx.match[1])];
    if(!category)return;
    state.category=category;
    await finish(ctx,state);
  });
  bot.callbackQuery(/^done:(\d+)$/,async ctx=>{
    const id=Number(ctx.match[1]);
    const task=store.done(id);
    await ctx.answerCallbackQuery({text:task?'Задача выполнена':'Задача уже завершена'});
    if(task) await ctx.editMessageReplyMarkup({reply_markup:new InlineKeyboard().text('✅ Выполнено','noop')}).catch(()=>{});
  });
  bot.callbackQuery(/^snooze:(\d+)$/,async ctx=>{
    const id=Number(ctx.match[1]);
    if(!store.get(id)||store.get(id).status!=='active')return ctx.answerCallbackQuery({text:'Задача уже завершена'});
    await ctx.answerCallbackQuery();
    await ctx.reply('На сколько отложить?',{reply_markup:new InlineKeyboard().text('10 минут','delay:'+id+':10').text('30 минут','delay:'+id+':30').text('60 минут','delay:'+id+':60')});
  });
  bot.callbackQuery(/^delay:(\d+):(10|30|60)$/,async ctx=>{
    const task=store.snooze(Number(ctx.match[1]),Number(ctx.match[2]));
    await ctx.answerCallbackQuery({text:task?'Отложено':'Задача уже завершена'});
    if(task) await ctx.editMessageText('⏰ «'+task.title+'» отложена на '+ctx.match[2]+' минут.').catch(()=>{});
  });
  bot.callbackQuery('noop',ctx=>ctx.answerCallbackQuery());
  async function sendReminder(task) {
    await bot.api.sendMessage(config.owner,'🔔 <b>Напоминание</b>\n\n<b>'+safeText(task.title)+'</b>\nКатегория: '+safeText(task.category)+'\n\nУже сделал?',{parse_mode:'HTML',reply_markup:actions(task)});
  }
  return {bot,sendReminder};
}
