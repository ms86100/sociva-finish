/**
 * Single owner for LiveKit join/leave + shared call UI state.
 * CallPage and ActiveCallOverlay must use this - never joinLiveKitCall directly.
 */
import { useEffect, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { heartbeatVoipCall, respondVoipCall } from '@/lib/calling/CallManager';
import { logCallDiag, mediaPhaseToLabel } from '@/lib/calling/callDiagnostics';
import {
  joinLiveKitCall,
  leaveLiveKitCall,
  prepareNativeCallAudio,
  retryRemoteAudioPlayback,
  setLiveKitMediaHooks,
  setLiveKitMuted,
} from '@/lib/calling/livekitRoom';
import { supabase } from '@/integrations/supabase/client';

export type CallMediaPhase =
  | 'idle'
  | 'ringing'
  | 'connecting'
  | 'media_local'
  | 'media_remote'
  | 'media_ready'
  | 'failed'
  | 'ended';

export type CallSessionState = {
  callId: string | null;
  role: 'caller' | 'callee' | null;
  /** Signalling-facing label (Calling / Incoming / Connecting / Connected / Failed). */
  statusLabel: string;
  mediaPhase: CallMediaPhase;
  muted: boolean;
  localPublished: boolean;
  remotePlaying: boolean;
  timedOut: boolean;
  /** True when CallPage is showing the same call - overlay should hide chrome. */
  callPageOpen: boolean;
  error: string | null;
};

const MEDIA_READY_TIMEOUT_MS = 20_000;

const initialState: CallSessionState = {
  callId: null,
  role: null,
  statusLabel: '',
  mediaPhase: 'idle',
  muted: false,
  localPublished: false,
  remotePlaying: false,
  timedOut: false,
  callPageOpen: false,
  error: null,
};

let state: CallSessionState = { ...initialState };
const listeners = new Set<(s: CallSessionState) => void>();
let joinPromise: Promise<void> | null = null;
let joinPromiseCallId: string | null = null;
let mediaTimeout: ReturnType<typeof setTimeout> | null = null;

function emit() {
  const snap = { ...state };
  listeners.forEach((fn) => {
    try {
      fn(snap);
    } catch {
      // ignore subscriber errors
    }
  });
}

function patch(partial: Partial<CallSessionState>) {
  state = { ...state, ...partial };
  emit();
}

function clearMediaTimeout() {
  if (mediaTimeout) {
    clearTimeout(mediaTimeout);
    mediaTimeout = null;
  }
}

function recomputeLabel() {
  if (!state.callId) {
    patch({ statusLabel: '', mediaPhase: 'idle' });
    return;
  }
  if (state.mediaPhase === 'ended') return;
  if (state.mediaPhase === 'ringing') return;

  const label = mediaPhaseToLabel({
    localPublished: state.localPublished,
    remotePlaying: state.remotePlaying,
    timedOut: state.timedOut,
    connecting: state.mediaPhase === 'connecting' || state.mediaPhase === 'media_local',
  });

  if (label === 'Connected') {
    const wasReady = state.mediaPhase === 'media_ready';
    patch({ statusLabel: 'Connected', mediaPhase: 'media_ready', error: null });
    if (!wasReady && state.callId) logCallDiag(state.callId, 'CALL_MEDIA_READY');
    clearMediaTimeout();
    return;
  }
  if (label === 'Failed') {
    patch({
      statusLabel: 'Could not establish audio',
      mediaPhase: 'failed',
      error: 'Media timed out - tap retry or end the call',
    });
    return;
  }
  patch({
    statusLabel: 'Connecting...',
    mediaPhase: state.localPublished ? 'media_local' : 'connecting',
  });
}

function onLocalPublished() {
  patch({ localPublished: true });
  if (state.callId) {
    void heartbeatVoipCall(state.callId, true).catch(() => {});
  }
  if (state.remotePlaying) {
    recomputeLabel();
  } else {
    patch({ mediaPhase: 'media_local', statusLabel: 'Connecting...' });
  }
}

function onRemotePlaying() {
  patch({ remotePlaying: true, mediaPhase: state.localPublished ? 'media_ready' : 'media_remote' });
  recomputeLabel();
}

function armMediaTimeout(callId: string) {
  clearMediaTimeout();
  mediaTimeout = setTimeout(() => {
    if (state.callId !== callId) return;
    if (state.localPublished && state.remotePlaying) return;
    logCallDiag(callId, 'CALL_MEDIA_TIMEOUT', {
      localPublished: state.localPublished,
      remotePlaying: state.remotePlaying,
    });
    patch({ timedOut: true, mediaPhase: 'failed' });
    recomputeLabel();
  }, MEDIA_READY_TIMEOUT_MS);
}

export function getCallSessionState(): CallSessionState {
  return { ...state };
}

export function subscribeCallSession(fn: (s: CallSessionState) => void): () => void {
  listeners.add(fn);
  fn({ ...state });
  return () => {
    listeners.delete(fn);
  };
}

export function useCallSession(): CallSessionState {
  const [s, setS] = useState(getCallSessionState);
  useEffect(() => subscribeCallSession(setS), []);
  return s;
}

export function setCallPageOpen(open: boolean, callId?: string | null) {
  if (open && callId && state.callId && state.callId !== callId) {
    // Different call on page - do not hide overlay for the other call.
    patch({ callPageOpen: false });
    return;
  }
  patch({ callPageOpen: open && (!callId || !state.callId || state.callId === callId) });
}

export function setRingingCall(callId: string, role: 'caller' | 'callee') {
  if (state.callId && state.callId !== callId && state.mediaPhase !== 'idle' && state.mediaPhase !== 'ended') {
    // Keep current live call unless idle.
    if (state.mediaPhase === 'media_ready' || state.mediaPhase === 'connecting' || state.mediaPhase === 'media_local') {
      return;
    }
  }
  clearMediaTimeout();
  joinPromise = null;
  joinPromiseCallId = null;
  patch({
    callId,
    role,
    statusLabel: role === 'caller' ? 'Calling...' : 'Incoming...',
    mediaPhase: 'ringing',
    muted: false,
    localPublished: false,
    remotePlaying: false,
    timedOut: false,
    error: null,
  });
  logCallDiag(callId, role === 'caller' ? 'CALL_INITIATED' : 'CALL_RINGING');
}

export function clearCallSession() {
  clearMediaTimeout();
  joinPromise = null;
  joinPromiseCallId = null;
  setLiveKitMediaHooks({});
  state = { ...initialState, callPageOpen: state.callPageOpen };
  emit();
}

/**
 * Idempotent join. Second caller for the same callId awaits the same promise.
 */
export async function ensureJoined(
  callId: string,
  opts: { asCalleeAccept?: boolean; role?: 'caller' | 'callee' } = {},
): Promise<void> {
  if (joinPromise && joinPromiseCallId === callId) {
    logCallDiag(callId, 'CALL_JOIN_IDEMPOTENT', { reason: 'controller_in_flight' });
    return joinPromise;
  }

  if (
    state.callId === callId &&
    state.localPublished &&
    state.remotePlaying &&
    state.mediaPhase === 'media_ready'
  ) {
    logCallDiag(callId, 'CALL_JOIN_IDEMPOTENT', { reason: 'already_media_ready' });
    return;
  }

  joinPromiseCallId = callId;
  joinPromise = (async () => {
    patch({
      callId,
      role: opts.role || state.role,
      statusLabel: 'Connecting...',
      mediaPhase: 'connecting',
      timedOut: false,
      error: null,
      localPublished: state.callId === callId ? state.localPublished : false,
      remotePlaying: state.callId === callId ? state.remotePlaying : false,
    });

    setLiveKitMediaHooks({
      callId,
      onLocalPublished,
      onRemotePlaying: onRemotePlaying,
      onRemotePlayFailed: (reason) => {
        logCallDiag(callId, 'REMOTE_AUDIO_PLAYBACK_FAILED', { reason });
      },
    });

    armMediaTimeout(callId);

    try {
      if (opts.asCalleeAccept) {
        logCallDiag(callId, 'CALL_ACCEPTED');
        await respondVoipCall(callId, true);
      }

      await prepareNativeCallAudio();

      const { data, error } = await supabase.functions.invoke('voip-call', {
        body: { action: 'join', call_id: callId },
      });
      if (error) throw error;
      if (!data?.livekit?.url || !data?.livekit?.token) {
        throw new Error(data?.error || 'No LiveKit token');
      }

      await joinLiveKitCall({
        url: data.livekit.url,
        token: data.livekit.token,
        callId,
        roomName: data?.call?.livekit_room || data?.livekit?.room || null,
      });

      // User-gesture friendly retry for WKWebView autoplay.
      await retryRemoteAudioPlayback().catch(() => false);

      if (Capacitor.isNativePlatform()) {
        await prepareNativeCallAudio();
      }

      recomputeLabel();
    } catch (e: any) {
      const msg = e?.message || 'Could not join audio';
      patch({
        statusLabel: msg,
        mediaPhase: 'failed',
        error: msg,
      });
      throw e;
    }
  })();

  try {
    await joinPromise;
  } finally {
    if (joinPromiseCallId === callId) {
      joinPromise = null;
      joinPromiseCallId = null;
    }
  }
}

export async function leaveCallSession(callId?: string | null, reason = 'ended') {
  const id = callId || state.callId;
  clearMediaTimeout();
  joinPromise = null;
  joinPromiseCallId = null;
  await leaveLiveKitCall();
  if (id) logCallDiag(id, 'CALL_ENDED', { reason });
  patch({
    ...initialState,
    callPageOpen: state.callPageOpen,
    mediaPhase: 'ended',
    statusLabel: reason === 'ended' ? '' : `Call ${reason}`,
  });
  // Fully clear after brief moment so UI can unmount.
  state = { ...initialState, callPageOpen: state.callPageOpen };
  emit();
}

export async function setCallMuted(muted: boolean) {
  patch({ muted });
  await setLiveKitMuted(muted);
}

export async function retryCallMedia() {
  const id = state.callId;
  if (!id) return;
  patch({
    timedOut: false,
    localPublished: false,
    remotePlaying: false,
    error: null,
    mediaPhase: 'connecting',
    statusLabel: 'Connecting...',
  });
  await leaveLiveKitCall();
  joinPromise = null;
  joinPromiseCallId = null;
  await ensureJoined(id, { role: state.role || undefined });
}

export async function unlockRemoteAudio() {
  const ok = await retryRemoteAudioPlayback();
  if (ok) onRemotePlaying();
  return ok;
}

/** Test helpers */
export function __resetCallSessionControllerForTests() {
  clearMediaTimeout();
  joinPromise = null;
  joinPromiseCallId = null;
  state = { ...initialState };
  setLiveKitMediaHooks({});
}

export function __setCallSessionStateForTests(partial: Partial<CallSessionState>) {
  patch(partial);
  recomputeLabel();
}

export { MEDIA_READY_TIMEOUT_MS };
