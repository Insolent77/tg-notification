import {localDate,localTime} from './dates.js';
import { readConfig } from './config.js';
import { openStore } from './store.js';
import { createBot } from './bot.js';
import { createServer } from './server.js';

const config=readConfig();
const store=openStore(config.databasePath,config.owner);
const {bot,sendReminder,sendDaily}=createBot(config,store);
const app=createServer(config,store);
let running=false;
const isQuiet=hour=>config.quietFrom===config.quietUntil?false:config.quietFrom<config.quietUntil
  ?hour>=config.quietFrom&&hour<config.quietUntil
  :hour>=config.quietFrom||hour<config.quietUntil;
const repeatMs=task=>({high:config.repeatMinutes,medium:Math.max(30,config.repeatMinutes),low:Math.max(120,config.repeatMinutes)}[task.priority]??30)*60000;
async function tick() {
  if(running)return;
  running=true;
  try {
    const now=new Date();
    const hour=Number(localTime(now,config.timeZone).split(':')[0]);
    const day=localDate(now,config.timeZone);
    for (const [kind,target] of [['morning',config.morningHour],['evening',config.eveningHour]]) {
      if(hour===target && store.dailyClaim(day,kind)){
        try{await sendDaily(kind);}catch(err){store.dailyUnclaim(day,kind);console.error('Daily digest failed:',err.message);}
      }
    }
    if(isQuiet(hour))return;
    for(const task of store.due()) {
      const next=new Date(Date.now()+repeatMs(task)).toISOString();
      if(!store.claim(task.id,task.next_notify_at,next))continue;
      try {await sendReminder(task);}
      catch(err) {
        store.restoreClaim(task.id,next,task.next_notify_at);
        console.error('Reminder send failed for task',task.id,err.message);
      }
    }
  } finally {running=false;}
}
const server=app.listen(config.port,()=>console.log('Web server listening on port',config.port));
bot.catch(err=>console.error('Telegram bot error:',err.error));
bot.start({onStart:()=>console.log('Telegram bot polling started')}).catch(err=>{console.error('Polling failed:',err);process.exitCode=1;});
const interval=setInterval(()=>tick().catch(console.error),15000);
setTimeout(()=>tick().catch(console.error),2500);
async function shutdown(){
  clearInterval(interval);
  bot.stop();
  await new Promise(resolve=>server.close(resolve));
  store.close();
}
process.once('SIGINT',()=>shutdown().then(()=>process.exit(0)));
process.once('SIGTERM',()=>shutdown().then(()=>process.exit(0)));
