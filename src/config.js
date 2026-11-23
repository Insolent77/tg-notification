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
  const morningHour=Number(env.MORNING_HOUR ?? 9);
  const eveningHour=Number(env.EVENING_HOUR ?? 21);
  if(![morningHour,eveningHour].every(h=>Number.isInteger(h)&&h>=0&&h<=23))throw new Error('Hours must be in 0–23');
  const quietFrom=Number(env.QUIET_FROM_HOUR ?? 23);
  const quietUntil=Number(env.QUIET_UNTIL_HOUR ?? 8);
  if(![quietFrom,quietUntil].every(h=>Number.isInteger(h)&&h>=0&&h<=23))throw new Error('Quiet hours must be 0–23');
  const railwayUrl = env.RAILWAY_PUBLIC_DOMAIN?.trim() ? 'https://' + env.RAILWAY_PUBLIC_DOMAIN.trim() : '';
  const publicUrl = (env.PUBLIC_URL?.trim() || railwayUrl).replace(/\/$/, '');
  if (publicUrl && !/^https:\/\//.test(publicUrl)) throw new Error('PUBLIC_URL must be HTTPS');
  const guest = Number(env.CONTRIBUTOR_TELEGRAM_ID || 0);
  if (!Number.isSafeInteger(guest) || guest < 0) throw new Error('Invalid CONTRIBUTOR_TELEGRAM_ID');
  const createKey = env.CREATE_TASK_API_KEY?.trim();
  if (createKey && (createKey.length < 32 || createKey === env.INTEGRATION_API_KEY?.trim())) throw new Error('Use an independent CREATE_TASK_API_KEY of at least 32 characters');
  return {guest, createKey,
    botToken, owner, port, repeatMinutes, timeZone, publicUrl, morningHour, eveningHour, quietFrom, quietUntil,
    databasePath: env.DATABASE_PATH || './data/tasks.sqlite',
    integrationKey: (env.INTEGRATION_API_KEY || '').trim(),
    openaiApiKey: (env.OPENAI_API_KEY || '').trim(), openaiModel: env.OPENAI_MODEL || 'gpt-4.1-mini'
  };
}
