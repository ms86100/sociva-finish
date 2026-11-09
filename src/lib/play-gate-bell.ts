/**
 * Play the Sociva order bell (public/sounds/gate_bell.mp3).
 * Works in the WebView on iOS and Android, and in the browser.
 * The same order does not start a second copy within 12 seconds.
 */
const recent = new Map<string, number>();
const DEDUPE_MS = 12_000;

export function playGateBell(orderId?: string): void {
  if (typeof window === 'undefined') return;
  const now = Date.now();
  if (now - (recent.get('bell') || 0) < DEDUPE_MS) return;
  if (orderId && now - (recent.get(orderId) || 0) < DEDUPE_MS) return;
  recent.set('bell', now);
  if (orderId) recent.set(orderId, now);

  let audio: HTMLAudioElement;
  try {
    audio = new Audio('/sounds/gate_bell.mp3');
    audio.preload = 'auto';
    audio.volume = 1;
  } catch {
    return;
  }

  const pending = audio.play();
  if (!pending || typeof pending.catch !== 'function') return;
  pending.catch(() => {
    const unlock = () => {
      window.removeEventListener('pointerdown', unlock);
      void audio.play().catch(() => {});
    };
    window.addEventListener('pointerdown', unlock, { once: true });
    window.setTimeout(() => window.removeEventListener('pointerdown', unlock), 20000);
  });
}
