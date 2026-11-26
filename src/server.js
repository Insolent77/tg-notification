import {localDate} from './dates.js';
import {rankTasks,morningBrief,eveningBrief} from './secretary.js';
import express from 'express';
import crypto from 'node:crypto';
import { join } from 'node:path';

export function verifyTelegramInitData(initData, botToken, owner) {
  if (typeof initData!=='string' || !initData || initData.length>8192) return false;
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash || !/^[a-f0-9]{64}$/i.test(hash)) return false;
  params.delete('hash');
  const fields = [...params.entries()].sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>k+'='+v).join('\n');
  const secret = crypto.createHmac('sha256','WebAppData').update(botToken).digest();
  const expected = crypto.createHmac('sha256',secret).update(fields).digest();
  if (!crypto.timingSafeEqual(expected,Buffer.from(hash,'hex'))) return false;
  const authDate = Number(params.get('auth_date'));
  if (!Number.isFinite(authDate) || Math.abs(Date.now()/1000-authDate)>86400) return false;
  try { return JSON.parse(params.get('user')||'null')?.id === owner; } catch { return false; }
}
function withErrors(fn) {
  return (req,res,next)=>Promise.resolve().then(()=>fn(req,res)).catch(next);
}
export function createServer(config,store,savePicker, members=new Map([[config.owner,{store,savePicker}]])) {
  const app=express();
  app.disable('x-powered-by');
  app.use(express.json({limit:'16kb'}));
  app.get('/dates.js',(_req,res)=>res.sendFile(join(process.cwd(),'src','dates.js')));
  app.get('/health',(_req,res)=>res.json({ok:true}));
  const tgAuth=(req,res,next)=>{
    const signedData=req.get('X-Telegram-Init-Data');
    for(const [id,member] of members){
      const allowed=signedData ? verifyTelegramInitData(signedData,config.botToken,id)
        : req.path.startsWith('/api/tasks') && member.store.acceptsKeyboard(req.get('X-Keyboard-Ticket'),req.get('X-Keyboard-Device'));
      if(allowed){
        req.member=member;
        return next();
      }
    }
    return res.status(401).json({error:'Unauthorized'});
  };
  app.use('/flatpickr',express.static(join(process.cwd(),'node_modules','flatpickr','dist')));
  app.post('/api/picker',tgAuth,withErrors(async(req,res)=>{
    try { await req.member.savePicker(req.body); }
    catch(error) { return res.status(400).json({error:error.message}); }
    res.json({ok:true});
  }));
  const integrationAuth=(...keys)=>(req,res,next)=>{
    const enabled=keys.filter(key=>key && key.length>=24);
    if(!enabled.length)return res.status(503).json({error:'Integration disabled'});
    const match=/^Bearer (\S+)$/i.exec(req.get('Authorization')||'');
    const supplied=Buffer.from(match?.[1]||'');
    if(!enabled.some(key=>{const expected=Buffer.from(key);return supplied.length===expected.length && crypto.timingSafeEqual(supplied,expected);}))
      return res.status(401).json({error:'Unauthorized'});
    next();
  };
  const create=(req,res)=>{
    const {title,category,due_at,priority}=req.body||{};
    const recurrence=req.path==='/api/tasks' ? req.body?.recurrence : null;
    const task=(req.member?.store ?? store).create({title,category,dueAt:due_at,priority,recurrence});
    res.status(201).json({task});
  };
  app.get('/api/tasks',tgAuth,(req,res)=>res.json({timeZone:config.timeZone,tasks:req.member.store.list(),recommended:rankTasks(req.member.store.list().filter(t=>t.due_at && localDate(new Date(t.due_at),config.timeZone)<=localDate(new Date(),config.timeZone))).slice(0,3).map(t=>t.id)}));
  app.get('/api/briefing',tgAuth,(req,res)=>res.json({morning:morningBrief(req.member.store.list(),config.timeZone),evening:eveningBrief(req.member.store.list(),config.timeZone,new Date(),req.member.store.eventsSince(new Date(Date.now()-48*3600000).toISOString()))}));
  const updateTask=(action)=>withErrors((req,res)=>{
    const id=Number(req.params.id);
    const task=action(req.member.store,id,req.body||{});
    if(!task)return res.status(404).json({error:'Active task not found'});
    res.json({task});
  });
  app.post('/api/tasks/:id/priority',tgAuth,updateTask((store,id,data)=>store.setPriority(id,data.priority)));
  app.post('/api/tasks/:id/progress',tgAuth,updateTask((store,id)=>store.progress(id)));
  app.post('/api/tasks/:id/start',tgAuth,updateTask((store,id)=>store.started(id)));
  app.post('/api/tasks/:id/reschedule',tgAuth,updateTask((store,id,data)=>store.reschedule(id,data.due_at,data.reason||'busy')));
  app.post('/api/tasks/:id/blocker',tgAuth,updateTask((store,id,data)=>store.noteBlocker(id,data.reason)));
  app.post('/api/tasks',tgAuth,withErrors(create));
  app.post('/api/tasks/:id/done',tgAuth,withErrors((req,res)=>{
    const task=req.member.store.done(req.params.id);
    if(!task) return res.status(404).json({error:'Active task not found'});
    res.json({task});
  }));
  app.post('/api/tasks/:id/snooze',tgAuth,withErrors((req,res)=>{
    const task=req.member.store.snooze(req.params.id,Number(req.body?.minutes));
    if(!task) return res.status(404).json({error:'Active task not found'});
    res.json({task});
  }));
  app.get('/api/integration/tasks',integrationAuth(config.integrationKey),(_req,res)=>res.json({tasks:store.list()}));
  app.post('/api/integration/tasks',integrationAuth(config.integrationKey,config.createKey),withErrors(create));
  app.use(express.static(join(process.cwd(),'public'),{index:'index.html'}));
  app.use((err,_req,res,_next)=>{
    if(err.type==='entity.parse.failed')return res.status(400).json({error:'Malformed JSON'});
    if(err.message && /Название|Категория|дата|Дата|времени|будущем|часовым поясом|приоритет|причина|время|Неверн/.test(err.message))return res.status(400).json({error:err.message});
    console.error('HTTP error:',err);
    res.status(500).json({error:'Internal server error'});
  });
  return app;
}
