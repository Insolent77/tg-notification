import 'dotenv/config';

export function readConfig(env = process.env) {
  const botToken = env.BOT_TOKEN?.trim();
  const owner = Number(env.OWNER_TELEGRAM_ID);
  if (!botToken) throw new Error('BOT_TOKEN must be set');
  if (!Number.isSafeInteger(owner) || owner <= 0) throw new Error('OWNER_TELEGRAM_ID must be a positive number');
  const port = Number(env.PORT || 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT is invalid');
  const repeatMinutes = Number(env.REMINDER_INTERVAL_MINUTES || 10);
  if (!Number.isInteger(repeatMinutes) || repeatMinutes < 1 || repeatMinutes > 1440) throw new Error('REMINDER_INTERVAL_MINUTES must be 1–1440');
  const timeZone = env.TZ_NAME || 'Europe/Moscow';
  try { new Intl.DateTimeFormat('ru-RU', { timeZone }); } catch { throw new Error('TZ_NAME must be a valid IANA time zone'); }
  const publicUrl = (env.PUBLIC_URL || '').trim().replace(/\/$/, '');
  if (publicUrl && !/^https:\/\//.test(publicUrl)) throw new Error('PUBLIC_URL must be HTTPS');
  return {
    botToken, owner, port, repeatMinutes, timeZone, publicUrl,
    databasePath: env.DATABASE_PATH || './data/tasks.sqlite',
    integrationKey: (env.INTEGRATION_API_KEY || '').trim()
  };
}
