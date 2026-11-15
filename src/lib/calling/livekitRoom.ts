import { Capacitor } from '@capacitor/core';
import { Room, RoomEvent, Track, type RemoteTrack } from 'livekit-client';
import { SocivaVoip } from '@/plugins/voip';
import { logCallDiag } from '@/lib/calling/callDiagnostics';

let activeRoom: Room | null = null;
let activeCallId: string | null = null;
let activeRoomName: string | null = null;
let joinMutex: Promise<Room> | null = null;
let joinMutexCallId: string | null = null;
const attachedAudioEls = new Set<HTMLMediaElement>();

export type LiveKitMediaHooks = {
  callId?: string;
  onLocalPublished?: () => void;
  onRemotePlaying?: () => void;
  onRemotePlayFailed?: (reason: string) => void;
};

let mediaHooks: LiveKitMediaHooks = {};

export function setLiveKitMediaHooks(hooks: LiveKitMediaHooks) {
  mediaHooks = hooks || {};
}

function attachRemoteAudio(track: RemoteTrack): HTMLMediaElement {
  const el = track.attach() as HTMLMediaElement;
  el.autoplay = true;
  el.muted = false;
  el.volume = 1;
  el.setAttribute('playsinline', 'true');
  el.setAttribute('webkit-playsinline', 'true');
  // Keep element in the DOM so iOS WKWebView actually plays remote audio.
  el.style.position = 'fixed';
  el.style.width = '1px';
  el.style.height = '1px';
  el.style.opacity = '0';
  el.style.pointerEvents = 'none';
  el.style.zIndex = '-1';
  if (!el.isConnected) {
    document.body.appendChild(el);
  }
  attachedAudioEls.add(el);

  const callId = mediaHooks.callId || activeCallId || '';
  if (callId) {
    logCallDiag(callId, 'REMOTE_AUDIO_TRACK_SUBSCRIBED');
  }

  void el
    .play()
    .then(() => {
      if (callId) logCallDiag(callId, 'REMOTE_AUDIO_PLAYBACK_STARTED');
      mediaHooks.onRemotePlaying?.();
    })
    .catch((err) => {
      const reason = String((err as Error)?.message || 'play_rejected');
      if (callId) logCallDiag(callId, 'REMOTE_AUDIO_PLAYBACK_FAILED', { reason });
      mediaHooks.onRemotePlayFailed?.(reason);
    });

  return el;
}

/** Retry remote audio play after a user gesture (Accept / Call / overlay tap). */
export async function retryRemoteAudioPlayback(): Promise<boolean> {
  let anyOk = false;
  for (const el of attachedAudioEls) {
    try {
      el.muted = false;
      el.volume = 1;
      await el.play();
      anyOk = true;
    } catch {
      // keep trying others
    }
  }
  if (anyOk) {
    const callId = mediaHooks.callId || activeCallId || '';
    if (callId) logCallDiag(callId, 'REMOTE_AUDIO_PLAYBACK_STARTED', { retry: true });
    mediaHooks.onRemotePlaying?.();
  }
  return anyOk;
}

function detachAllRemoteAudio() {
  for (const el of attachedAudioEls) {
    try {
      el.pause();
      el.removeAttribute('src');
      el.load();
      el.remove();
    } catch {
      // ignore
    }
  }
  attachedAudioEls.clear();
}

/** Mic permission + speaker route before WebRTC in the Cap WebView. */
export async function prepareNativeCallAudio(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  try {
    await SocivaVoip.requestCallPermissions();
  } catch {
    // continue; getUserMedia may still prompt
  }
  try {
    await SocivaVoip.setSpeaker({ speaker: true });
  } catch {
    // ignore
  }
}

export function getActiveLiveKitCallId() {
  return activeCallId;
}

export function getActiveLiveKitRoom() {
  return activeRoom;
}

/**
 * Join LiveKit. Idempotent for the same callId+room: a second caller awaits the
 * in-flight join and does not tear down a healthy room.
 */
