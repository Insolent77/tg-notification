import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openStore} from '../src/store.js';
import {createServer} from '../src/server.js';

test('signed Mini App sessions can only list and complete their own tasks',async t=>{
  const dir=mkdtempSync(join(tmpdir(),'members-'));
  const config={owner:1,botToken:'local-test',timeZone:'Europe/Moscow'};
  const members=new Map([1,2].map(id=>[id,{store:openStore(join(dir,'tasks.db'),id)}]));
  const server=createServer(config,members.get(1).store,null,members).listen(0,'127.0.0.1');
  t.after(async()=>{
    await new Promise(resolve=>server.close(resolve));
    for(const member of members.values())member.store.close();
    rmSync(dir,{recursive:true});
  });
  await new Promise(resolve=>server.once('listening',resolve));
  const request=(id,path,method='GET',body)=>{
    const params=new URLSearchParams({auth_date:String(Math.floor(Date.now()/1000)),user:JSON.stringify({id})});
    const key=createHmac('sha256','WebAppData').update(config.botToken).digest();
    params.set('hash',createHmac('sha256',key).update([...params].map(pair=>pair.join('=')).join('\n')).digest('hex'));
    return fetch('http://127.0.0.1:'+server.address().port+'/api/tasks'+path,{method,body:JSON.stringify(body),headers:{
      'Content-Type':'application/json','X-Telegram-Init-Data':params.toString()
    }});
  };
  const created=await request(2,'','POST',{title:'Личная задача'});
  assert.equal(created.status,201);
  const {task}=await created.json();
  assert.equal(task.owner_id,2);
  assert.equal((await (await request(1,'')).json()).tasks.length,0);
  assert.equal((await request(1,'/'+task.id+'/done','POST')).status,404);
  assert.equal((await request(3,'')).status,401);
  assert.equal((await request(2,'/'+task.id+'/done','POST')).status,200);
});
