import {assistantReply} from './assistant.js';
import { Bot, InlineKeyboard, Keyboard } from 'grammy';
import { localDate, localTime, localToIso, shiftLocalDate } from './dates.js';
import {rankTasks, morningBrief,eveningBrief,behavioralHint,priorityLabel} from './secretary.js';

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
  const actions = task => new InlineKeyboard()
    .text('▶️ Начинаю','start:'+task.id).text('🙅 Пока не могу','cant:'+task.id).row()
    .text('📈 Есть прогресс','progress:'+task.id).text('✅ Сделано','done:'+task.id);
  const priorityButtons = () => new InlineKeyboard().text('🔴 Важно','priority:high').text('🟡 Обычно','priority:medium').row().text('⚪ Не срочно','priority:low');
  const postButtons = id => new InlineKeyboard()
    .text('10 мин','move:'+id+':10').text('30 мин','move:'+id+':30').text('1 час','move:'+id+':60').row()
    .text('Завтра в 09:00','move:'+id+':tomorrow').row().text('📅 Своя дата и время','move:'+id+':custom');
  const whenLabel = task => task.due_at?localDate(new Date(task.due_at),config.timeZone)+' '+localTime(new Date(task.due_at),config.timeZone):'без напоминания';
  const showTasks = async ctx => {
    const tasks = rankTasks(store.list());
    if (!tasks.length) return ctx.reply('Активных задач пока нет. Нажми «➕ Создать задачку».');
    const heading = '📋 <b>Твои активные задачи по приоритету</b>\n\n';
    let message = heading;
    for (const t of tasks.slice(0,30)) {
      const when = t.due_at ? new Date(t.due_at) : null;
      message += '• <b>'+safeText(t.title)+'</b> ['+priorityLabel(t.priority)+'] — '+safeText(t.category)+(when ? ' · '+localDate(when,config.timeZone)+' '+localTime(when,config.timeZone) : ' · без напоминания')+'\n';
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
  bot.command('plan',ctx=>ctx.reply(morningBrief(store.list(),config.timeZone)));
  bot.command('summary',ctx=>ctx.reply(eveningBrief(store.list(),config.timeZone)));
  bot.command('cancel',ctx=>{flows.delete(ctx.from.id);return ctx.reply('Создание задачи отменено.',{reply_markup:menu()});});
  const start = async ctx => {
    flows.set(ctx.from.id,{step:'title'});
    await ctx.reply('Как назовём задачу? Напиши название одним сообщением.\n/cancel — отмена');
  };
  bot.command('new',start);
  bot.hears('➕ Создать задачку',start);
  bot.hears('📋 Мои задачи',showTasks);

  bot.on('message:text',async ctx=>{
    const text=ctx.message.text.trim();
    const state=flows.get(ctx.from.id);
    if (!state) {
      if(config.openaiApiKey){
        try {const answer=await assistantReply(config,store,text);if(answer)await ctx.reply(answer.slice(0,4000));}
        catch(e){console.error('Assistant response error:',e.message);await ctx.reply('Сейчас не могу ответить через ИИ. Но задачи и напоминания работают. Попробуй ещё раз позже.');}
      } else await ctx.reply('Можешь открыть список дел или создать новую задачу. Для свободного диалога потребуется OPENAI_API_KEY.');
      return;
    }
    if(state.step==='reschedule-custom') {
      const match=text.match(/^(\d{4}-\d{2}-\d{2})\s+([01]\d|2[0-3]):([0-5]\d)$/);
      if(!match)return ctx.reply('Напиши дату и время одним сообщением: 2026-11-24 18:30');
      try{
        const dueAt=localToIso(match[1],match[2]+':'+match[3],config.timeZone);
        const task=store.reschedule(state.taskId,dueAt,state.reason||'busy');
        if(!task){flows.delete(ctx.from.id);return ctx.reply('Эта задача уже выполнена.');}
        flows.delete(ctx.from.id);
        return ctx.reply('Договорились. Вернусь к «'+task.title+'» '+whenLabel(task)+'.');
      }catch(e){return ctx.reply(e.message);}
    }
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
      state.step='priority';return ctx.reply('Насколько это важно?',{reply_markup:priorityButtons()});
    }
  });
  function categoryButtons() {
    const k=new InlineKeyboard();
    categories.forEach((c,i)=>{k.text(c,'cat:'+i);if(i%2===1)k.row();});
    return k.text('Другая категория','cat:other');
  }
  async function finish(ctx,state) {
    try {
      const t=store.create({title:state.title,category:state.category||'Личное',dueAt:state.dueAt||null,priority:state.priority||'medium'});
      flows.delete(ctx.from.id);
      await ctx.reply('✅ Задача создана: <b>'+safeText(t.title)+'</b>\nКатегория: '+safeText(t.category)+(t.due_at?'\nНапомню: '+localDate(new Date(t.due_at),config.timeZone)+' '+localTime(new Date(t.due_at),config.timeZone):'\nБез напоминания')+'\nПриоритет: '+priorityLabel(t.priority),{parse_mode:'HTML',reply_markup:menu()});
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
    state.step='priority';
    await ctx.reply('Насколько это важно?',{reply_markup:priorityButtons()});
  });
  bot.callbackQuery(/^priority:(high|medium|low)$/,async ctx=>{
    const state=flows.get(ctx.from.id);
    await ctx.answerCallbackQuery();
    if(!state||state.step!=='priority')return;
    state.priority=ctx.match[1];
    await finish(ctx,state);
  });
  bot.callbackQuery(/^start:(\d+)$/,async ctx=>{
    const task=store.started(Number(ctx.match[1]));
    await ctx.answerCallbackQuery({text:task?'Отлично, начнём':'Задача уже завершена'});
    if(task)await ctx.reply('Начни с одного конкретного шага по «'+task.title+'». Я спрошу, как дела, через 20 минут.',{reply_markup:actions(task)});
  });
  bot.callbackQuery(/^progress:(\d+)$/,async ctx=>{
    const task=store.progress(Number(ctx.match[1]));
    await ctx.answerCallbackQuery({text:task?'Прогресс записан':'Задача уже завершена'});
    if(task)await ctx.reply('Здорово, по «'+task.title+'» есть движение. До завершения ещё не дошли — вернусь через полчаса.',{reply_markup:actions(task)});
  });
  bot.callbackQuery(/^cant:(\d+)$/,async ctx=>{
    const task=store.get(Number(ctx.match[1]));
    await ctx.answerCallbackQuery();
    if(!task||task.status!=='active')return ctx.reply('Эта задача уже завершена.');
    await ctx.reply('Понял. Что сейчас мешает? Подберём нормальное время, а не будем переносить вслепую.',{
      reply_markup:new InlineKeyboard().text('Занят другим','reason:'+task.id+':busy').text('Нет сил','reason:'+task.id+':tired').row()
        .text('Не знаю, с чего начать','reason:'+task.id+':stuck').row().text('Не хочу сейчас','reason:'+task.id+':avoid')
    });
  });
  const reasonText={busy:'Давай перенесём на свободное время.',tired:'Не нужно выжимать из себя последнее. Выберем время попозже.',stuck:'Попробуй начать с самого маленького шага. А пока давай выберем время.',avoid:'Бывает. Если задача ещё нужна, выбери реальное время для неё.'};
  bot.callbackQuery(/^reason:(\d+):(busy|tired|stuck|avoid)$/,async ctx=>{
    const id=Number(ctx.match[1]),reason=ctx.match[2];
    const task=store.noteBlocker(id,reason);
    await ctx.answerCallbackQuery();
    if(!task)return ctx.reply('Эта задача уже завершена.');
    flows.set(ctx.from.id,{step:'await-reschedule',taskId:id,reason});
    await ctx.reply(reasonText[reason]+' Когда вернуться к задаче?',{reply_markup:postButtons(id)});
  });
  bot.callbackQuery(/^move:(\d+):(10|30|60|tomorrow|custom)$/,async ctx=>{
    const id=Number(ctx.match[1]),choice=ctx.match[2];
    const task=store.get(id);
    await ctx.answerCallbackQuery();
    if(!task||task.status!=='active')return ctx.reply('Эта задача уже завершена.');
    const state=flows.get(ctx.from.id);
    const reason=state?.taskId===id?state.reason:'busy';
    if(choice==='custom'){
      flows.set(ctx.from.id,{step:'reschedule-custom',taskId:id,reason});
      return ctx.reply('Напиши новую дату и время одним сообщением в формате 2026-11-24 18:30. Часовой пояс: '+config.timeZone);
    }
    let dueAt;
    if(choice==='tomorrow'){
      const date=shiftLocalDate(today(),1);
      dueAt=localToIso(date,'09:00',config.timeZone);
    }else{dueAt=new Date(Date.now()+Number(choice)*60000).toISOString();}
    try{
      const moved=store.reschedule(id,dueAt,reason);
      if(state?.taskId===id)flows.delete(ctx.from.id);
      if(!moved)return ctx.reply('Эта задача уже завершена.');
      const hint=behavioralHint(moved,store.recentEvents(40));
      await ctx.reply('Хорошо, «'+moved.title+'» теперь на '+whenLabel(moved)+'.'+(hint?'\n\n'+hint:''));
    }catch(e){await ctx.reply(e.message);}
  });
  bot.callbackQuery(/^done:(\d+)$/,async ctx=>{
    const id=Number(ctx.match[1]);
    const current=store.get(id);
    if(current?.status==='active' && current.priority==='high' && current.progress_count===0){
      await ctx.answerCallbackQuery();
      return ctx.reply('Это важное дело. Уже полностью готово или пока есть продвижение?',{
        reply_markup:new InlineKeyboard().text('✅ Готово целиком','confirmdone:'+id).text('📈 Есть прогресс','progress:'+id)
      });
    }
    const task=store.done(id);
    await ctx.answerCallbackQuery({text:task?'Задача выполнена':'Задача уже завершена'});
    if(task) await ctx.editMessageReplyMarkup({reply_markup:new InlineKeyboard().text('✅ Выполнено','noop')}).catch(()=>{});
  });
  bot.callbackQuery(/^confirmdone:(\d+)$/,async ctx=>{
    const task=store.done(Number(ctx.match[1]));
    await ctx.answerCallbackQuery({text:task?'Готово, убрал из списка':'Задача уже завершена'});
    if(task)await ctx.editMessageText('✅ «'+task.title+'» выполнено. Отлично, идём дальше.').catch(()=>{});
  });
  bot.callbackQuery(/^snooze:(\d+)$/,async ctx=>{
    const id=Number(ctx.match[1]);
    if(!store.get(id)||store.get(id).status!=='active')return ctx.answerCallbackQuery({text:'Задача уже завершена'});
    await ctx.answerCallbackQuery();
    await ctx.reply('Окей, когда вернуться к этой задаче?',{reply_markup:postButtons(id)});
  });
  bot.callbackQuery(/^delay:(\d+):(10|30|60)$/,async ctx=>{
    const task=store.snooze(Number(ctx.match[1]),Number(ctx.match[2]));
    await ctx.answerCallbackQuery({text:task?'Отложено':'Задача уже завершена'});
    if(task) await ctx.editMessageText('⏰ «'+task.title+'» отложена на '+ctx.match[2]+' минут.').catch(()=>{});
  });
  bot.callbackQuery('noop',ctx=>ctx.answerCallbackQuery());
  async function sendReminder(task) {
    const hint=behavioralHint(task,store.recentEvents(40));
    await bot.api.sendMessage(config.owner,'🔔 <b>Вернёмся к делу?</b>\n\n<b>'+safeText(task.title)+'</b>\n'+priorityLabel(task.priority)+' · '+safeText(task.category)+'\n\nМожешь начать сейчас или выбрать другое время.'+(hint?'\n\n'+safeText(hint):''),{parse_mode:'HTML',reply_markup:actions(task)});
  }
  async function sendDaily(kind){
    const text=kind==='morning'?morningBrief(store.list(),config.timeZone):eveningBrief(store.list(),config.timeZone);
    const keyboard=new InlineKeyboard();
    if(kind==='morning'){
      const day=today();
      const first=rankTasks(store.list().filter(t=>t.due_at&&localDate(new Date(t.due_at),config.timeZone)<=day))[0];
      if(first)keyboard.text('▶️ Начну с главного','start:'+first.id).row();
    }else{
      const outstanding=store.list().some(t=>t.status==='active'&&t.due_at&&localDate(new Date(t.due_at),config.timeZone)<=today());
      if(outstanding)keyboard.text('📅 Перенести оставшееся','evening:open').row();
    }
    keyboard.text('📋 Мои задачи','list:open');
    await bot.api.sendMessage(config.owner,text,{reply_markup:keyboard});
  }
  bot.callbackQuery('evening:open',async ctx=>{
    await ctx.answerCallbackQuery();
    const overdue=rankTasks(store.list().filter(t=>t.due_at&&localDate(new Date(t.due_at),config.timeZone)<=today())).slice(0,10);
    if(!overdue.length)return ctx.reply('Просроченных задач уже нет.');
    const keyboard=new InlineKeyboard();
    overdue.forEach(t=>keyboard.text(t.title.slice(0,45),'move:'+t.id+':tomorrow').row());
    await ctx.reply('Какую задачу перенести на завтра, 09:00? Можно выбрать по одной.',{reply_markup:keyboard});
  });
  bot.callbackQuery('list:open',async ctx=>{await ctx.answerCallbackQuery();await showTasks(ctx);});
  return {bot,sendReminder,sendDaily};
}
