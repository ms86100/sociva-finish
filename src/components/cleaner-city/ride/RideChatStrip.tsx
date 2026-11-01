// @ts-nocheck
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import type { RideChatMessage } from '@/hooks/queries/useCleanerCity';
import { firstName } from '@/lib/cleaner-city/rideMissionCopy';
import { cn } from '@/lib/utils';

type Props = {
  rideId: string;
  messages: RideChatMessage[];
  myUserId?: string | null;
  partnerName?: string | null;
  partnerAvatarUrl?: string | null;
  body: string;
  onBodyChange: (v: string) => void;
  onSend: () => void;
  sending?: boolean;
  disabled?: boolean;
};

function initials(name?: string | null) {
  const parts = String(name || '?').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  return parts[0].slice(0, 1).toUpperCase();
}

function shortTime(iso?: string) {
  if (!iso) return '';
  try {
    return new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' }).format(
      new Date(iso),
    );
  } catch {
    return '';
  }
}

export function RideChatStrip({
  rideId,
  messages,
  myUserId,
  partnerName,
  partnerAvatarUrl,
  body,
  onBodyChange,
  onSend,
  sending,
  disabled,
}: Props) {
  const recent = messages.slice(-6);
  const partnerFirst = firstName(partnerName);

  return (
    <section
      id="cleaner-city-ride-chat"
      className="rounded-2xl border border-border bg-card p-4 space-y-3"
      data-testid="cleaner-city-ride-chat"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2.5">
          <Avatar className="h-9 w-9">
            {partnerAvatarUrl ? (
              <AvatarImage src={partnerAvatarUrl} alt={partnerFirst} className="object-cover" />
            ) : null}
            <AvatarFallback className="bg-primary/15 text-xs font-bold text-primary">
              {initials(partnerName)}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0">
            <p className="text-sm font-semibold">Chat with {partnerFirst}</p>
            <p className="text-[11px] text-muted-foreground">Tied to this ride mission</p>
          </div>
        </div>
        <Link
          to={`/cleaner-city/chat?thread=ride:${rideId}`}
          className="shrink-0 text-xs font-semibold text-primary"
        >
          Full chat
        </Link>
      </div>

      <div className="max-h-40 space-y-2 overflow-y-auto">
        {recent.map((row) => {
          const mine = row.sender_id === myUserId;
          const label = mine ? 'You' : firstName(row.sender_name || partnerName);
          return (
            <div
              key={row.id}
              className={cn(
                'rounded-xl px-3 py-2 text-sm',
                mine ? 'bg-primary/10 ml-6' : 'bg-muted mr-6',
              )}
            >
              <div className="flex items-center justify-between gap-2 text-[10px] text-muted-foreground">
                <span className="font-semibold">{label}</span>
                <span>{shortTime(row.created_at)}</span>
              </div>
              <p className="mt-0.5 leading-snug">{row.body}</p>
            </div>
          );
        })}
        {recent.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            Say where you are, or that you are five minutes late.
          </p>
        ) : null}
      </div>

      <div className="flex gap-2">
        <Input
          value={body}
          onChange={(e) => onBodyChange(e.target.value)}
          placeholder={`Message ${partnerFirst}`}
          maxLength={500}
          disabled={disabled}
        />
        <Button
          variant="outline"
          disabled={disabled || !body.trim() || sending}
          onClick={onSend}
        >
          Send
        </Button>
      </div>
    </section>
  );
}
