import { Capacitor } from '@capacitor/core';
import { Room, RoomEvent, Track, type RemoteTrack } from 'livekit-client';
import { SocivaVoip } from '@/plugins/voip';

let activeRoom: Room | null = null;
const attachedAudioEls = new Set<HTMLMediaElement>();

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
  void el.play().catch(() => {
    // Autoplay can fail until a gesture; Accept / Call tap usually unlocks it.
  });
  return el;
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

export async function joinLiveKitCall(opts: {
  url: string;
  token: string;
}): Promise<Room> {
  await leaveLiveKitCall();
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
    if (activeRoom === room) activeRoom = null;
  });

  room.on(RoomEvent.TrackSubscribed, (track) => {
    if (track.kind === Track.Kind.Audio) {
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

  await room.connect(opts.url, opts.token);
  await room.localParticipant.setMicrophoneEnabled(true);

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
  return room;
}

export async function leaveLiveKitCall() {
  detachAllRemoteAudio();
  if (!activeRoom) return;
  const room = activeRoom;
  activeRoom = null;
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

export function getActiveLiveKitRoom() {
  return activeRoom;
}

export async function setLiveKitMuted(muted: boolean) {
  if (!activeRoom) return;
  await activeRoom.localParticipant.setMicrophoneEnabled(!muted);
}
