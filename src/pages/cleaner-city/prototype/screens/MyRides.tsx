import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useProto } from '../store';
import { ProtoBtn, ProtoCard, ProtoPage, StatusPill } from '../ui';
import type { RideStatus } from '../types';

type Tab = 'requests' | 'upcoming' | 'live' | 'completed';

function tabFor(status: RideStatus): Tab {
  if (status === 'requested') return 'requests';
  if (status === 'confirmed' || status === 'pickup_pending') return 'upcoming';
  if (status === 'started') return 'live';
  return 'completed';
}

function ctaLabel(status: RideStatus, isHost: boolean): string {
  if (status === 'requested') return isHost ? 'Review request' : 'Waiting for host';
  if (status === 'confirmed') return 'Set meeting point';
  if (status === 'pickup_pending') return isHost ? 'Enter OTP' : 'Show pickup code';
  if (status === 'started') return 'Open live journey';
  if (status === 'completed') return 'Rate & fuel';
  return 'View details';
}

export function MyRidesScreen() {
  const { state, dispatch } = useProto();
  const navigate = useNavigate();
  const [tab, setTab] = useState<Tab>('requests');
  const isHost = state.perspective === 'arjun';

  const ride = state.ride;
  const filtered = useMemo(() => {
    if (!ride) return [];
    return tabFor(ride.status) === tab ? [ride] : [];
  }, [ride, tab]);

  useEffect(() => {
    if (ride) setTab(tabFor(ride.status));
  }, [ride]);

  return (
    <ProtoPage>
      <div>
        <h1 className="text-xl font-semibold tracking-tight">My Rides</h1>
        <p className="text-sm text-muted-foreground">One inbox for requests, upcoming, live and history.</p>
      </div>

      <div className="flex gap-1 overflow-x-auto rounded-2xl bg-secondary p-1">
        {(['requests', 'upcoming', 'live', 'completed'] as Tab[]).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`whitespace-nowrap rounded-xl px-3 py-2 text-xs font-semibold capitalize ${
              tab === t ? 'bg-emerald-800 text-white' : 'text-muted-foreground'
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {!ride ? (
        <ProtoCard>
          <p className="font-semibold">No rides yet</p>
          <p className="mt-1 text-sm text-muted-foreground">Find a seat or publish an offer to get started.</p>
          <ProtoBtn className="mt-3 w-full" onClick={() => navigate('/cleaner-city/prototype/discover')}>
            Go to Discover
          </ProtoBtn>
        </ProtoCard>
      ) : filtered.length === 0 ? (
        <ProtoCard>
          <p className="text-sm text-muted-foreground">Nothing in {tab}. Check another tab.</p>
        </ProtoCard>
      ) : (
        filtered.map((r) => (
          <ProtoCard key={r.id} onClick={() => navigate(`/cleaner-city/prototype/ride/${r.id}`)}>
            <div className="mb-2 flex items-center justify-between gap-2">
              <p className="font-semibold">Today · 08:35 · Manyata</p>
              <StatusPill tone={r.status === 'started' ? 'live' : r.status === 'requested' ? 'warn' : 'ok'}>
                {r.status.replace('_', ' ')}
              </StatusPill>
            </div>
            <p className="text-sm text-muted-foreground">
              {isHost ? 'Guest: Priya Mehta' : 'Host: Arjun Rao'} · {r.meetingPoint || 'Meeting TBD'}
            </p>
            <p className="mt-2 text-sm font-semibold text-emerald-800">{ctaLabel(r.status, isHost)} →</p>
          </ProtoCard>
        ))
      )}

      {ride?.status === 'requested' && isHost ? (
        <div className="flex gap-2">
          <ProtoBtn className="flex-1" onClick={() => dispatch({ type: 'acceptRequest' })}>
            Accept
          </ProtoBtn>
          <ProtoBtn variant="secondary" className="flex-1" onClick={() => dispatch({ type: 'declineRequest' })}>
            Decline
          </ProtoBtn>
          <ProtoBtn variant="ghost" onClick={() => dispatch({ type: 'timeoutRequest' })}>
            Timeout
          </ProtoBtn>
        </div>
      ) : null}
    </ProtoPage>
  );
}
