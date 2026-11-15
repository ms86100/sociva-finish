// @ts-nocheck
import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Phone, PhoneOff, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/contexts/AuthContext';
import { endVoipCall, respondVoipCall } from '@/lib/calling/CallManager';
import {
  ensureJoined,
  leaveCallSession,
  setCallPageOpen,
  setRingingCall,
  unlockRemoteAudio,
  useCallSession,
  retryCallMedia,
} from '@/lib/calling/CallSessionController';
import { supabase } from '@/integrations/supabase/client';

type CallRow = {
  id: string;
  caller_id: string;
  callee_id: string;
  context_type: string;
  context_id: string;
  status: string;
  livekit_room?: string | null;
};

const LIVE_STATUSES = new Set(['accepted', 'connecting', 'connected', 'active']);
const RINGING_STATUSES = new Set(['ringing', 'initiated']);
const ENDED_STATUSES = new Set(['ended', 'missed', 'declined', 'rejected', 'cancelled']);
const RING_POLL_MS = 1500;

function backPathForCall(call: CallRow | null): string {
  if (!call?.context_id) return '/orders';
  if (call.context_type === 'cleaner_city_ride') {
    return `/cleaner-city/ride/${call.context_id}`;
  }
  if (call.context_type === 'seller_order') {
    return `/seller/orders/${call.context_id}`;
  }
  return `/orders/${call.context_id}`;
}

/**
 * Deep-link landing for voip_incoming pushes (`/call/:callId`).
 * Media join is owned solely by CallSessionController (shared with ActiveCallOverlay).
 */
