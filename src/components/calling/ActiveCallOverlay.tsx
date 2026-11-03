// @ts-nocheck
import { useEffect, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { Button } from '@/components/ui/button';
import {
  endVoipCall,
  heartbeatVoipCall,
  respondVoipCall,
} from '@/lib/calling/CallManager';
import { joinLiveKitCall, leaveLiveKitCall } from '@/lib/calling/livekitRoom';
import { SocivaVoip } from '@/plugins/voip';
import { supabase } from '@/integrations/supabase/client';

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
 * In-call chrome for native: CallKit accept + Realtime active status join LiveKit audio.
 */
export function ActiveCallOverlay({ userId }: { userId?: string | null }) {
  const [callId, setCallId] = useState<string | null>(null);
  const [status, setStatus] = useState<string>('');
  const [muted, setMuted] = useState(false);

  useEffect(() => {
    if (!userId || !Capacitor.isNativePlatform()) return;
    const removes: Array<() => void> = [];

    (async () => {
      const inc = await SocivaVoip.addListener('incoming', (data) => {
        const id = String(data?.callId || '');
        if (id) {
          setCallId(id);
          setStatus('Incoming…');
        }
      });
      removes.push(() => void inc.remove());

      const acc = await SocivaVoip.addListener('accepted', async (data) => {
        const id = String(data?.callId || '');
        if (!id) return;
        setCallId(id);
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
        setStatus('');
      });
      removes.push(() => void end.remove());
    })();

    return () => removes.forEach((fn) => fn());
  }, [userId]);

  useEffect(() => {
    if (!userId) return;
    const channel = supabase
      .channel(`voip-calls-${userId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'call_sessions',
          filter: `caller_id=eq.${userId}`,
        },
        async (payload) => {
          const row = payload.new as any;
          if (!row?.id) return;
          if (row.status === 'ringing') {
            setCallId(row.id);
            setStatus('Calling…');
          }
          if (row.status === 'active') {
            setCallId(row.id);
            setStatus('Connecting…');
            try {
              await joinCallMedia(row.id);
              setStatus('Connected');
            } catch (e: any) {
              setStatus(e?.message || 'Could not join');
            }
          }
          if (['ended', 'missed', 'declined', 'cancelled'].includes(row.status)) {
            await leaveLiveKitCall();
            setCallId(null);
            setStatus('');
          }
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [userId]);

  if (!callId) return null;

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
            setStatus('');
          }}
        >
          End
        </Button>
      </div>
    </div>
  );
}
