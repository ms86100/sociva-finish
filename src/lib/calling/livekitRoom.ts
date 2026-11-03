import { Room, RoomEvent, Track } from 'livekit-client';

let activeRoom: Room | null = null;

export async function joinLiveKitCall(opts: {
  url: string;
  token: string;
}): Promise<Room> {
  await leaveLiveKitCall();
  const room = new Room({
    adaptiveStream: true,
    dynacast: true,
  });
  room.on(RoomEvent.Disconnected, () => {
    if (activeRoom === room) activeRoom = null;
  });
  await room.connect(opts.url, opts.token);
  await room.localParticipant.setMicrophoneEnabled(true);
  // Ensure remote audio plays
  room.remoteParticipants.forEach((p) => {
    p.audioTrackPublications.forEach((pub) => {
      if (pub.track && pub.track.kind === Track.Kind.Audio) {
        pub.track.attach();
      }
    });
  });
  room.on(RoomEvent.TrackSubscribed, (track) => {
    if (track.kind === Track.Kind.Audio) track.attach();
  });
  activeRoom = room;
  return room;
}

export async function leaveLiveKitCall() {
  if (!activeRoom) return;
  const room = activeRoom;
  activeRoom = null;
  try {
    await room.disconnect();
  } catch {
    // ignore
  }
}

export function getActiveLiveKitRoom() {
  return activeRoom;
}
