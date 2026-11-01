// @ts-nocheck
import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { AppLayout } from '@/components/layout/AppLayout';
import { CleanerCityGate } from '@/components/cleaner-city/CleanerCityGate';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  useCircleChat,
  useCleanerCityChatInbox,
  useDirectChat,
  useRideChat,
  useSendCircleChat,
  useSendDirectChat,
  useSendRideChat,
} from '@/hooks/queries/useCleanerCity';
import { useAuth } from '@/contexts/AuthContext';

export default function CleanerCityChatPage() {
  const { user } = useAuth();
  const [params] = useSearchParams();
  const { data: inbox = [], isError } = useCleanerCityChatInbox();
  const [picked, setPicked] = useState<string | null>(params.get('thread'));
  const [body, setBody] = useState('');
  const active = useMemo(
    () => inbox.find((row) => `${row.kind}:${row.thread_id}` === picked) || inbox[0] || null,
    [inbox, picked],
  );
  const rideId = active?.kind === 'ride' ? active.ride_id || active.thread_id : null;
  const circleId = active?.kind === 'circle' ? active.circle_id || active.thread_id : null;
  const otherId = active?.kind === 'direct' ? active.other_user_id : null;
  const { data: rideChat = [] } = useRideChat(rideId);
  const { data: circleChat = [] } = useCircleChat(circleId);
  const { data: directChat = [] } = useDirectChat(otherId);
  const sendRide = useSendRideChat();
  const sendCircle = useSendCircleChat();
  const sendDirect = useSendDirectChat();
  const messages = active?.kind === 'ride' ? rideChat : active?.kind === 'circle' ? circleChat : directChat;

  const send = async () => {
    const text = body.trim();
    if (!text || !active) return;
    try {
      if (active.kind === 'ride') {
        await sendRide.mutateAsync({
          ride_id: rideId,
          society_id: active.society_id,
          body: text,
        });
      } else if (active.kind === 'circle') {
        await sendCircle.mutateAsync({
          circle_id: circleId,
          society_id: active.society_id,
          body: text,
        });
      } else if (otherId) {
        await sendDirect.mutateAsync({ recipient_id: otherId, body: text });
      }
      setBody('');
    } catch (e) {
      toast.error(e?.message || 'Could not send');
    }
  };

  return (
    <AppLayout headerTitle="Commute chat">
      <CleanerCityGate>
        <div className="p-4 pb-24 space-y-4" data-testid="cleaner-city-chat">
          <div>
            <h1 className="text-xl font-bold">Chat</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Messages stay with a ride, a circle, or someone you already ride with. A block hides that person.
            </p>
          </div>
          {isError && (
            <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
              The chat inbox is not on the server yet. Open a ride or a circle to message there.
            </div>
          )}
          {!isError && inbox.length === 0 && (
            <div className="rounded-2xl border border-border bg-card p-4 text-sm">
              No conversations yet. Request a ride or join a circle, then come back here.
              <div className="mt-3 flex gap-2">
                <Button asChild size="sm"><Link to="/cleaner-city/find">Find a ride</Link></Button>
                <Button asChild size="sm" variant="outline"><Link to="/cleaner-city/circles">Circles</Link></Button>
              </div>
            </div>
          )}
          {inbox.length > 0 && (
            <div className="flex gap-2 overflow-x-auto">
              {inbox.map((row) => {
                const key = `${row.kind}:${row.thread_id}`;
                const selected = active && key === `${active.kind}:${active.thread_id}`;
                return (
                  <button
                    key={key}
                    type="button"
                    className={`shrink-0 rounded-full border px-3 py-1 text-xs font-semibold ${selected ? 'border-primary bg-primary/10 text-primary' : 'border-border'}`}
                    onClick={() => setPicked(key)}
                  >
                    {row.title || row.kind}
                  </button>
                );
              })}
            </div>
          )}
          {active && (
            <div className="rounded-2xl border border-border bg-card p-4 space-y-3">
              <p className="text-sm font-semibold">{active.title || 'Conversation'}</p>
              <div className="max-h-80 space-y-2 overflow-y-auto">
                {messages.map((row) => (
                  <p
                    key={row.id}
                    className={`rounded-xl px-3 py-2 text-sm ${row.sender_id === user?.id ? 'bg-primary/10' : 'bg-muted'}`}
                  >
                    {row.body}
                  </p>
                ))}
                {messages.length === 0 && (
                  <p className="text-xs text-muted-foreground">Say where you are, or that you are five minutes late.</p>
                )}
              </div>
              <div className="flex gap-2">
                <Input
                  value={body}
                  maxLength={500}
                  placeholder="Message"
                  onChange={(e) => setBody(e.target.value)}
                />
                <Button type="button" disabled={!body.trim()} onClick={send}>Send</Button>
              </div>
              {active.kind === 'ride' && rideId && (
                <Link to={`/cleaner-city/ride/${rideId}`} className="text-xs font-semibold text-primary">
                  Open the ride
                </Link>
              )}
            </div>
          )}
        </div>
      </CleanerCityGate>
    </AppLayout>
  );
}
