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
export function createServer(config,store) {
  const app=express();
  app.disable('x-powered-by');
  app.use(express.json({limit:'16kb'}));
  app.get('/health',(_req,res)=>res.json({ok:true}));
  const tgAuth=(req,res,next)=>{
    if(!verifyTelegramInitData(req.get('X-Telegram-Init-Data'),config.botToken,config.owner)) return res.status(401).json({error:'Unauthorized'});
    next();
  };
  const integrationAuth=(req,res,next)=>{
    if(!config.integrationKey || config.integrationKey.length<24) return res.status(503).json({error:'Integration API is not configured'});
    const supplied=req.get('Authorization')?.replace(/^Bearer /i,'')||'';
    const a=Buffer.from(supplied),b=Buffer.from(config.integrationKey);
    if(a.length!==b.length||!crypto.timingSafeEqual(a,b))return res.status(401).json({error:'Unauthorized'});
    next();
  };
  const create=(req,res)=>{
    const {title,category,due_at}=req.body||{};
    const task=store.create({title,category,dueAt:due_at});
    res.status(201).json({task});
  };
  app.get('/api/tasks',tgAuth,(_req,res)=>res.json({tasks:store.list()}));
  app.post('/api/tasks',tgAuth,withErrors(create));
  app.post('/api/tasks/:id/done',tgAuth,withErrors((req,res)=>{
    const task=store.done(req.params.id);
    if(!task) return res.status(404).json({error:'Active task not found'});
    res.json({task});
  }));
  app.post('/api/tasks/:id/snooze',tgAuth,withErrors((req,res)=>{
    const task=store.snooze(req.params.id,Number(req.body?.minutes));
    if(!task) return res.status(404).json({error:'Active task not found'});
    res.json({task});
  }));
  app.get('/api/integration/tasks',integrationAuth,(_req,res)=>res.json({tasks:store.list()}));
  app.post('/api/integration/tasks',integrationAuth,withErrors(create));
  app.use(express.static(join(process.cwd(),'public'),{index:'index.html'}));
  app.use((err,_req,res,_next)=>{
    if(err.type==='entity.parse.failed')return res.status(400).json({error:'Malformed JSON'});
    if(err.message && /Название|Категория|дата|Дата|времени|будущем|часовым поясом/.test(err.message))return res.status(400).json({error:err.message});
    console.error('HTTP error:',err);
    res.status(500).json({error:'Internal server error'});
  });
  return app;
}
