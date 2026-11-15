// @ts-nocheck
import { useEffect, useRef, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import {
  endVoipCall,
  heartbeatVoipCall,
  respondVoipCall,
} from '@/lib/calling/CallManager';
import {
  joinLiveKitCall,
  leaveLiveKitCall,
  prepareNativeCallAudio,
  setLiveKitMuted,
} from '@/lib/calling/livekitRoom';
import { SocivaVoip } from '@/plugins/voip';
import { supabase } from '@/integrations/supabase/client';

const LIVE_STATUSES = new Set(['accepted', 'connecting', 'connected', 'active']);
const RINGING_STATUSES = new Set(['ringing', 'initiated']);
const ENDED_STATUSES = new Set(['ended', 'missed', 'declined', 'rejected', 'cancelled']);
const RING_POLL_MS = 1500;
const CALLKIT_AUDIO_WAIT_MS = 800;

async function joinCallMedia(callId: string, asCalleeAccept = false) {
  if (asCalleeAccept) {
    await respondVoipCall(callId, true);
  }
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
  });
  void heartbeatVoipCall(callId, true);
}

/**
 * In-call chrome: CallKit accept on native + Realtime for caller and callee.
 * Joins LiveKit when status becomes accepted/connecting/connected (not a phantom "active").
 * Polls while ringing so a missed Realtime event cannot leave the caller on "Calling...".
 */
export function ActiveCallOverlay({ userId }: { userId?: string | null }) {
  const navigate = useNavigate();
  const [callId, setCallId] = useState<string | null>(null);
  const [status, setStatus] = useState<string>('');
  const [role, setRole] = useState<'caller' | 'callee' | null>(null);
  const [muted, setMuted] = useState(false);
  const [busy, setBusy] = useState(false);
  const joinedRef = useRef(false);
  const joiningRef = useRef(false);
  const callIdRef = useRef<string | null>(null);
  const pendingCallKitJoinRef = useRef<{ callId: string } | null>(null);
  const callKitAudioReadyRef = useRef(false);

  const resetUi = () => {
    joinedRef.current = false;
    joiningRef.current = false;
    callIdRef.current = null;
    pendingCallKitJoinRef.current = null;
    callKitAudioReadyRef.current = false;
    setCallId(null);
    setRole(null);
    setStatus('');
  };

  const setActiveCall = (id: string, asRole: 'caller' | 'callee', nextStatus: string) => {
    if (callIdRef.current !== id) joinedRef.current = false;
    callIdRef.current = id;
    setCallId(id);
    setRole(asRole);
    setStatus(nextStatus);
  };

  const tryJoinLive = async (id: string, asCalleeAccept = false) => {
    if (joinedRef.current || joiningRef.current) return;
    joiningRef.current = true;
    setStatus('Connecting…');
    try {
      await prepareNativeCallAudio();
      await joinCallMedia(id, asCalleeAccept);
      joinedRef.current = true;
      pendingCallKitJoinRef.current = null;
      setStatus('Connected');
      await prepareNativeCallAudio();
    } catch (e: any) {
      setStatus(e?.message || 'Could not join');
    } finally {
      joiningRef.current = false;
    }
  };

  useEffect(() => {
    if (!userId || !Capacitor.isNativePlatform()) return;
    const removes: Array<() => void> = [];

    (async () => {
      const inc = await SocivaVoip.addListener('incoming', (data) => {
        const id = String(data?.callId || '');
        if (id) setActiveCall(id, 'callee', 'Incoming…');
      });
      removes.push(() => void inc.remove());

      const acc = await SocivaVoip.addListener('accepted', async (data) => {
        const id = String(data?.callId || '');
        if (!id) return;
        setActiveCall(id, 'callee', 'Connecting…');
        // Wait briefly for CallKit didActivate so WebRTC can use the live audio session.
        pendingCallKitJoinRef.current = { callId: id };
        if (callKitAudioReadyRef.current) {
          await tryJoinLive(id, true);
          return;
        }
        window.setTimeout(() => {
          if (pendingCallKitJoinRef.current?.callId === id && !joinedRef.current) {
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
        if (pending?.callId && !joinedRef.current) {
          await tryJoinLive(pending.callId, true);
        }
      });
      removes.push(() => void route.remove());

      const end = await SocivaVoip.addListener('ended', async (data) => {
        const id = String(data?.callId || '');
        await leaveLiveKitCall();
        if (id) void endVoipCall(id, 'ended').catch(() => {});
        resetUi();
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
        await leaveLiveKitCall();
        resetUi();
        return;
      }
      if (RINGING_STATUSES.has(row.status)) {
        setActiveCall(row.id, asRole, asRole === 'caller' ? 'Calling…' : 'Incoming…');
        return;
      }
      if (LIVE_STATUSES.has(row.status)) {
        setActiveCall(row.id, asRole, 'Connecting…');
        await tryJoinLive(row.id, false);
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
    if (!(status === 'Calling…' || status === 'Incoming…' || status.startsWith('Incoming'))) {
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
        await leaveLiveKitCall();
        resetUi();
        return;
      }
      if (LIVE_STATUSES.has(data.status)) {
        setRole(asRole);
        await tryJoinLive(data.id, false);
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

  if (!callId) return null;

  const showAccept = role === 'callee' && (status === 'Incoming…' || status.startsWith('Incoming'));

  return (
    <div
      className="fixed inset-x-0 bottom-20 z-[80] mx-auto max-w-md px-4"
      data-testid="sociva-active-call"
    >
      <div className="rounded-2xl bg-zinc-900 text-white shadow-lg px-4 py-3 flex items-center gap-3">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold truncate">Sociva call</p>
          <p className="text-xs text-zinc-300 truncate">{status || 'In progress'}</p>
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
                  await leaveLiveKitCall();
                  resetUi();
                } catch (e: any) {
                  setStatus(e?.message || 'Could not decline');
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
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={async () => {
                const next = !muted;
                setMuted(next);
                await setLiveKitMuted(next).catch(() => {});
                await SocivaVoip.setMuted({ muted: next }).catch(() => {});
              }}
            >
              {muted ? 'Unmute' : 'Mute'}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="destructive"
              onClick={async () => {
                await SocivaVoip.endNativeCall({ callId }).catch(() => {});
                await leaveLiveKitCall();
                await endVoipCall(callId, 'ended');
                resetUi();
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
