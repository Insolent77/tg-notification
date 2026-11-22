import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export function openStore(path, ownerId) {
  mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.pragma('busy_timeout = 5000');
  db.exec(`
    CREATE TABLE IF NOT EXISTS tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      owner_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT 'Личное',
      due_at TEXT,
      next_notify_at TEXT,
      status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','done')),
      created_at TEXT NOT NULL,
      completed_at TEXT
    );
    CREATE INDEX IF NOT EXISTS task_due_idx ON tasks(owner_id, status, next_notify_at);
    CREATE TABLE IF NOT EXISTS task_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id INTEGER NOT NULL,
      action TEXT NOT NULL,
      reason TEXT,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS daily_messages (
      owner_id INTEGER NOT NULL,
      day TEXT NOT NULL,
      kind TEXT NOT NULL,
      PRIMARY KEY (owner_id,day,kind)
    );
  `);
  const columns=db.prepare("PRAGMA table_info(tasks)").all().map(x=>x.name);
  if(!columns.includes('priority')) db.exec("ALTER TABLE tasks ADD COLUMN priority TEXT NOT NULL DEFAULT 'medium'");
  if(!columns.includes('progress_count')) db.exec("ALTER TABLE tasks ADD COLUMN progress_count INTEGER NOT NULL DEFAULT 0");
  if(!columns.includes('postponed_count')) db.exec("ALTER TABLE tasks ADD COLUMN postponed_count INTEGER NOT NULL DEFAULT 0");
  if(!columns.includes('last_reason')) db.exec("ALTER TABLE tasks ADD COLUMN last_reason TEXT");
  if(!columns.includes('started_at')) db.exec("ALTER TABLE tasks ADD COLUMN started_at TEXT");
  const now = () => new Date().toISOString();
  const event=(id,action,reason=null)=>db.prepare('INSERT INTO task_events(task_id,action,reason,created_at) VALUES (?,?,?,?)').run(id,action,reason,now());
  const getStatement = db.prepare('SELECT * FROM tasks WHERE id = ? AND owner_id = ?');
  const insert = db.prepare("INSERT INTO tasks (owner_id,title,category,due_at,next_notify_at,status,created_at,priority) VALUES (?, ?, ?, ?, ?, 'active', ?, ?)");
  const updateDone = db.prepare("UPDATE tasks SET status='done', next_notify_at=NULL, completed_at=? WHERE id=? AND owner_id=? AND status='active'");
  const updateSnooze = db.prepare("UPDATE tasks SET next_notify_at=? WHERE id=? AND owner_id=? AND status='active'");
  const updateSchedule = db.prepare("UPDATE tasks SET due_at=?, next_notify_at=? WHERE id=? AND owner_id=? AND status='active'");
  const selectDue = db.prepare("SELECT * FROM tasks WHERE owner_id=? AND status='active' AND next_notify_at IS NOT NULL AND next_notify_at<=? ORDER BY next_notify_at LIMIT 25");
  const claim = db.prepare("UPDATE tasks SET next_notify_at=? WHERE id=? AND owner_id=? AND status='active' AND next_notify_at=?");
  const store = {
    create({ title, category='Личное', dueAt=null, priority='medium' }) {
      const cleanTitle = String(title || '').trim();
      const cleanCategory = String(category || 'Личное').trim();
      if (!cleanTitle || cleanTitle.length > 200) throw new Error('Название задачи должно содержать 1–200 символов');
      if (!cleanCategory || cleanCategory.length > 40) throw new Error('Категория должна содержать 1–40 символов');
      if (!['high','medium','low'].includes(priority)) throw new Error('Неверный приоритет');
      let iso = null;
      if (dueAt != null && dueAt !== '') {
        if (typeof dueAt !== 'string' || !/(Z|[+-]\d\d:\d\d)$/.test(dueAt)) throw new Error('Укажите дату ISO 8601 с часовым поясом');
        const timestamp = Date.parse(dueAt);
        if (!Number.isFinite(timestamp)) throw new Error('Неверная дата');
        if (timestamp <= Date.now()) throw new Error('Напоминание должно быть в будущем');
        iso = new Date(timestamp).toISOString();
      }
      const result = insert.run(ownerId, cleanTitle, cleanCategory, iso, iso, now(), priority);
      return store.get(Number(result.lastInsertRowid));
    },
    get(id) { return getStatement.get(Number(id), ownerId) || null; },
    list() { return db.prepare('SELECT * FROM tasks WHERE owner_id=? ORDER BY status ASC, CASE WHEN due_at IS NULL THEN 1 ELSE 0 END, due_at ASC, created_at DESC').all(ownerId); },
    done(id) {
      const result = updateDone.run(now(), Number(id), ownerId);
      if(result.changes)event(Number(id),'done');
      return result.changes ? store.get(id) : null;
    },
    snooze(id, minutes) {
      if (!Number.isInteger(minutes) || minutes < 1 || minutes > 1440) throw new Error('Неверное время откладывания');
      const nextAt = new Date(Date.now() + minutes * 60000).toISOString();
      const result = updateSnooze.run(nextAt, Number(id), ownerId);
      if(result.changes)event(Number(id),'snooze',String(minutes));
      return result.changes ? store.get(id) : null;
    },
    reschedule(id, dueAt, reason='busy') {
      if (typeof dueAt !== 'string' || !Number.isFinite(Date.parse(dueAt))) throw new Error('Неверная дата');
      const timestamp = Date.parse(dueAt);
      if (timestamp <= Date.now()) throw new Error('Время должно быть в будущем');
      const iso = new Date(timestamp).toISOString();
      const result = updateSchedule.run(iso, iso, Number(id), ownerId);
      if(result.changes){
        db.prepare("UPDATE tasks SET postponed_count=postponed_count+1,last_reason=? WHERE id=? AND owner_id=?").run(reason,Number(id),ownerId);
        event(Number(id),'reschedule',reason);
      }
      return result.changes ? store.get(id) : null;
    },
    setPriority(id,priority) {
      if(!['high','medium','low'].includes(priority))throw new Error('Неверный приоритет');
      const result=db.prepare("UPDATE tasks SET priority=? WHERE id=? AND owner_id=? AND status='active'").run(priority,Number(id),ownerId);
      if(result.changes)event(Number(id),'priority',priority);
      return result.changes?store.get(id):null;
    },
    started(id) {
      const next=new Date(Date.now()+20*60000).toISOString();
      const result=db.prepare("UPDATE tasks SET started_at=?,next_notify_at=? WHERE id=? AND owner_id=? AND status='active'").run(now(),next,Number(id),ownerId);
      if(result.changes)event(Number(id),'started');
      return result.changes?store.get(id):null;
    },
    progress(id) {
      const next=new Date(Date.now()+30*60000).toISOString();
      const result=db.prepare("UPDATE tasks SET progress_count=progress_count+1,next_notify_at=? WHERE id=? AND owner_id=? AND status='active'").run(next,Number(id),ownerId);
      if(result.changes)event(Number(id),'progress');
      return result.changes?store.get(id):null;
    },
    noteBlocker(id,reason) {
      const allowed=['busy','tired','stuck','avoid'];
      if(!allowed.includes(reason))throw new Error('Неверная причина');
      const result=db.prepare("UPDATE tasks SET last_reason=? WHERE id=? AND owner_id=? AND status='active'").run(reason,Number(id),ownerId);
      if(result.changes)event(Number(id),'blocker',reason);
      return result.changes?store.get(id):null;
    },
    dailyClaim(day,kind) {
      const result=db.prepare("INSERT OR IGNORE INTO daily_messages(owner_id,day,kind) VALUES (?,?,?)").run(ownerId,day,kind);
      return result.changes>0;
    },
    dailyUnclaim(day,kind) {
      db.prepare("DELETE FROM daily_messages WHERE owner_id=? AND day=? AND kind=?").run(ownerId,day,kind);
    },
    recentEvents(limit=100) {
      return db.prepare("SELECT e.*,t.title,t.category FROM task_events e INNER JOIN tasks t ON t.id=e.task_id WHERE t.owner_id=? ORDER BY e.created_at DESC LIMIT ?").all(ownerId,limit);
    },
    due() { return selectDue.all(ownerId, now()); },
    claim(id, currentNext, nextTime) { return claim.run(nextTime, Number(id), ownerId, currentNext).changes > 0; },
    restoreClaim(id, expectedNext, previousNext) {
      db.prepare("UPDATE tasks SET next_notify_at=? WHERE id=? AND owner_id=? AND status='active' AND next_notify_at=?").run(previousNext, Number(id), ownerId, expectedNext);
    },
    close() { db.close(); }
  };
  return store;
}
