import test from 'node:test';
import assert from 'node:assert/strict';
import {openStore} from '../src/store.js';
import {createBot} from '../src/bot.js';

test('calendar creates a task and ignores an expired picker button',async()=>{
  const store=openStore(':memory:',123);
  const calls=[];
  const client={fetch:async(url,init)=>{
    const method=String(url).split('/').at(-1);
    const payload=JSON.parse(init.body);
    calls.push({method,payload});
    return Response.json({ok:true,result:method==='sendMessage'?{message_id:42,chat:{id:123,type:'private'},date:1,text:payload.text}:true});
  }};
  const {bot}=createBot({owner:123,timeZone:'Europe/Moscow',botToken:'1:test'},store,{client});
  bot.botInfo={id:1,is_bot:true,first_name:'Test',username:'test_bot'};
  const from={id:123,is_bot:false,first_name:'Test'};
  const msg=(text,id=1)=>({message_id:id,date:1,chat:{id:123,type:'private'},from,text});
  const message=async(text,id)=>bot.handleUpdate({update_id:id,message:msg(text,id)});
  const button=async(data,id)=>bot.handleUpdate({update_id:id,callback_query:{id:String(id),from,message:msg('prompt',42),chat_instance:'1',data}});
  const pick=(prefix)=>calls.at(-1).payload.reply_markup.inline_keyboard.flat().find(x=>x.callback_data?.includes(prefix)).callback_data;
  try {
    await message('➕ Создать задачку',1);
    await message('Календарь',2);
    await button('date:tomorrow',3);
    const hour=pick(':h:12');
    await button(hour,4);
    const minute=pick(':n:37');
    await button(minute,5);
    assert.match(calls.at(-1).payload.text,/Повторять/);
    const edits=calls.filter(x=>x.method==='editMessageText').length;
    await button(minute,6);
    assert.equal(calls.filter(x=>x.method==='editMessageText').length,edits);
    await button('repeat:none',7);
    await button('cat:0',8);
    await button('priority:medium',9);
    const task=store.list()[0];
    assert.equal(task.title,'Календарь');
    assert.match(task.due_at,/T09:37:00.000Z$/);
    assert.ok(calls.some(x=>x.method==='editMessageText'));
  } finally {store.close();}
});

test('typed time creates a task after date selection',async()=>{
  const store=openStore(':memory:',123);
  const calls=[];
  const client={fetch:async(url,init)=>{
    const method=String(url).split('/').at(-1);
    const payload=JSON.parse(init.body);
    calls.push({method,payload});
    return Response.json({ok:true,result:method==='sendMessage'?{message_id:42,chat:{id:123,type:'private'},date:1,text:payload.text}:true});
  }};
  const {bot}=createBot({owner:123,timeZone:'Europe/Moscow',botToken:'1:test'},store,{client});
  bot.botInfo={id:1,is_bot:true,first_name:'Test',username:'test_bot'};
  const from={id:123,is_bot:false,first_name:'Test'};
  const msg=(text,id=1)=>({message_id:id,date:1,chat:{id:123,type:'private'},from,text});
  const message=async(text,id)=>bot.handleUpdate({update_id:id,message:msg(text,id)});
  const button=async(data,id)=>bot.handleUpdate({update_id:id,callback_query:{id:String(id),from,message:msg('prompt',42),chat_instance:'1',data}});
  const pick=(prefix)=>calls.at(-1).payload.reply_markup.inline_keyboard.flat().find(x=>x.callback_data?.includes(prefix)).callback_data;
  try {
    await message('➕ Создать задачку',1);
    await message('Календарь',2);
    await button('date:tomorrow',3);
    await message('12:37',5);
    assert.match(calls.at(-1).payload.text,/Повторять/);

    await button('repeat:none',7);
    await button('cat:0',8);
    await button('priority:medium',9);
    const task=store.list()[0];
    assert.equal(task.title,'Календарь');
    assert.match(task.due_at,/T09:37:00.000Z$/);
    assert.ok(calls.some(x=>x.method==='editMessageText'));
  } finally {store.close();}
});
