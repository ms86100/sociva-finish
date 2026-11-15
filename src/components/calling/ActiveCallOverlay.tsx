// @ts-nocheck
import { useEffect, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import {
  endVoipCall,
  heartbeatVoipCall,
  respondVoipCall,
} from '@/lib/calling/CallManager';
import { joinLiveKitCall, leaveLiveKitCall } from '@/lib/calling/livekitRoom';
import { SocivaVoip } from '@/plugins/voip';
import { supabase } from '@/integrations/supabase/client';

const LIVE_STATUSES = new Set(['accepted', 'connecting', 'connected', 'active']);
const RINGING_STATUSES = new Set(['ringing', 'initiated']);
const ENDED_STATUSES = new Set(['ended', 'missed', 'declined', 'rejected', 'cancelled']);

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
 */
export function ActiveCallOverlay({ userId }: { userId?: string | null }) {
  const navigate = useNavigate();
  const [callId, setCallId] = useState<string | null>(null);
  const [status, setStatus] = useState<string>('');
  const [role, setRole] = useState<'caller' | 'callee' | null>(null);
  const [muted, setMuted] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!userId || !Capacitor.isNativePlatform()) return;
    const removes: Array<() => void> = [];

    (async () => {
      const inc = await SocivaVoip.addListener('incoming', (data) => {
        const id = String(data?.callId || '');
        if (id) {
          setCallId(id);
          setRole('callee');
          setStatus('Incoming…');
        }
      });
      removes.push(() => void inc.remove());

      const acc = await SocivaVoip.addListener('accepted', async (data) => {
        const id = String(data?.callId || '');
        if (!id) return;
        setCallId(id);
        setRole('callee');
        setStatus('Connecting…');
        try {
          await joinCallMedia(id, true);
          setStatus('Connected');
        } catch (e: any) {
          setStatus(e?.message || 'Could not connect');
        }
      });
      removes.push(() => void acc.remove());

      const end = await SocivaVoip.addListener('ended', async (data) => {
        const id = String(data?.callId || '');
        await leaveLiveKitCall();
        if (id) void endVoipCall(id, 'ended').catch(() => {});
        setCallId(null);
        setRole(null);
        setStatus('');
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
        setCallId(null);
        setRole(null);
        setStatus('');
        return;
      }
      if (RINGING_STATUSES.has(row.status)) {
        setCallId(row.id);
        setRole(asRole);
        setStatus(asRole === 'caller' ? 'Calling…' : 'Incoming…');
        return;
      }
      if (LIVE_STATUSES.has(row.status)) {
        setCallId(row.id);
        setRole(asRole);
        setStatus('Connecting…');
        try {
          await joinCallMedia(row.id, false);
          setStatus('Connected');
        } catch (e: any) {
          setStatus(e?.message || 'Could not join');
        }
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
                setStatus('Connecting…');
                try {
                  await joinCallMedia(callId, true);
                  setStatus('Connected');
                } catch (e: any) {
                  setStatus(e?.message || 'Could not connect');
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
                  setCallId(null);
                  setRole(null);
                  setStatus('');
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
                setCallId(null);
                setRole(null);
                setStatus('');
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
