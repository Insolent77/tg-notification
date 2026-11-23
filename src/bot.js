import {parseRequest, transcribe} from './intake.js';
import {assistantReply} from './assistant.js';
import { Bot, InlineKeyboard, Keyboard } from 'grammy';
import { localDate, localTime, localToIso, shiftLocalDate } from './dates.js';
import {rankTasks, morningBrief,eveningBrief,behavioralHint,priorityLabel} from './secretary.js';

const categories = ['Личное','Работа','Дом','Автомобиль'];
const safeText = s => String(s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));

export function createBot(config, store, options) {
  const bot = new Bot(config.botToken,options);
  const flows = new Map();
  const mutable=/^(?:start|progress|cant|done|confirmdone|reason|move|unschedule|snooze|delay|delete|confirmdelete|edit|editname|edittime):(\d+)(?::|$)/;
  bot.api.config.use((prev,method,payload,signal)=>{
    for(const row of payload.reply_markup?.inline_keyboard || []) for(const button of row){
      const match=mutable.exec(button.callback_data||'');
      if(match)button.callback_data+='~'+store.get(match[1])?.revision;
    }
    return prev(method,payload,signal);
  });
  async function updatePrompt(ctx, text, options = {}) {
    const state = flows.get(ctx.from.id);
    const messageId = ctx.callbackQuery?.message?.message_id ?? state?.messageId;
    if (state && messageId) state.messageId = messageId;
    if (messageId) {
      try {
        return await ctx.api.editMessageText(ctx.chat.id, messageId, text, options);
      } catch (error) {
        if (String(error.description || error.message).includes('message is not modified')) return;
        console.error('Could not update dialog message:', error.message);
      }
    }
    const message = await ctx.reply(text, options);
    if (state) state.messageId = message.message_id;
    return message;
  }
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
    .text('Завтра в 09:00','move:'+id+':tomorrow').row().text('📅 Своя дата и время','move:'+id+':custom').row().text('Оставить без напоминания','unschedule:'+id);
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
    const keyboard = new InlineKeyboard();
    for (const t of tasks.slice(0,30)) keyboard.text('✏️ '+t.title.slice(0,35), 'edit:'+t.id).text('🗑', 'delete:'+t.id).row();
    return ctx.reply(message, {parse_mode:'HTML', reply_markup:keyboard});
  };
  bot.use(async (ctx,next) => {
    if (ctx.chat?.type !== 'private') return;
    if (ctx.message?.text === '/id') return ctx.reply('Твой Telegram ID: '+ctx.from.id);
    const guest = ctx.from?.id === config.guest && ctx.from.id !== config.owner;
    if (guest || (ctx.from?.id === config.owner && !flows.has(ctx.from.id))) {
      if (ctx.message?.voice || (ctx.message?.text && (guest || /^(?:\/task |поставь|создай|добавь|напомни)/iu.test(ctx.message.text)))) {
        let message = ctx.message.text;
        if (!message) {
          try { message = await transcribe(ctx,config); }
          catch { return ctx.reply('Не удалось распознать голосовое. Проверь подключение распознавания или отправь текст.'); }
        }
        let input;
        try { input = parseRequest(message.trim(),config.timeZone); }
        catch (error) { return ctx.reply(error.message); }
        if (input) {
          let task;
          try { task = store.createFromMessage(ctx.chat.id,ctx.message.message_id,input); }
          catch (error) { return ctx.reply(error.message); }
          if (!task) return ctx.reply('Эта задача уже была удалена.');
          return ctx.reply('Записано: «'+task.title+'», '+whenLabel(task)+' ('+config.timeZone+').');
        }
        if (guest || ctx.message.voice) {
          if (!message.startsWith('/') && config.openaiApiKey) {
            try { return ctx.reply(await assistantReply(config,store,message,ctx.from.id)); }
            catch { return ctx.reply('Сейчас не получается ответить. Попробуй позже.'); }
          }
          return ctx.reply('Напиши «Поставь задачу купить масло завтра в 18:00». Для свободных вопросов нужен подключённый ИИ.');
        }
      }
      if (guest) return;
    }
    if (ctx.from?.id !== config.owner) {
      if (ctx.message) await ctx.reply('Этот бот предназначен только для владельца.');
      else if (ctx.callbackQuery) await ctx.answerCallbackQuery({text:'Нет доступа',show_alert:true});
      return;
    }
    const data=ctx.callbackQuery?.data;
    if(data && mutable.test(data.split('~')[0])){
      const [action,version]=data.split('~');
      const task=store.get(mutable.exec(action)[1]);
      if(!task || task.status!=='active' || String(task.revision)!==version)
        return ctx.answerCallbackQuery({text:'Кнопка устарела. Открой актуальную задачу в Mini App.'});
      ctx.callbackQuery.data=action;
    }
    await next();
  });
  bot.callbackQuery(/^edit:(\d+)$/,async ctx=>{
    const task=store.get(ctx.match[1]);
    await ctx.answerCallbackQuery();
    await updatePrompt(ctx,'Что изменить в задаче «'+task.title+'»?',{reply_markup:new InlineKeyboard().text('Название','editname:'+task.id).text('Дату и время','edittime:'+task.id)});
  });
  bot.callbackQuery(/^(editname|edittime):(\d+)$/,async ctx=>{
    const task=store.get(ctx.match[2]);
    flows.set(ctx.from.id,{step:ctx.match[1],taskId:task.id,revision:task.revision,messageId:ctx.callbackQuery.message.message_id});
    await ctx.answerCallbackQuery();
    await updatePrompt(ctx,ctx.match[1]==='editname'?'Напиши новое название задачи.':'Напиши новую дату и время в формате 2026-11-24 18:30. Часовой пояс: '+config.timeZone);
  });
  bot.callbackQuery(/^delete:(\d+)$/,async ctx=>{
    const task=store.get(ctx.match[1]);
    await ctx.answerCallbackQuery();
    await updatePrompt(ctx,'Удалить задачу «'+task.title+'»?'+(task.series_id?' Еженедельный повтор тоже остановится.':''), {reply_markup:new InlineKeyboard().text('Удалить','confirmdelete:'+task.id).text('Отмена','noop')});
  });
  bot.callbackQuery(/^confirmdelete:(\d+)$/,async ctx=>{
    const task=store.get(ctx.match[1]);
    const deleted=store.delete(task.id);
    await ctx.answerCallbackQuery();
    await updatePrompt(ctx,deleted ? 'Задача «'+task.title+'» удалена.' : 'Задача уже удалена.');
  });
  bot.command('start',ctx=>ctx.reply('Привет! Я напомню о задачах и буду повторять уведомления до выполнения.\n\nВыбери действие ниже.', {reply_markup:menu()}));
  bot.command('id',ctx=>ctx.reply('Твой Telegram ID: '+ctx.from.id));
  bot.command('tasks',showTasks);
  bot.command('plan',ctx=>ctx.reply(morningBrief(store.list(),config.timeZone)));
  bot.command('summary',ctx=>ctx.reply(eveningBrief(store.list(),config.timeZone,new Date(),store.eventsSince(new Date(Date.now()-48*3600000).toISOString()))));
  bot.command('cancel',ctx=>{flows.delete(ctx.from.id);return ctx.reply('Создание задачи отменено.',{reply_markup:menu()});});
  const start = async ctx => {
    flows.set(ctx.from.id,{step:'title'});
    await updatePrompt(ctx,'Как назовём задачу? Напиши название одним сообщением.\n/cancel — отмена');
  };
  bot.command('new',start);
  bot.hears('➕ Создать задачку',start);
  bot.hears('📋 Мои задачи',showTasks);

  bot.on('message:text',async ctx=>{
    const text=ctx.message.text.trim();
    const state=flows.get(ctx.from.id);
    if (!state) {
      if(config.openaiApiKey){
        try {const answer=await assistantReply(config,store,text);if(answer)await updatePrompt(ctx,answer.slice(0,4000));}
        catch(e){console.error('Assistant response error:',e.message);await updatePrompt(ctx,'Сейчас не могу ответить через ИИ. Но задачи и напоминания работают. Попробуй ещё раз позже.');}
      } else await updatePrompt(ctx,'Можешь открыть список дел или создать новую задачу. Для свободного диалога потребуется OPENAI_API_KEY.');
      return;
    }
    if(state.step==='editname' || state.step==='edittime') {
      try {
        let changes={revision:state.revision};
        if(state.step==='editname') changes.title=text;
        else {
          const match=text.match(/^(\d{4}-\d{2}-\d{2})\s+([01]\d|2[0-3]):([0-5]\d)$/);
          if(!match) throw new Error('Напиши дату и время в формате 2026-11-24 18:30.');
          changes.dueAt=localToIso(match[1],match[2]+':'+match[3],config.timeZone);
        }
        const task=store.edit(state.taskId,changes);
        await updatePrompt(ctx,task?'Задача обновлена: «'+task.title+'», '+whenLabel(task)+'.':'Задача уже изменилась. Открой список заново.');
        flows.delete(ctx.from.id);
      } catch(error) { await updatePrompt(ctx,error.message); }
      return;
    }
    if(state.step==='reschedule-custom') {
      const match=text.match(/^(\d{4}-\d{2}-\d{2})\s+([01]\d|2[0-3]):([0-5]\d)$/);
      if(!match)return updatePrompt(ctx,'Напиши дату и время одним сообщением: 2026-11-24 18:30');
      try{
        const dueAt=localToIso(match[1],match[2]+':'+match[3],config.timeZone);
        if(store.get(state.taskId)?.revision!==state.revision){flows.delete(ctx.from.id);return updatePrompt(ctx,'Задача уже изменилась. Открой её снова.');}
        const task=store.reschedule(state.taskId,dueAt,state.reason||'busy');
        if(!task){flows.delete(ctx.from.id);return updatePrompt(ctx,'Эта задача уже выполнена.');}
        await updatePrompt(ctx,'Договорились. Вернусь к «'+task.title+'» '+whenLabel(task)+'.');
        flows.delete(ctx.from.id);
        return;
      }catch(e){return updatePrompt(ctx,e.message);}
    }
    if (state.step==='title') {
      if (!text || text.length>200) return updatePrompt(ctx,'Название должно содержать от 1 до 200 символов.');
      state.title=text;
      state.step='date';
      return updatePrompt(ctx,'Когда напомнить?',{reply_markup:new InlineKeyboard().text('Сегодня','date:today').text('Завтра','date:tomorrow').row().text('Без напоминания','date:none').row().text('Ввести дату вручную','date:custom')});
    }
    if (state.step==='custom-date') {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return updatePrompt(ctx,'Напиши дату в формате ГГГГ-ММ-ДД, например 2026-11-24.');
      state.date=text;state.step='time';return updatePrompt(ctx,'Укажи время в формате ЧЧ:ММ, например 18:30. Часовой пояс: '+config.timeZone);
    }
    if (state.step==='time') {
      try { state.dueAt=localToIso(state.date,text,config.timeZone); if (Date.parse(state.dueAt)<=Date.now()) throw new Error('Время должно быть в будущем'); }
      catch(e){return updatePrompt(ctx,e.message);}
      state.step='recurrence';
      return updatePrompt(ctx,'Повторять задачу?',{reply_markup:new InlineKeyboard().text('Без повтора','repeat:none').text('Раз в неделю','repeat:weekly')});
    }
    if (state.step==='custom-category') {
      if (!text || text.length>40) return updatePrompt(ctx,'Категория должна содержать от 1 до 40 символов.');
      state.category=text;
      state.step='priority';return updatePrompt(ctx,'Насколько это важно?',{reply_markup:priorityButtons()});
    }
  });
  function categoryButtons() {
    const k=new InlineKeyboard();
    categories.forEach((c,i)=>{k.text(c,'cat:'+i);if(i%2===1)k.row();});
    return k.text('Другая категория','cat:other');
  }
  async function finish(ctx,state) {
    try {
      const t=store.create({title:state.title,category:state.category||'Личное',dueAt:state.dueAt||null,priority:state.priority||'medium',recurrence:state.recurrence});
      await updatePrompt(ctx,'✅ Задача создана: <b>'+safeText(t.title)+'</b>\nКатегория: '+safeText(t.category)+(t.due_at?'\nНапомню: '+localDate(new Date(t.due_at),config.timeZone)+' '+localTime(new Date(t.due_at),config.timeZone):'\nБез напоминания')+'\nПриоритет: '+priorityLabel(t.priority),{parse_mode:'HTML'});
      flows.delete(ctx.from.id);
    } catch(e) { await updatePrompt(ctx,'Не удалось создать задачу: '+e.message); }
  }
  bot.callbackQuery(/^date:(today|tomorrow|none|custom)$/,async ctx=>{
    const state=flows.get(ctx.from.id);
    await ctx.answerCallbackQuery();
    if (!state||state.step!=='date') return;
    const choice=ctx.match[1];
    if (choice==='custom') {state.step='custom-date';return updatePrompt(ctx,'Напиши дату в формате ГГГГ-ММ-ДД, например 2026-11-24.');}
    if(choice==='none'){state.dueAt=null;state.step='category';return updatePrompt(ctx,'Выбери категорию:',{reply_markup:categoryButtons()});}
    state.date=choice==='today'?today():shiftLocalDate(today(),1);
    state.step='time';
    return updatePrompt(ctx,'Укажи время в формате ЧЧ:ММ, например 18:30. Часовой пояс: '+config.timeZone);
  });
  bot.callbackQuery(/^repeat:(none|weekly)$/,async ctx=>{
    const state=flows.get(ctx.from.id);
    await ctx.answerCallbackQuery();
    if(!state||state.step!=='recurrence') return;
    state.recurrence=ctx.match[1]==='weekly'?'weekly':null;
    state.step='category';
    await updatePrompt(ctx,'Выбери категорию:',{reply_markup:categoryButtons()});
  });
  bot.callbackQuery(/^cat:(\d+|other)$/,async ctx=>{
    const state=flows.get(ctx.from.id);
    await ctx.answerCallbackQuery();
    if (!state||state.step!=='category') return;
    if(ctx.match[1]==='other'){state.step='custom-category';return updatePrompt(ctx,'Напиши название категории (до 40 символов).');}
    const category=categories[Number(ctx.match[1])];
    if(!category)return;
    state.category=category;
    state.step='priority';
    await updatePrompt(ctx,'Насколько это важно?',{reply_markup:priorityButtons()});
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
    if(task)await updatePrompt(ctx,'Начни с одного конкретного шага по «'+task.title+'». Я спрошу, как дела, через 20 минут.',{reply_markup:actions(task)});
  });
  bot.callbackQuery(/^progress:(\d+)$/,async ctx=>{
    const task=store.progress(Number(ctx.match[1]));
    await ctx.answerCallbackQuery({text:task?'Прогресс записан':'Задача уже завершена'});
    if(task)await updatePrompt(ctx,'Здорово, по «'+task.title+'» есть движение. До завершения ещё не дошли — вернусь через полчаса.',{reply_markup:actions(task)});
  });
  bot.callbackQuery(/^cant:(\d+)$/,async ctx=>{
    const task=store.get(Number(ctx.match[1]));
    await ctx.answerCallbackQuery();
    if(!task||task.status!=='active')return updatePrompt(ctx,'Эта задача уже завершена.');
    await updatePrompt(ctx,'Понял. Что сейчас мешает? Подберём нормальное время, а не будем переносить вслепую.',{
      reply_markup:new InlineKeyboard().text('Занят другим','reason:'+task.id+':busy').text('Нет сил','reason:'+task.id+':tired').row()
        .text('Не знаю, с чего начать','reason:'+task.id+':stuck').row().text('Не хочу сейчас','reason:'+task.id+':avoid')
    });
  });
  const reasonText={busy:'Давай перенесём на свободное время.',tired:'Не нужно выжимать из себя последнее. Выберем время попозже.',stuck:'Попробуй начать с самого маленького шага. А пока давай выберем время.',avoid:'Бывает. Если задача ещё нужна, выбери реальное время для неё.'};
  bot.callbackQuery(/^reason:(\d+):(busy|tired|stuck|avoid)$/,async ctx=>{
    const id=Number(ctx.match[1]),reason=ctx.match[2];
    const task=store.noteBlocker(id,reason);
    await ctx.answerCallbackQuery();
    if(!task)return updatePrompt(ctx,'Эта задача уже завершена.');
    flows.set(ctx.from.id,{step:'await-reschedule',taskId:id,reason,messageId:ctx.callbackQuery.message.message_id});
    await updatePrompt(ctx,reasonText[reason]+' Когда вернуться к задаче?',{reply_markup:postButtons(id)});
  });
  bot.callbackQuery(/^move:(\d+):(10|30|60|tomorrow|custom)$/,async ctx=>{
    const id=Number(ctx.match[1]),choice=ctx.match[2];
    const task=store.get(id);
    await ctx.answerCallbackQuery();
    if(!task||task.status!=='active')return updatePrompt(ctx,'Эта задача уже завершена.');
    const state=flows.get(ctx.from.id);
    const reason=state?.taskId===id?state.reason:'busy';
    if(choice==='custom'){
      flows.set(ctx.from.id,{step:'reschedule-custom',taskId:id,reason,revision:task.revision,messageId:ctx.callbackQuery.message.message_id});
      return updatePrompt(ctx,'Напиши новую дату и время одним сообщением в формате 2026-11-24 18:30. Часовой пояс: '+config.timeZone);
    }
    let dueAt;
    if(choice==='tomorrow'){
      const date=shiftLocalDate(today(),1);
      dueAt=localToIso(date,'09:00',config.timeZone);
    }else{dueAt=new Date(Date.now()+Number(choice)*60000).toISOString();}
    try{
      const moved=store.reschedule(id,dueAt,reason);
      if(state?.taskId===id)flows.delete(ctx.from.id);
      if(!moved)return updatePrompt(ctx,'Эта задача уже завершена.');
      const hint=behavioralHint(moved,store.recentEvents(40));
      await updatePrompt(ctx,'Хорошо, «'+moved.title+'» теперь на '+whenLabel(moved)+'.'+(hint?'\n\n'+hint:''));
    }catch(e){await updatePrompt(ctx,e.message);}
  });
  bot.callbackQuery(/^done:(\d+)$/,async ctx=>{
    const id=Number(ctx.match[1]);
    const current=store.get(id);
    if(current?.status==='active' && current.priority==='high' && current.progress_count===0){
      await ctx.answerCallbackQuery();
      return updatePrompt(ctx,'Это важное дело. Уже полностью готово или пока есть продвижение?',{
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
    await updatePrompt(ctx,'Окей, когда вернуться к этой задаче?',{reply_markup:postButtons(id)});
  });
  bot.callbackQuery(/^delay:(\d+):(10|30|60)$/,async ctx=>{
    const task=store.snooze(Number(ctx.match[1]),Number(ctx.match[2]));
    await ctx.answerCallbackQuery({text:task?'Отложено':'Задача уже завершена'});
    if(task) await ctx.editMessageText('⏰ «'+task.title+'» отложена на '+ctx.match[2]+' минут.').catch(()=>{});
  });
  bot.callbackQuery(/^unschedule:(\d+)$/,async ctx=>{
    store.unschedule(Number(ctx.match[1]));
    flows.delete(ctx.from.id);
    await ctx.answerCallbackQuery({text:'Задача осталась в списке без напоминания'});
  });
  bot.callbackQuery('noop',ctx=>ctx.answerCallbackQuery());
  async function sendReminder(task) {
    const hint=behavioralHint(task,store.recentEvents(40));
    const count=task.reminder_count||0;
    const intro=count===0?'🔔 <b>Вернёмся к делу?</b>':count===1?'🔔 <b>Есть минутка на это дело?</b>':count<4?'🔔 <b>Задача всё ещё ждёт</b>':'🔔 <b>Похоже, сейчас не до этой задачи</b>';
    const session = !count && {started:'Как продвигается работа?',progress:'Удалось закончить или нужно ещё время?'}[task.followup];
    const suggestion=session || (count>=3?'Если время неподходящее, нажми «Пока не могу» — выберем другое.':'Можешь начать сейчас или выбрать другое время.');
    await bot.api.sendMessage(config.owner,(session?'Проверим, как дела':intro)+'\n\n<b>'+safeText(task.title)+'</b>\n'+priorityLabel(task.priority)+' · '+safeText(task.category)+'\n\n'+suggestion+(hint?'\n\n'+safeText(hint):''),{parse_mode:'HTML',reply_markup:actions(task)});
  }
  async function sendDaily(kind){
    const text=kind==='morning'?morningBrief(store.list(),config.timeZone):eveningBrief(store.list(),config.timeZone,new Date(),store.eventsSince(new Date(Date.now()-48*3600000).toISOString()));
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
