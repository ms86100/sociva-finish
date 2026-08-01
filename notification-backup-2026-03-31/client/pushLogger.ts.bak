import { supabase } from '@/integrations/supabase/client';

type LogLevel = 'info' | 'warn' | 'error';

const LOG_BUFFER: { level: LogLevel; message: string; metadata?: Record<string, unknown> }[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let currentUserId: string | null = null;

/** Set the user ID for remote logging. Call on login. */
export function setLogUser(userId: string | null) {
  currentUserId = userId;
}

/** Buffer a push log for remote storage. */
export function pushLog(level: LogLevel, message: string, metadata?: Record<string, unknown>) {
  console.log("PUSHLOG_WRITE", { level, message, metadata });
  // Also log to console
  const prefix = `[Push]`;
  if (level === 'error') console.error(prefix, message, metadata ?? '');
  else if (level === 'warn') console.warn(prefix, message, metadata ?? '');
  else console.log(prefix, message, metadata ?? '');

  LOG_BUFFER.push({ level, message, metadata });

  // Flush every 3 seconds (batch writes)
  if (!flushTimer) {
    flushTimer = setTimeout(flushLogs, 3000);
  }
}

async function flushLogs() {
  flushTimer = null;
  if (!currentUserId || LOG_BUFFER.length === 0) {
    console.log("PUSHLOG_FLUSH_SKIPPED", { hasUserId: !!currentUserId, bufferLen: LOG_BUFFER.length });
    return;
  }

  const batch = LOG_BUFFER.splice(0, LOG_BUFFER.length);
  const rows = batch.map((l) => ({
    user_id: currentUserId!,
    level: l.level,
    message: l.message,
    metadata: (l.metadata ?? null) as import('@/integrations/supabase/types').Json,
  }));

  try {
    const { error } = await supabase.from('push_logs').insert(rows);
    console.log("PUSHLOG_FLUSH_RESULT", { error: error?.message ?? null, rowCount: rows.length });
    if (error) console.error('[PushLogger] flush error:', error.message);
  } catch (e) {
    console.error('[PushLogger] flush exception:', e);
  }
}

/** Force-flush any buffered logs immediately. */
export async function flushPushLogs() {
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  await flushLogs();
}
