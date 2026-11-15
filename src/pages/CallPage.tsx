// @ts-nocheck
import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Phone, PhoneOff, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/contexts/AuthContext';
import {
  endVoipCall,
  heartbeatVoipCall,
  respondVoipCall,
} from '@/lib/calling/CallManager';
import { joinLiveKitCall, leaveLiveKitCall } from '@/lib/calling/livekitRoom';
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

async function joinMedia(callId: string) {
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
 * Callee accepts/declines here; both parties join LiveKit after accept.
 */
export default function CallPage() {
  const { callId } = useParams<{ callId: string }>();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [call, setCall] = useState<CallRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [statusLabel, setStatusLabel] = useState('Loading call…');
  const [joined, setJoined] = useState(false);

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

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!callId) {
        setLoading(false);
        setStatusLabel('Call not found');
        return;
      }
      try {
        const row = await refresh();
        if (cancelled) return;
        if (!row) {
          setStatusLabel('Call not found');
          return;
        }
        if (ENDED_STATUSES.has(row.status)) {
          setStatusLabel(`Call ${row.status}`);
          return;
        }
        if (RINGING_STATUSES.has(row.status)) {
          setStatusLabel(row.callee_id === user?.id ? 'Incoming call' : 'Calling…');
          return;
        }
        if (LIVE_STATUSES.has(row.status)) {
          setStatusLabel('Connecting…');
        }
      } catch (e: any) {
        if (!cancelled) setStatusLabel(e?.message || 'Could not load call');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [callId, refresh, user?.id]);

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
            await leaveLiveKitCall();
            setJoined(false);
            setStatusLabel(`Call ${row.status}`);
            return;
          }
          if (RINGING_STATUSES.has(row.status)) {
            setStatusLabel(row.callee_id === user.id ? 'Incoming call' : 'Calling…');
            return;
          }
          if (LIVE_STATUSES.has(row.status) && !joined) {
            setStatusLabel('Connecting…');
            try {
              await joinMedia(row.id);
              setJoined(true);
              setStatusLabel('Connected');
            } catch (e: any) {
              setStatusLabel(e?.message || 'Could not join audio');
            }
          }
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [callId, user?.id, joined]);

  // Caller/callee who lands after accept should join once.
  useEffect(() => {
    if (!call || joined || busy || !isParticipant) return;
    if (!LIVE_STATUSES.has(call.status)) return;
    let cancelled = false;
    (async () => {
      setBusy(true);
      setStatusLabel('Connecting…');
      try {
        await joinMedia(call.id);
        if (!cancelled) {
          setJoined(true);
          setStatusLabel('Connected');
        }
      } catch (e: any) {
        if (!cancelled) setStatusLabel(e?.message || 'Could not join audio');
      } finally {
        if (!cancelled) setBusy(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [call, joined, busy, isParticipant]);

  useEffect(() => {
    return () => {
      void leaveLiveKitCall();
    };
  }, []);

  const handleAccept = async () => {
    if (!callId || busy) return;
    setBusy(true);
    setStatusLabel('Accepting…');
    try {
      await respondVoipCall(callId, true);
      await joinMedia(callId);
      setJoined(true);
      setStatusLabel('Connected');
      const row = await refresh();
      if (row) setCall(row);
    } catch (e: any) {
      toast.error(e?.message || 'Could not accept call');
      setStatusLabel(e?.message || 'Could not accept');
    } finally {
      setBusy(false);
    }
  };

  const handleDecline = async () => {
    if (!callId || busy) return;
    setBusy(true);
    try {
      await respondVoipCall(callId, false);
      await leaveLiveKitCall();
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
      await leaveLiveKitCall();
      await endVoipCall(callId, 'ended');
      navigate(backPathForCall(call), { replace: true });
    } catch (e: any) {
      toast.error(e?.message || 'Could not end call');
    } finally {
      setBusy(false);
    }
  };

  const ringing = call && RINGING_STATUSES.has(call.status);
  const live = call && LIVE_STATUSES.has(call.status);

  return (
    <div
      className="flex min-h-[100dvh] flex-col items-center justify-center bg-zinc-950 text-white p-6"
      data-testid="sociva-call-page"
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

        {(isCaller && ringing) || live || joined ? (
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
