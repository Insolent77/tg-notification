import test from 'node:test';
import assert from 'node:assert/strict';
import {openStore} from '../src/store.js';
import {createBot} from '../src/bot.js';
import {createServer} from '../src/server.js';

test('start sends one persistent Web App keyboard and both views use the member list',async t=>{
  const config={owner:123,botToken:'1:test',timeZone:'Europe/Moscow',publicUrl:'https://example.org'};
  const store=openStore(':memory:',123);
  const other=openStore(':memory:',456);
  other.create({title:'Another member'});
  const messages=[];
  const {bot}=createBot(config,store,{client:{fetch:async(url,init)=>{
    messages.push(JSON.parse(init.body));
    return Response.json({ok:true,result:{message_id:1,chat:{id:123,type:'private'},date:1}});
  }}});
  bot.botInfo={id:1,is_bot:true,first_name:'Test',username:'test_bot'};
  await bot.handleUpdate({update_id:1,message:{message_id:1,date:1,chat:{id:123,type:'private'},
    from:{id:123,is_bot:false,first_name:'Test'},text:'/start',entities:[{type:'bot_command',offset:0,length:6}]}});
  assert.equal(messages.length,1);
  const markup=messages[0].reply_markup;
  assert.equal(markup.is_persistent,true);
  const [create,list]=markup.keyboard[0].map(button=>new URL(button.web_app.url));
  assert.equal(create.searchParams.get('view'),'create');
  assert.equal(list.searchParams.has('view'),false);
  assert.equal(list.hash,create.hash);
  const ticket=new URLSearchParams(list.hash.slice(1)).get('keyboard');
  const members=new Map([[456,{store:other}],[123,{store}]]);
  const server=createServer(config,store,null,members).listen(0,'127.0.0.1');
  await new Promise(resolve=>server.once('listening',resolve));
  t.after(async()=>{await new Promise(resolve=>server.close(resolve));store.close();other.close();});
  const url='http://127.0.0.1:'+server.address().port+'/api/tasks';
  const headers={'X-Keyboard-Ticket':ticket,'X-Keyboard-Device':'a'.repeat(64),'Content-Type':'application/json'};
  assert.equal((await fetch(url)).status,401);
  const response=await fetch(url,{headers});
  assert.deepEqual((await response.json()).tasks,[]);
  assert.equal((await fetch(url,{headers:{...headers,'X-Keyboard-Device':'b'.repeat(64)}})).status,401);
  assert.equal((await fetch(url,{headers,method:'POST',body:JSON.stringify({title:'From keyboard'})})).status,201);
  assert.equal((await (await fetch(url,{headers})).json()).tasks[0].title,'From keyboard');
  store.issueKeyboard();
  assert.equal((await fetch(url,{headers})).status,401);
});
