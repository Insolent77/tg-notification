import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openStore} from '../src/store.js';
import {rankTasks,morningBrief,eveningBrief,behavioralHint} from '../src/secretary.js';

test('personal assistant flow persists priorities and reschedules without completing',()=>{
  const dir=mkdtempSync(join(tmpdir(),'tg-notification-'));
  let store;
  try{
    store=openStore(join(dir,'test.sqlite'),123);
    const due=new Date(Date.now()+3600000).toISOString();
    const urgent=store.create({title:'Сдать презентацию',priority:'high',category:'Работа',dueAt:due});
    const minor=store.create({title:'Купить лампочку',priority:'low'});
    assert.equal(rankTasks(store.list())[0].id,urgent.id);
    assert.equal(store.started(urgent.id).status,'active');
    assert.equal(store.progress(urgent.id).progress_count,1);
    assert.equal(store.noteBlocker(urgent.id,'busy').last_reason,'busy');
    const later=new Date(Date.now()+7200000).toISOString();
    const moved=store.reschedule(urgent.id,later,'busy');
    assert.equal(moved.postponed_count,1);
    assert.equal(moved.due_at,later);
    assert.equal(moved.next_notify_at,later);
    assert.ok(store.recentEvents().some(e=>e.action==='reschedule'&&e.reason==='busy'));
    store.reschedule(urgent.id,new Date(Date.now()+10800000).toISOString(),'busy');
    const again=store.reschedule(urgent.id,new Date(Date.now()+14400000).toISOString(),'busy');
    assert.match(behavioralHint(again,store.recentEvents()),/несколько раз/);
    assert.equal(store.done(urgent.id).status,'done');
    assert.equal(store.done(urgent.id),null);
    assert.equal(store.list().length,2);
    assert.equal(store.setPriority(minor.id,'medium').priority,'medium');
    assert.equal(store.dailyClaim('2026-11-22','morning'),true);
    assert.equal(store.dailyClaim('2026-11-22','morning'),false);
    store.dailyUnclaim('2026-11-22','morning');
    assert.equal(store.dailyClaim('2026-11-22','morning'),true);
  }finally{store?.close();rmSync(dir,{recursive:true,force:true});}
});
test('daily messages do not invent tasks',()=>{
  assert.match(morningBrief([],'Europe/Moscow'),/задач.*нет/);
  assert.match(eveningBrief([],'Europe/Moscow'),/выполнено 0/);
});
test('ranked tasks always prioritize high over low without due dates',()=>{
  const ts=[{id:1,status:'active',priority:'low',due_at:null},{id:2,status:'active',priority:'high',due_at:null}];
  assert.deepEqual(rankTasks(ts).map(t=>t.id),[2,1]);
});
