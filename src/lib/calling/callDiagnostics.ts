/**
 * Structured VoIP diagnostics. Never log tokens, audio content, or PII beyond callId.
 */

export type CallDiagEvent =
  | 'CALL_INITIATED'
  | 'CALL_INVITATION_SENT'
  | 'CALL_RINGING'
  | 'CALL_ACCEPTED'
  | 'MEDIA_SESSION_CREATED'
  | 'LOCAL_MIC_PERMISSION_GRANTED'
  | 'LOCAL_AUDIO_TRACK_CREATED'
  | 'LOCAL_AUDIO_TRACK_PUBLISHED'
  | 'REMOTE_PARTICIPANT_CONNECTED'
  | 'REMOTE_AUDIO_TRACK_RECEIVED'
  | 'REMOTE_AUDIO_TRACK_SUBSCRIBED'
  | 'REMOTE_AUDIO_PLAYBACK_STARTED'
  | 'REMOTE_AUDIO_PLAYBACK_FAILED'
  | 'CALL_MEDIA_READY'
  | 'CALL_MEDIA_TIMEOUT'
  | 'CALL_ENDED'
  | 'CALL_JOIN_IDEMPOTENT'
  | 'CALL_LEAVE';

export type CallDiagEntry = {
  at: string;
  callId: string;
  event: CallDiagEvent;
  platform?: string;
  detail?: Record<string, string | number | boolean | null>;
};

const MAX_ENTRIES = 80;
const STORAGE_KEY = 'sociva_voip_diag_v1';

const buffer: CallDiagEntry[] = [];

function persist() {
  try {
    if (typeof sessionStorage === 'undefined') return;
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(buffer.slice(-MAX_ENTRIES)));
  } catch {
    // ignore quota / private mode
  }
}

export function logCallDiag(
  callId: string,
  event: CallDiagEvent,
  detail?: Record<string, string | number | boolean | null>,
) {
  const entry: CallDiagEntry = {
    at: new Date().toISOString(),
    callId,
    event,
    platform: typeof navigator !== 'undefined' ? navigator.userAgent.slice(0, 80) : 'unknown',
    detail,
  };
  buffer.push(entry);
  if (buffer.length > MAX_ENTRIES) buffer.splice(0, buffer.length - MAX_ENTRIES);
  persist();
  try {
    // eslint-disable-next-line no-console
    console.info('[voip]', event, callId.slice(0, 8), detail || {});
  } catch {
    // ignore
  }
}

export function getCallDiagBuffer(): CallDiagEntry[] {
  return buffer.slice();
}

export function clearCallDiagBuffer() {
  buffer.length = 0;
  persist();
}

/** Pure helper for tests: map media flags to UI label. */
export function mediaPhaseToLabel(phase: {
  localPublished: boolean;
  remotePlaying: boolean;
  timedOut?: boolean;
  connecting?: boolean;
}): 'Connecting' | 'Connected' | 'Failed' {
  if (phase.timedOut) return 'Failed';
  if (phase.localPublished && phase.remotePlaying) return 'Connected';
  if (phase.connecting || phase.localPublished || !phase.remotePlaying) return 'Connecting';
  return 'Connecting';
}
