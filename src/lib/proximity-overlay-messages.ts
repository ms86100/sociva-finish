export type ProximityOverlayMessages = {
  at_doorstep_title?: string;
  arriving_title?: string;
  subtitle?: string;
};

/** Parse admin proximity_thresholds JSON for the arrival overlay. Never throws. */
export function parseProximityOverlayMessages(
  raw: string | null | undefined,
): ProximityOverlayMessages | undefined {
  if (!raw) return undefined;
  try {
    const cfg = JSON.parse(raw);
    if (!cfg || typeof cfg !== 'object') return undefined;
    return {
      at_doorstep_title: cfg.at_doorstep?.buyer_message,
      arriving_title: cfg.arriving?.buyer_message,
      subtitle: undefined,
    };
  } catch {
    return undefined;
  }
}
