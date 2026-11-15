import { describe, expect, it, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { mediaPhaseToLabel } from '@/lib/calling/callDiagnostics';
import {
  __resetCallSessionControllerForTests,
  __setCallSessionStateForTests,
  getCallSessionState,
  setCallPageOpen,
  setRingingCall,
} from '@/lib/calling/CallSessionController';

const read = (rel: string) => readFileSync(resolve(process.cwd(), rel), 'utf8');

describe('CallSessionController media readiness', () => {
  beforeEach(() => {
    __resetCallSessionControllerForTests();
  });

  it('maps Connected only when local published and remote playing', () => {
    expect(
      mediaPhaseToLabel({ localPublished: false, remotePlaying: false, connecting: true }),
    ).toBe('Connecting');
    expect(
      mediaPhaseToLabel({ localPublished: true, remotePlaying: false, connecting: true }),
    ).toBe('Connecting');
    expect(
      mediaPhaseToLabel({ localPublished: true, remotePlaying: true }),
    ).toBe('Connected');
    expect(
      mediaPhaseToLabel({ localPublished: true, remotePlaying: false, timedOut: true }),
    ).toBe('Failed');
  });

  it('setRingingCall seeds shared state for caller and callee', () => {
    setRingingCall('call-a', 'caller');
    expect(getCallSessionState().callId).toBe('call-a');
    expect(getCallSessionState().statusLabel).toBe('Calling...');
    expect(getCallSessionState().mediaPhase).toBe('ringing');

    setRingingCall('call-b', 'callee');
    expect(getCallSessionState().callId).toBe('call-b');
    expect(getCallSessionState().statusLabel).toBe('Incoming...');
  });

  it('hides overlay when CallPage is open for the same call', () => {
    setRingingCall('call-x', 'caller');
    setCallPageOpen(true, 'call-x');
    expect(getCallSessionState().callPageOpen).toBe(true);
    setCallPageOpen(false);
    expect(getCallSessionState().callPageOpen).toBe(false);
  });

  it('recomputes Connected label from media flags via test setter', () => {
    setRingingCall('call-m', 'caller');
    __setCallSessionStateForTests({
      callId: 'call-m',
      localPublished: true,
      remotePlaying: true,
      timedOut: false,
      mediaPhase: 'media_local',
    });
    expect(getCallSessionState().statusLabel).toBe('Connected');
    expect(getCallSessionState().mediaPhase).toBe('media_ready');
  });
});

describe('Single join owner wiring', () => {
  it('CallPage and ActiveCallOverlay use CallSessionController, not joinLiveKitCall', () => {
    const callPage = read('src/pages/CallPage.tsx');
    const overlay = read('src/components/calling/ActiveCallOverlay.tsx');
    const controller = read('src/lib/calling/CallSessionController.ts');
    const livekit = read('src/lib/calling/livekitRoom.ts');

    expect(controller).toContain('ensureJoined');
    expect(controller).toContain('joinLiveKitCall');
    expect(livekit).toContain('CALL_JOIN_IDEMPOTENT');
    expect(livekit).toContain('retryRemoteAudioPlayback');

    expect(callPage).toContain('ensureJoined');
    expect(callPage).toContain('useCallSession');
    expect(callPage).not.toContain('joinLiveKitCall');
    expect(callPage).toContain('setCallPageOpen');
    expect(callPage).toContain('RING_POLL_MS');

    expect(overlay).toContain('ensureJoined');
    expect(overlay).toContain('useCallSession');
    expect(overlay).not.toContain('joinLiveKitCall');
    expect(overlay).toContain('callPageOpen');
    expect(overlay).toContain('RING_POLL_MS');
    expect(overlay).toContain('audioRoute');
    expect(overlay).not.toMatch(/status === 'active'/);

    for (const src of [callPage, overlay, controller]) {
      expect(src).not.toMatch(/[\u2013\u2014]/);
    }
  });
});
