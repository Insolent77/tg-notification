import test from 'node:test';
import assert from 'node:assert/strict';
import {parseRequest} from '../src/intake.js';
import {openStore} from '../src/store.js';
import {createServer} from '../src/server.js';
import {eveningBrief} from '../src/secretary.js';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

test('direct request uses owner calendar and leaves questions alone',()=>{
  const now=new Date('2026-11-22T23:00:00Z');
  assert.deepEqual(parseRequest('Поставь задачу купить масло завтра в 18:00','Europe/Moscow',now),
    {title:'купить масло',dueAt:'2026-11-24T15:00:00.000Z'});
  assert.equal(parseRequest('Что такое антифриз?','UTC'),null);
  assert.throws(()=>parseRequest('Напомни купить масло вечером','UTC'));
});

test('create-only Action and Telegram use one persistent list',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'tg-intake-'));
  const path=join(dir,'tasks.db');
  let store=openStore(path,123);
  const config={owner:123,timeZone:'UTC',createKey:'c'.repeat(32),integrationKey:'o'.repeat(32)};
  const server=createServer(config,store).listen(0,'127.0.0.1');
  try {
    await new Promise(resolve=>server.once('listening',resolve));
    const url='http://127.0.0.1:'+server.address().port+'/api/integration/tasks';
    const headers={Authorization:'Bearer '+config.createKey,'Content-Type':'application/json'};
    assert.equal((await fetch(url,{headers})).status,401);
    const result=await fetch(url,{method:'POST',headers,body:JSON.stringify({title:'Из GPT'})});
    assert.equal(result.status,201);
    const task=store.createFromMessage(456,1,{title:'Из Telegram'});
    assert.equal(store.createFromMessage(456,1,{title:'Повтор'}).id,task.id);
    store.started(task.id);
    store.progress(task.id);
    const moved=store.snooze(task.id,60);
    assert.equal(moved.next_notify_at,moved.due_at);
    assert.ok(moved.revision>task.revision);
    store.close();
    store=openStore(path,123);
    assert.equal(store.list().length,2);
    assert.equal(store.get(task.id).next_notify_at,moved.due_at);
    assert.match(eveningBrief(store.list(),'UTC',new Date(),store.eventsSince('2000')),/продвижение/);
    store.unschedule(task.id);
    assert.equal(store.get(task.id).next_notify_at,null);
  } finally {
    await new Promise(resolve=>server.close(resolve));
    store.close();rmSync(dir,{recursive:true,force:true});
  }
});

test('Telegram accepts guest request, isolates owner data and rejects stale callbacks',async()=>{
  const {createBot}=await import('../src/bot.js');
  const store=openStore(':memory:',123);
  const calls=[];
  const client={fetch:async(url,init)=>{
    calls.push({method:String(url).split('/').at(-1),payload:JSON.parse(init.body)});
    return Response.json({ok:true,result:true});
  }};
  const {bot,sendReminder}=createBot({owner:123,guest:456,timeZone:'Europe/Moscow',botToken:'1:test'},store,{client});
  bot.botInfo={id:1,is_bot:true,first_name:'Test',username:'test_bot'};
  const message=(id,text)=>({message_id:1,date:1,chat:{id,type:'private'},from:{id,is_bot:false,first_name:'Tester'},text});
  try{
    await bot.handleUpdate({update_id:1,message:message(456,'Поставь задачу купить масло завтра в 18:00')});
    const [task]=store.list();
    assert.equal(task.title,'купить масло');
    await bot.handleUpdate({update_id:2,message:message(456,'/tasks')});
    assert.match(calls.at(-1).payload.text,/Напиши/);
    const callback=(user,data)=>({update_id:3,callback_query:{id:'query',from:message(user,'').from,message:message(user,''),chat_instance:'1',data}});
    await bot.handleUpdate(callback(456,'done:'+task.id+'~0'));
    assert.equal(store.get(task.id).status,'active');
    await sendReminder(task);
    const old=calls.at(-1).payload.reply_markup.inline_keyboard[0][0].callback_data;
    assert.equal(old,'start:'+task.id+'~0');
    await bot.handleUpdate(callback(123,old));
    assert.equal(store.get(task.id).followup,'started');
    await bot.handleUpdate(callback(123,old));
    assert.match(calls.at(-1).payload.text,/устарела/);
  }finally{store.close();}
});
