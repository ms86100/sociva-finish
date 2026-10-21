import { Mic, MicOff, PhoneOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { SocivaVoiceCallStatus } from '@/hooks/useSocivaVoiceCall';

const STATUS_COPY: Record<SocivaVoiceCallStatus, string> = {
  idle: 'Ready when you are',
  starting: 'Saving your details...',
  connecting: 'Connecting to Sociva...',
  live: 'Listening',
  agent_speaking: 'Sociva is speaking',
  ended: 'Call ended',
  error: 'Something went wrong',
};

export function SocivaVoiceCall({
  status,
  muted,
  error,
  onToggleMute,
  onEnd,
}: {
  status: SocivaVoiceCallStatus;
  muted: boolean;
  error: string | null;
  onToggleMute: () => void;
  onEnd: () => void;
}) {
  const live = status === 'live' || status === 'agent_speaking' || status === 'connecting' || status === 'starting';
  const speaking = status === 'agent_speaking';

  return (
    <div className="flex flex-col items-center text-center px-4 py-8">
      <img src="/logo.png" alt="Sociva" className="h-10 w-auto mb-8" />

      <div className="relative mb-8">
        <div
          className={cn(
            'absolute inset-0 rounded-full bg-primary/20',
            live && 'animate-ping',
          )}
        />
        <div
          className={cn(
            'relative h-36 w-36 rounded-full flex items-center justify-center border-2 transition-colors',
            speaking ? 'border-primary bg-primary/20' : 'border-primary/40 bg-primary/10',
          )}
        >
          {muted ? (
            <MicOff size={36} className="text-muted-foreground" />
          ) : (
            <Mic size={36} className="text-primary" />
          )}
        </div>
      </div>

      <p className="text-lg font-semibold text-foreground">{STATUS_COPY[status]}</p>
      {error ? (
        <p className="mt-2 text-sm text-destructive max-w-xs">{error}</p>
      ) : (
        <p className="mt-2 text-sm text-muted-foreground max-w-xs">
          Speak in Hindi, English, or Hinglish. Tell Sociva what you sell, your prices, and when you can take orders.
        </p>
      )}

      {live && (
        <div className="mt-8 flex items-center gap-4">
          <Button
            type="button"
            variant="outline"
            className="rounded-full h-12 px-5"
            onClick={onToggleMute}
          >
            {muted ? <MicOff size={18} className="mr-2" /> : <Mic size={18} className="mr-2" />}
            {muted ? 'Unmute' : 'Mute'}
          </Button>
          <Button
            type="button"
            variant="destructive"
            className="rounded-full h-12 px-5"
            onClick={onEnd}
          >
            <PhoneOff size={18} className="mr-2" />
            End call
          </Button>
        </div>
      )}
    </div>
  );
}
