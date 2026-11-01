// @ts-nocheck
import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { AppLayout } from '@/components/layout/AppLayout';
import { CleanerCityGate } from '@/components/cleaner-city/CleanerCityGate';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
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
import {
  firstName,
  formatDepartTime,
  rideStatusLabel,
} from '@/lib/cleaner-city/rideMissionCopy';
import { cn } from '@/lib/utils';

function initials(name?: string | null) {
  const parts = String(name || '?').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  return parts[0].slice(0, 1).toUpperCase();
}

function shortTime(iso?: string | null) {
  if (!iso) return '';
  try {
    return new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' }).format(
      new Date(iso),
    );
  } catch {
    return '';
  }
}

function inboxPillLabel(row: {
  kind: string;
  title?: string | null;
  partner_name?: string | null;
  depart_time?: string | null;
  ride_status?: string | null;
}) {
  if (row.kind !== 'ride') return row.title || row.kind;
  const who = firstName(row.partner_name);
  const leave = formatDepartTime(row.depart_time);
  const status = rideStatusLabel(row.ride_status).split(' ')[0];
  return [who, leave ? `leaves ${leave}` : null, status].filter(Boolean).join(' · ');
}

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
  const messages =
    active?.kind === 'ride' ? rideChat : active?.kind === 'circle' ? circleChat : directChat;

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
              Every ride thread stays tied to the mission - open it anytime from here.
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
                <Button asChild size="sm">
                  <Link to="/cleaner-city/find">Find a ride</Link>
                </Button>
                <Button asChild size="sm" variant="outline">
                  <Link to="/cleaner-city/circles">Circles</Link>
                </Button>
              </div>
            </div>
          )}
          {inbox.length > 0 && (
            <div className="flex gap-2 overflow-x-auto pb-1">
              {inbox.map((row) => {
                const key = `${row.kind}:${row.thread_id}`;
                const selected = active && key === `${active.kind}:${active.thread_id}`;
                return (
                  <button
                    key={key}
                    type="button"
                    className={cn(
                      'shrink-0 rounded-full border px-3 py-1.5 text-xs font-semibold max-w-[220px] truncate',
                      selected
                        ? 'border-primary bg-primary/10 text-primary'
                        : 'border-border',
                    )}
                    onClick={() => setPicked(key)}
                  >
                    {inboxPillLabel(row)}
                  </button>
                );
              })}
            </div>
          )}
          {active && (
            <div className="rounded-2xl border border-border bg-card overflow-hidden">
              {active.kind === 'ride' && rideId ? (
                <div
                  className="sticky top-0 z-10 border-b border-border bg-[#0D3327] p-4 text-white space-y-3"
                  data-testid="cleaner-city-chat-mission-header"
                >
                  <div className="flex items-center gap-3">
                    <Avatar className="h-12 w-12 border border-[#A3C9A8]/40">
                      {active.partner_avatar_url ? (
                        <AvatarImage
                          src={active.partner_avatar_url}
                          alt={active.partner_name || 'Partner'}
                          className="object-cover"
                        />
                      ) : null}
                      <AvatarFallback className="bg-[#A3C9A8]/20 text-sm font-bold text-[#A3C9A8]">
                        {initials(active.partner_name)}
                      </AvatarFallback>
                    </Avatar>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-extrabold">
                        {active.partner_name || 'Neighbour'}
                      </p>
                      <p className="text-[11px] text-white/70 truncate">
                        {[
                          active.partner_flat ? `Flat ${active.partner_flat}` : null,
                          formatDepartTime(active.depart_time)
                            ? `Leaves ${formatDepartTime(active.depart_time)}`
                            : null,
                          rideStatusLabel(active.ride_status),
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </p>
                      {(active.origin_label || active.destination_label) && (
                        <p className="mt-0.5 text-[11px] text-white/60 truncate">
                          {active.origin_label || 'Pickup'} → {active.destination_label || 'Drop'}
                        </p>
                      )}
                    </div>
                  </div>
                  {active.meeting_point_label ? (
                    <p className="text-[11px] text-[#A3C9A8] font-semibold">
                      Meeting: {active.meeting_point_label}
                    </p>
                  ) : null}
                  <Button
                    asChild
                    className="h-11 w-full font-semibold bg-[#A3C9A8] text-[#0D3327] hover:bg-[#A3C9A8]/90"
                  >
                    <Link to={`/cleaner-city/ride/${rideId}`}>Open mission</Link>
                  </Button>
                </div>
              ) : (
                <div className="border-b border-border px-4 py-3">
                  <p className="text-sm font-semibold">{active.title || 'Conversation'}</p>
                  {active.last_body ? (
                    <p className="text-[11px] text-muted-foreground truncate mt-0.5">
                      {active.last_body}
                    </p>
                  ) : null}
                </div>
              )}

              <div className="p-4 space-y-3">
                <div className="max-h-80 space-y-2 overflow-y-auto">
                  {messages.map((row) => {
                    const mine = row.sender_id === user?.id;
                    const label = mine
                      ? 'You'
                      : firstName(row.sender_name || active.partner_name);
                    return (
                      <div
                        key={row.id}
                        className={cn(
                          'rounded-xl px-3 py-2 text-sm',
                          mine ? 'bg-primary/10 ml-8' : 'bg-muted mr-8',
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
                  {messages.length === 0 && (
                    <p className="text-xs text-muted-foreground">
                      Say where you are, or that you are five minutes late.
                    </p>
                  )}
                </div>
                <div className="flex gap-2">
                  <Input
                    value={body}
                    maxLength={500}
                    placeholder="Message"
                    onChange={(e) => setBody(e.target.value)}
                  />
                  <Button type="button" disabled={!body.trim()} onClick={send}>
                    Send
                  </Button>
                </div>
              </div>
            </div>
          )}
        </div>
      </CleanerCityGate>
    </AppLayout>
  );
}
