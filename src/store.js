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
  `);
  const now = () => new Date().toISOString();
  const getStatement = db.prepare('SELECT * FROM tasks WHERE id = ? AND owner_id = ?');
  const insert = db.prepare('INSERT INTO tasks (owner_id,title,category,due_at,next_notify_at,status,created_at) VALUES (?, ?, ?, ?, ?, \'active\', ?)');
  const updateDone = db.prepare("UPDATE tasks SET status='done', next_notify_at=NULL, completed_at=? WHERE id=? AND owner_id=? AND status='active'");
  const updateSnooze = db.prepare("UPDATE tasks SET next_notify_at=? WHERE id=? AND owner_id=? AND status='active'");
  const selectDue = db.prepare("SELECT * FROM tasks WHERE owner_id=? AND status='active' AND next_notify_at IS NOT NULL AND next_notify_at<=? ORDER BY next_notify_at LIMIT 25");
  const claim = db.prepare("UPDATE tasks SET next_notify_at=? WHERE id=? AND owner_id=? AND status='active' AND next_notify_at=?");
  const store = {
    create({ title, category='Личное', dueAt=null }) {
      const cleanTitle = String(title || '').trim();
      const cleanCategory = String(category || 'Личное').trim();
      if (!cleanTitle || cleanTitle.length > 200) throw new Error('Название задачи должно содержать 1–200 символов');
      if (!cleanCategory || cleanCategory.length > 40) throw new Error('Категория должна содержать 1–40 символов');
      let iso = null;
      if (dueAt != null && dueAt !== '') {
        if (typeof dueAt !== 'string' || !/(Z|[+-]\d\d:\d\d)$/.test(dueAt)) throw new Error('Укажите дату ISO 8601 с часовым поясом');
        const timestamp = Date.parse(dueAt);
        if (!Number.isFinite(timestamp)) throw new Error('Неверная дата');
        if (timestamp <= Date.now()) throw new Error('Напоминание должно быть в будущем');
        iso = new Date(timestamp).toISOString();
      }
      const result = insert.run(ownerId, cleanTitle, cleanCategory, iso, iso, now());
      return store.get(Number(result.lastInsertRowid));
    },
    get(id) { return getStatement.get(Number(id), ownerId) || null; },
    list() { return db.prepare('SELECT * FROM tasks WHERE owner_id=? ORDER BY status ASC, CASE WHEN due_at IS NULL THEN 1 ELSE 0 END, due_at ASC, created_at DESC').all(ownerId); },
    done(id) { const result = updateDone.run(now(), Number(id), ownerId); return result.changes ? store.get(id) : null; },
    snooze(id, minutes) {
      if (!Number.isInteger(minutes) || minutes < 1 || minutes > 1440) throw new Error('Неверное время откладывания');
      const nextAt = new Date(Date.now() + minutes * 60000).toISOString();
      const result = updateSnooze.run(nextAt, Number(id), ownerId);
      return result.changes ? store.get(id) : null;
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
