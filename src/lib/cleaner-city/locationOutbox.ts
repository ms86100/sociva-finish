const KEY = 'cleaner-city-location-outbox';

export type QueuedLocation = {
  ride_id: string;
  latitude: number;
  longitude: number;
  recorded_at: string;
};

function read(): QueuedLocation[] {
  try {
    const raw = localStorage.getItem(KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.slice(-30) : [];
  } catch {
    return [];
  }
}

function write(rows: QueuedLocation[]) {
  localStorage.setItem(KEY, JSON.stringify(rows.slice(-30)));
}

export function enqueueLocation(sample: QueuedLocation) {
  write([...read(), sample]);
}

export async function flushLocationOutbox(
  send: (sample: QueuedLocation) => Promise<void>,
) {
  const pending = read();
  if (!pending.length) return;
  const left: QueuedLocation[] = [];
  for (const sample of pending) {
    try {
      await send(sample);
    } catch {
      left.push(sample);
    }
  }
  write(left);
}
