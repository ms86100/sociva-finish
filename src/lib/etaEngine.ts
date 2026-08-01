// @ts-nocheck
/**
 * ETA Engine — Single Source of Truth
 *
 * Every component that displays delivery ETA must use `computeETA()`.
 * The DB column `orders.estimated_delivery_at` is the authoritative source.
 *
 * Rule: No component should compute `Math.ceil((eta - now) / 60000)` inline.
 */

export type ETAMood = 'calm' | 'eager' | 'imminent' | 'late';

export interface ETAResult {
  /** Raw minutes remaining (null if no ETA) */
  minutes: number | null;
  /** ETA has passed */
  isLate: boolean;
  /** ≤ 1 minute remaining */
  isArriving: boolean;
  /** Human-readable text for primary display */
  displayText: string;
  /** Formatted target time, e.g. "2:30 PM" */
  displayTime: string | null;
  /** Subtitle / secondary text */
  subtitle: string;
  /** Emotional mood tier */
  mood: ETAMood;
  /** Emoji representing mood */
  emoji: string;
}

export function computeETA(
  estimatedDeliveryAt: string | null,
  now: number = Date.now(),
): ETAResult {
  if (!estimatedDeliveryAt) {
    return {
      minutes: null,
      isLate: false,
      isArriving: false,
      displayText: 'Processing',
      displayTime: null,
      subtitle: '',
      mood: 'calm',
      emoji: '📦',
    };
  }

  const targetTime = new Date(estimatedDeliveryAt).getTime();
  const diffMs = targetTime - now;
  const isLate = diffMs < 0;
  const rawMinutes = isLate ? 0 : Math.ceil(diffMs / 60000);
  const isArriving = !isLate && rawMinutes <= 1;

  // Mood tiers
  let mood: ETAMood;
  let emoji: string;
  if (isLate) {
    mood = 'late';
    emoji = '🕐';
  } else if (rawMinutes <= 10) {
    mood = 'imminent';
    emoji = '⚡';
  } else if (rawMinutes <= 30) {
    mood = 'eager';
    emoji = '🚀';
  } else {
    mood = 'calm';
    emoji = '😊';
  }

  let displayText: string;
  if (isLate) {
    displayText = 'Running a bit late — arriving soon';
  } else if (isArriving) {
    displayText = 'Arriving any moment';
  } else if (rawMinutes <= 60) {
    displayText = `Estimated arrival in ${rawMinutes} min`;
  } else {
    const hours = Math.floor(rawMinutes / 60);
    const mins = rawMinutes % 60;
    displayText = `Estimated arrival in ${hours}h ${mins}m`;
  }

  const displayTime = new Date(estimatedDeliveryAt).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });

  const subtitle = isLate
    ? 'Taking longer than expected'
    : `By ${displayTime}`;

  return {
    minutes: rawMinutes,
    isLate,
    isArriving,
    displayText,
    displayTime,
    subtitle,
    mood,
    emoji,
  };
}

/**
 * Compact ETA text for inline usage (strips, headers).
 * Returns null if no ETA.
 */
export function compactETA(
  estimatedDeliveryAt: string | null,
  now: number = Date.now(),
): string | null {
  const eta = computeETA(estimatedDeliveryAt, now);
  if (eta.minutes === null) return null;
  if (eta.isLate) return 'Arriving soon';
  if (eta.isArriving) return 'Arriving now';
  if (eta.minutes <= 60) return `${eta.minutes} min`;
  return null;
}