export default function CallPage() {
  const { callId } = useParams<{ callId: string }>();
  const { user } = useAuth();
  const navigate = useNavigate();
  const session = useCallSession();
  const [call, setCall] = useState<CallRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const isCallee = !!user?.id && call?.callee_id === user.id;
  const isCaller = !!user?.id && call?.caller_id === user.id;
  const isParticipant = isCallee || isCaller;

  const refresh = useCallback(async () => {
    if (!callId) return;
    const { data, error } = await supabase
      .from('call_sessions')
      .select('id, caller_id, callee_id, context_type, context_id, status, livekit_room')
      .eq('id', callId)
      .maybeSingle();
    if (error) throw error;
    setCall((data as CallRow) || null);
    return data as CallRow | null;
  }, [callId]);

  const tryJoinFromStatus = useCallback(
    async (row: CallRow) => {
      if (!row?.id || !LIVE_STATUSES.has(row.status)) return;
      const role =
        row.caller_id === user?.id ? 'caller' : row.callee_id === user?.id ? 'callee' : undefined;
      await ensureJoined(row.id, { role });
      await unlockRemoteAudio();
    },
    [user?.id],
  );

  useEffect(() => {
    setCallPageOpen(true, callId || null);
    return () => setCallPageOpen(false);
  }, [callId]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!callId) {
        setLoading(false);
        return;
      }
      try {
        const row = await refresh();
        if (cancelled) return;
        if (!row) return;
        if (ENDED_STATUSES.has(row.status)) return;
        if (RINGING_STATUSES.has(row.status)) {
          setRingingCall(
            row.id,
            row.callee_id === user?.id ? 'callee' : 'caller',
          );
          return;
        }
        if (LIVE_STATUSES.has(row.status)) {
          await tryJoinFromStatus(row);
        }
      } catch (e: any) {
        if (!cancelled) toast.error(e?.message || 'Could not load call');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [callId, refresh, user?.id, tryJoinFromStatus]);

  useEffect(() => {
    if (!callId || !user?.id) return;
    const channel = supabase
      .channel(`call-page-${callId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'call_sessions',
          filter: `id=eq.${callId}`,
        },
        async (payload) => {
          const row = payload.new as CallRow;
          if (!row?.id) return;
          setCall(row);
          if (ENDED_STATUSES.has(row.status)) {
            await leaveCallSession(row.id, row.status);
            return;
          }
          if (RINGING_STATUSES.has(row.status)) {
            setRingingCall(
              row.id,
              row.callee_id === user.id ? 'callee' : 'caller',
            );
            return;
          }
          if (LIVE_STATUSES.has(row.status)) {
            await tryJoinFromStatus(row);
          }
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [callId, user?.id, tryJoinFromStatus]);

  useEffect(() => {
    if (!call || !isParticipant) return;
    if (!LIVE_STATUSES.has(call.status)) return;
    void tryJoinFromStatus(call);
  }, [call, isParticipant, tryJoinFromStatus]);

  useEffect(() => {
    if (!callId || !user?.id || !call) return;
    if (!RINGING_STATUSES.has(call.status)) return;

    let cancelled = false;
    const tick = async () => {
      try {
        const row = await refresh();
        if (cancelled || !row) return;
        if (ENDED_STATUSES.has(row.status)) {
          await leaveCallSession(row.id, row.status);
          return;
        }
        if (RINGING_STATUSES.has(row.status)) {
          setRingingCall(
            row.id,
            row.callee_id === user.id ? 'callee' : 'caller',
          );
          return;
        }
        if (LIVE_STATUSES.has(row.status)) {
          await tryJoinFromStatus(row);
        }
      } catch {
        // keep polling
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
  }, [callId, user?.id, call?.status, refresh, tryJoinFromStatus]);

  // Do not leave LiveKit on CallPage unmount - overlay may still own the call.
  // Leave only on explicit end/decline.

  const statusLabel = (() => {
    if (loading) return 'Loading call...';
    if (!call) return 'Call not found';
    if (ENDED_STATUSES.has(call.status)) return `Call ${call.status}`;
    if (session.callId === callId && session.statusLabel) return session.statusLabel;
    if (RINGING_STATUSES.has(call.status)) {
      return isCallee ? 'Incoming call' : 'Calling...';
    }
    if (LIVE_STATUSES.has(call.status)) return 'Connecting...';
    return call.status;
  })();

  const handleAccept = async () => {
    if (!callId || busy) return;
    setBusy(true);
    try {
      await ensureJoined(callId, { asCalleeAccept: true, role: 'callee' });
      await unlockRemoteAudio();
      const row = await refresh();
      if (row) setCall(row);
    } catch (e: any) {
      toast.error(e?.message || 'Could not accept call');
    } finally {
      setBusy(false);
    }
  };

  const handleDecline = async () => {
    if (!callId || busy) return;
    setBusy(true);
    try {
      await respondVoipCall(callId, false);
      await leaveCallSession(callId, 'rejected');
      toast.message('Call declined');
      navigate(backPathForCall(call), { replace: true });
    } catch (e: any) {
      toast.error(e?.message || 'Could not decline');
    } finally {
      setBusy(false);
    }
  };

  const handleEnd = async () => {
    if (!callId || busy) return;
    setBusy(true);
    try {
      await leaveCallSession(callId, 'ended');
      await endVoipCall(callId, 'ended');
      navigate(backPathForCall(call), { replace: true });
    } catch (e: any) {
      toast.error(e?.message || 'Could not end call');
    } finally {
      setBusy(false);
    }
  };

  const handleRetry = async () => {
    if (!callId || busy) return;
    setBusy(true);
    try {
      await retryCallMedia();
      await unlockRemoteAudio();
    } catch (e: any) {
      toast.error(e?.message || 'Could not retry audio');
    } finally {
      setBusy(false);
    }
  };

  const ringing = call && RINGING_STATUSES.has(call.status);
  const live = call && LIVE_STATUSES.has(call.status);
  const mediaReady = session.callId === callId && session.mediaPhase === 'media_ready';
  const mediaFailed = session.callId === callId && session.mediaPhase === 'failed';

  return (
    <div
      className="flex min-h-[100dvh] flex-col items-center justify-center bg-zinc-950 text-white p-6"
      data-testid="sociva-call-page"
      onClick={() => {
        void unlockRemoteAudio();
      }}
    >
      <div className="w-full max-w-sm space-y-6 text-center">
        <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-white/10">
          {loading || busy ? (
            <Loader2 className="h-8 w-8 animate-spin" />
          ) : (
            <Phone className="h-8 w-8" />
          )}
        </div>
        <div className="space-y-1">
          <h1 className="text-xl font-semibold">Sociva call</h1>
          <p className="text-sm text-zinc-300" data-testid="sociva-call-page-status">
            {statusLabel}
          </p>
          {!loading && call && !isParticipant ? (
            <p className="text-xs text-zinc-400 pt-2">You are not a participant on this call.</p>
          ) : null}
          {mediaFailed ? (
            <p className="text-xs text-amber-300 pt-2">
              {session.error || 'Audio did not connect. Retry or end the call.'}
            </p>
          ) : null}
        </div>

        {isCallee && ringing ? (
          <div className="flex gap-3">
            <Button
              type="button"
              variant="destructive"
              className="flex-1 h-12 gap-2"
              disabled={busy}
              onClick={handleDecline}
              data-testid="sociva-call-decline"
            >
              <PhoneOff size={16} /> Decline
            </Button>
            <Button
              type="button"
              className="flex-1 h-12 gap-2 bg-emerald-600 hover:bg-emerald-500"
              disabled={busy}
              onClick={handleAccept}
              data-testid="sociva-call-accept"
            >
              <Phone size={16} /> Accept
            </Button>
          </div>
        ) : null}

        {mediaFailed ? (
          <Button
            type="button"
            variant="secondary"
            className="w-full h-12"
            disabled={busy}
            onClick={handleRetry}
            data-testid="sociva-call-retry-media"
          >
            Retry audio
          </Button>
        ) : null}

        {(isCaller && ringing) || live || mediaReady || mediaFailed ? (
          <Button
            type="button"
            variant="destructive"
            className="w-full h-12 gap-2"
            disabled={busy}
            onClick={handleEnd}
            data-testid="sociva-call-end"
          >
            <PhoneOff size={16} /> End call
          </Button>
        ) : null}

        {call && ENDED_STATUSES.has(call.status) ? (
          <Button
            type="button"
            variant="secondary"
            className="w-full"
            onClick={() => navigate(backPathForCall(call), { replace: true })}
          >
            Back to order
          </Button>
        ) : null}

        {!call && !loading ? (
          <Button type="button" variant="secondary" className="w-full" onClick={() => navigate('/orders')}>
            Go to orders
          </Button>
        ) : null}
      </div>
    </div>
  );
}