export async function joinLiveKitCall(opts: {
  url: string;
  token: string;
  callId: string;
  roomName?: string | null;
}): Promise<Room> {
  const roomName = opts.roomName || null;

  if (
    activeRoom &&
    activeCallId === opts.callId &&
    activeRoom.state === 'connected' &&
    (!roomName || !activeRoomName || activeRoomName === roomName)
  ) {
    logCallDiag(opts.callId, 'CALL_JOIN_IDEMPOTENT', { reason: 'already_connected' });
    return activeRoom;
  }

  if (joinMutex && joinMutexCallId === opts.callId) {
    logCallDiag(opts.callId, 'CALL_JOIN_IDEMPOTENT', { reason: 'await_in_flight' });
    return joinMutex;
  }
  if (joinMutex && joinMutexCallId !== opts.callId) {
    // Wait for the other join to finish, then proceed for this call.
    try {
      await joinMutex;
    } catch {
      // ignore prior failure
    }
  }

  joinMutexCallId = opts.callId;
  joinMutex = (async () => {
    // Only tear down if switching calls or reconnecting a different room.
    if (activeRoom && activeCallId !== opts.callId) {
      await leaveLiveKitCall();
    } else if (activeRoom && activeCallId === opts.callId && activeRoom.state !== 'connected') {
      await leaveLiveKitCall();
    } else if (
      activeRoom &&
      activeCallId === opts.callId &&
      roomName &&
      activeRoomName &&
      activeRoomName !== roomName
    ) {
      await leaveLiveKitCall();
    } else if (activeRoom && activeCallId === opts.callId && activeRoom.state === 'connected') {
      return activeRoom;
    }

    mediaHooks = { ...mediaHooks, callId: opts.callId };
    await prepareNativeCallAudio();

    const room = new Room({
      adaptiveStream: true,
      dynacast: true,
      audioCaptureDefaults: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });

    room.on(RoomEvent.Disconnected, () => {
      if (activeRoom === room) {
        activeRoom = null;
        activeCallId = null;
        activeRoomName = null;
      }
    });

    room.on(RoomEvent.TrackSubscribed, (track) => {
      if (track.kind === Track.Kind.Audio) {
        logCallDiag(opts.callId, 'REMOTE_AUDIO_TRACK_RECEIVED');
        attachRemoteAudio(track as RemoteTrack);
      }
    });

    room.on(RoomEvent.TrackUnsubscribed, (track) => {
      if (track.kind === Track.Kind.Audio) {
        track.detach().forEach((el) => {
          try {
            el.remove();
          } catch {
            // ignore
          }
          attachedAudioEls.delete(el as HTMLMediaElement);
        });
      }
    });

    room.on(RoomEvent.ParticipantConnected, () => {
      logCallDiag(opts.callId, 'REMOTE_PARTICIPANT_CONNECTED', {
        remotes: room.remoteParticipants.size,
      });
    });

    logCallDiag(opts.callId, 'MEDIA_SESSION_CREATED');
    await room.connect(opts.url, opts.token);

    logCallDiag(opts.callId, 'LOCAL_AUDIO_TRACK_CREATED');
    await room.localParticipant.setMicrophoneEnabled(true);
    logCallDiag(opts.callId, 'LOCAL_AUDIO_TRACK_PUBLISHED');
    mediaHooks.onLocalPublished?.();

    // Already-present remotes (other party joined first).
    room.remoteParticipants.forEach((p) => {
      p.audioTrackPublications.forEach((pub) => {
        if (pub.track && pub.track.kind === Track.Kind.Audio) {
          attachRemoteAudio(pub.track as RemoteTrack);
        }
      });
    });

    // Re-assert speaker after WebRTC may have flipped the session (iOS CallKit).
    await prepareNativeCallAudio();

    activeRoom = room;
    activeCallId = opts.callId;
    activeRoomName = roomName || room.name || null;
    return room;
  })();

  try {
    return await joinMutex;
  } finally {
    if (joinMutexCallId === opts.callId) {
      joinMutex = null;
      joinMutexCallId = null;
    }
  }
}

export async function leaveLiveKitCall() {
  const callId = activeCallId;
  detachAllRemoteAudio();
  if (!activeRoom) {
    activeCallId = null;
    activeRoomName = null;
    return;
  }
  const room = activeRoom;
  activeRoom = null;
  activeCallId = null;
  activeRoomName = null;
  if (callId) logCallDiag(callId, 'CALL_LEAVE');
  try {
    await room.localParticipant.setMicrophoneEnabled(false);
  } catch {
    // ignore
  }
  try {
    await room.disconnect();
  } catch {
    // ignore
  }
}

export async function setLiveKitMuted(muted: boolean) {
  if (!activeRoom) return;
  await activeRoom.localParticipant.setMicrophoneEnabled(!muted);
}
