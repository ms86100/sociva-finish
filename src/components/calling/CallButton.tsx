// @ts-nocheck
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  endVoipCall,
  fetchVoipCapabilities,
  startVoipCall,
  type VoipCapabilities,
} from '@/lib/calling/CallManager';
import type { VoipContextType } from '@/lib/calling/resolveCallContext';

type Props = {
  contextType: VoipContextType;
  contextId: string;
  className?: string;
  fallbackLabel?: string;
  onFallback?: () => void;
};

export function CallButton({
  contextType,
  contextId,
  className,
  fallbackLabel = 'Use chat instead',
  onFallback,
}: Props) {
  const [caps, setCaps] = useState<VoipCapabilities | null>(null);
  const [busy, setBusy] = useState(false);
  const [activeCallId, setActiveCallId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchVoipCapabilities()
      .then((c) => {
        if (!cancelled) setCaps(c);
      })
      .catch(() => {
        if (!cancelled) {
          setCaps({
            enabled: false,
            livekit_configured: false,
            apple_voip_push_configured: false,
            android_voip_push_configured: true,
            can_place_calls: false,
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const canCall = !!caps?.can_place_calls;

  return (
    <div className="space-y-2" data-testid="sociva-call-button">
      <Button
        type="button"
        variant="outline"
        className={className || 'w-full h-11 font-semibold'}
        disabled={busy || !contextId}
        onClick={async () => {
          if (!canCall) {
            toast.message('In-app calling is not live yet', {
              description:
                'LiveKit and native ring setup are still required. Use chat for now.',
            });
            onFallback?.();
            return;
          }
          setBusy(true);
          try {
            if (activeCallId) {
              await endVoipCall(activeCallId, 'cancelled');
              setActiveCallId(null);
              toast.message('Call ended');
              return;
            }
            const res = await startVoipCall({
              contextType,
              contextId,
              idempotencyKey: `${contextType}:${contextId}:${Date.now()}`,
            });
            const id = res?.call?.id;
            if (id) setActiveCallId(id);
            toast.success('Calling… waiting for partner to answer');
          } catch (e: any) {
            const code = e?.code || '';
            if (code === 'busy') toast.error('Partner is already on a call');
            else if (code === 'disabled') {
              toast.message('In-app calling is not enabled yet', {
                description: fallbackLabel,
              });
              onFallback?.();
            } else toast.error(e?.message || 'Could not start call');
          } finally {
            setBusy(false);
          }
        }}
        data-testid="sociva-call-button-action"
      >
        {!caps
          ? 'Checking calling…'
          : activeCallId
            ? 'End call'
            : canCall
              ? 'Call in Sociva'
              : 'In-app calling not live yet'}
      </Button>
      {caps ? (
        <p className="text-[11px] text-muted-foreground px-1" data-testid="sociva-call-honesty">
          {canCall
            ? 'In-app call - numbers stay private'
            : `In-app calling turns on when LiveKit and push are ready${
                caps.enabled ? '' : ' (flag still off on server)'
              }. Numbers stay private - use chat meanwhile.`}
        </p>
      ) : null}
    </div>
  );
}
