// @ts-nocheck
import { useEffect, useRef, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { endVoipCall, respondVoipCall } from '@/lib/calling/CallManager';
import {
  ensureJoined,
  leaveCallSession,
  setCallMuted,
  setRingingCall,
  unlockRemoteAudio,
  useCallSession,
  retryCallMedia,
} from '@/lib/calling/CallSessionController';
import { prepareNativeCallAudio } from '@/lib/calling/livekitRoom';
import { SocivaVoip } from '@/plugins/voip';
import { supabase } from '@/integrations/supabase/client';

const LIVE_STATUSES = new Set(['accepted', 'connecting', 'connected', 'active']);
const RINGING_STATUSES = new Set(['ringing', 'initiated']);
const ENDED_STATUSES = new Set(['ended', 'missed', 'declined', 'rejected', 'cancelled']);
const RING_POLL_MS = 1500;
const CALLKIT_AUDIO_WAIT_MS = 800;

/**
 * In-call chrome: CallKit accept on native + Realtime for caller and callee.
 * Media join is owned solely by CallSessionController (shared with CallPage).
 * Hidden while CallPage is open for the same call to avoid Connected/Connecting split.
 */
export function ActiveCallOverlay({ userId }: { userId?: string | null }) {
  const navigate = useNavigate();
  const session = useCallSession();
  const [busy, setBusy] = useState(false);
  const pendingCallKitJoinRef = useRef<{ callId: string } | null>(null);
  const callKitAudioReadyRef = useRef(false);
  const callId = session.callId;
  const status = session.statusLabel;
  const role = session.role;

  const tryJoinLive = async (id: string, asCalleeAccept = false) => {
    await ensureJoined(id, {
      asCalleeAccept,
      role: asCalleeAccept ? 'callee' : role || undefined,
    });
    pendingCallKitJoinRef.current = null;
    await unlockRemoteAudio();
    await prepareNativeCallAudio();
  };

  useEffect(() => {
    if (!userId || !Capacitor.isNativePlatform()) return;
    const removes: Array<() => void> = [];

    (async () => {
      const inc = await SocivaVoip.addListener('incoming', (data) => {
        const id = String(data?.callId || '');
        if (id) setRingingCall(id, 'callee');
      });
      removes.push(() => void inc.remove());

      const acc = await SocivaVoip.addListener('accepted', async (data) => {
        const id = String(data?.callId || '');
        if (!id) return;
        setRingingCall(id, 'callee');
        pendingCallKitJoinRef.current = { callId: id };
        if (callKitAudioReadyRef.current) {
          await tryJoinLive(id, true);
          return;
        }
        window.setTimeout(() => {
          if (pendingCallKitJoinRef.current?.callId === id) {
            void tryJoinLive(id, true);
          }
        }, CALLKIT_AUDIO_WAIT_MS);
      });
      removes.push(() => void acc.remove());

      const route = await SocivaVoip.addListener('audioRoute', async (data) => {
        callKitAudioReadyRef.current = !!data?.active;
        if (!data?.active) return;
        await prepareNativeCallAudio();
        const pending = pendingCallKitJoinRef.current;
        if (pending?.callId) {
          await tryJoinLive(pending.callId, true);
        }
      });
      removes.push(() => void route.remove());

      const end = await SocivaVoip.addListener('ended', async (data) => {
        const id = String(data?.callId || '');
        if (id) {
          await leaveCallSession(id, 'ended');
          void endVoipCall(id, 'ended').catch(() => {});
        } else {
          await leaveCallSession(null, 'ended');
        }
      });
      removes.push(() => void end.remove());
    })();

    return () => removes.forEach((fn) => fn());
  }, [userId]);

  useEffect(() => {
    if (!userId) return;

    const handleRow = async (row: any, asRole: 'caller' | 'callee') => {
      if (!row?.id) return;
      if (ENDED_STATUSES.has(row.status)) {
        await leaveCallSession(row.id, row.status);
        return;
      }
      if (RINGING_STATUSES.has(row.status)) {
        setRingingCall(row.id, asRole);
        return;
      }
      if (LIVE_STATUSES.has(row.status)) {
        await ensureJoined(row.id, { role: asRole });
        await unlockRemoteAudio();
      }
    };

    const callerChannel = supabase
      .channel(`voip-calls-caller-${userId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'call_sessions',
          filter: `caller_id=eq.${userId}`,
        },
        (payload) => {
          void handleRow(payload.new, 'caller');
        },
      )
      .subscribe();

    const calleeChannel = supabase
      .channel(`voip-calls-callee-${userId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'call_sessions',
          filter: `callee_id=eq.${userId}`,
        },
        (payload) => {
          void handleRow(payload.new, 'callee');
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(callerChannel);
      void supabase.removeChannel(calleeChannel);
    };
  }, [userId]);

  // While ringing, poll so accept is not lost if Realtime misses an update.
  useEffect(() => {
    if (!userId || !callId) return;
    if (!(status === 'Calling...' || status === 'Incoming...' || status.startsWith('Incoming'))) {
      return;
    }

    let cancelled = false;
    const tick = async () => {
      const { data, error } = await supabase
        .from('call_sessions')
        .select('id, caller_id, callee_id, status')
        .eq('id', callId)
        .maybeSingle();
      if (cancelled || error || !data) return;
      const asRole =
        data.caller_id === userId ? 'caller' : data.callee_id === userId ? 'callee' : null;
      if (!asRole) return;
      if (ENDED_STATUSES.has(data.status)) {
        await leaveCallSession(data.id, data.status);
        return;
      }
      if (LIVE_STATUSES.has(data.status)) {
        await ensureJoined(data.id, { role: asRole });
        await unlockRemoteAudio();
      }
    };

    void tick();
    const timer = window.setInterval(() => {
      void tick();
    }, RING_POLL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [userId, callId, status]);

  // Hide when CallPage is showing the same call - one Connected label only.
  if (!callId) return null;
  if (session.callPageOpen && session.callId === callId) return null;

  const showAccept =
    role === 'callee' && (status === 'Incoming...' || status.startsWith('Incoming'));
  const showRetry = session.mediaPhase === 'failed';

  return (
    <div
      className="fixed inset-x-0 bottom-20 z-[80] mx-auto max-w-md px-4"
      data-testid="sociva-active-call"
      onClick={() => {
        void unlockRemoteAudio();
      }}
    >
      <div className="rounded-2xl bg-zinc-900 text-white shadow-lg px-4 py-3 flex items-center gap-3">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold truncate">Sociva call</p>
          <p className="text-xs text-zinc-300 truncate" data-testid="sociva-overlay-status">
            {status || 'In progress'}
          </p>
        </div>
        {showAccept ? (
          <>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              disabled={busy}
              onClick={() => navigate(`/call/${callId}`)}
              data-testid="sociva-overlay-open-call"
            >
              Open
            </Button>
            <Button
              type="button"
              size="sm"
              className="bg-emerald-600 hover:bg-emerald-500"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await tryJoinLive(callId, true);
                } finally {
                  setBusy(false);
                }
              }}
              data-testid="sociva-overlay-accept"
            >
              Accept
            </Button>
            <Button
              type="button"
              size="sm"
              variant="destructive"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await respondVoipCall(callId, false);
                  await leaveCallSession(callId, 'rejected');
                } catch (e: any) {
                  // status comes from controller
                } finally {
                  setBusy(false);
                }
              }}
              data-testid="sociva-overlay-decline"
            >
              Decline
            </Button>
          </>
        ) : (
          <>
            {showRetry ? (
              <Button
                type="button"
                size="sm"
                variant="secondary"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    await retryCallMedia();
                    await unlockRemoteAudio();
                  } finally {
                    setBusy(false);
                  }
                }}
                data-testid="sociva-overlay-retry"
              >
                Retry
              </Button>
            ) : null}
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={async () => {
                const next = !session.muted;
                await setCallMuted(next);
                await SocivaVoip.setMuted({ muted: next }).catch(() => {});
              }}
            >
              {session.muted ? 'Unmute' : 'Mute'}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="destructive"
              onClick={async () => {
                await SocivaVoip.endNativeCall({ callId }).catch(() => {});
                await leaveCallSession(callId, 'ended');
                await endVoipCall(callId, 'ended');
              }}
            >
              End
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
