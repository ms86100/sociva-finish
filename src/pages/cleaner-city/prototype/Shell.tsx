import type { ReactNode } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { Bell, Building2, Car, Compass, Home, UserRound } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useProto } from './store';
import { ProtoBtn, Segmented, Sheet } from './ui';

const TABS = [
  { to: '/cleaner-city/prototype', end: true, label: 'Home', icon: Home },
  { to: '/cleaner-city/prototype/discover', label: 'Discover', icon: Compass },
  { to: '/cleaner-city/prototype/rides', label: 'My Rides', icon: Car },
  { to: '/cleaner-city/prototype/profile', label: 'Profile', icon: UserRound },
];

export function PrototypeShell({ children }: { children: ReactNode }) {
  const { state, dispatch, me, resetDemo } = useProto();
  const navigate = useNavigate();
  const unread = state.notifications.filter((n) => !n.read).length;

  return (
    <div className="min-h-[100dvh] bg-[linear-gradient(180deg,#f3faf6_0%,#ffffff_28%,#ffffff_100%)] text-foreground">
      <div className="sticky top-0 z-40 border-b border-emerald-900/10 bg-emerald-950 text-emerald-50">
        <div className="mx-auto flex max-w-lg items-center justify-between gap-2 px-3 py-2 text-[11px] font-medium">
          <span>Design preview · mock data only · zero production writes</span>
          <button type="button" className="underline underline-offset-2" onClick={resetDemo}>
            Reset demo
          </button>
        </div>
      </div>

      <div className="mx-auto max-w-lg px-3 pt-3">
        <div className="mb-2 rounded-2xl border border-border/70 bg-white/90 p-2 shadow-sm backdrop-blur">
          <p className="mb-1.5 px-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            Viewing as
          </p>
          <Segmented
            value={state.perspective}
            options={[
              { id: 'priya', label: 'Priya · guest' },
              { id: 'arjun', label: 'Arjun · host' },
            ]}
            onChange={(id) => dispatch({ type: 'setPerspective', id: id as 'priya' | 'arjun' })}
          />
          <p className="mt-2 px-1 text-xs text-muted-foreground">{state.demoHint}</p>
        </div>

        <div className="mb-2 flex items-center justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">{me.name}</p>
            <p className="truncate text-xs text-muted-foreground">
              {me.homeLabel} → {me.officeLabel}
            </p>
          </div>
          <button
            type="button"
            className="relative inline-flex h-10 w-10 items-center justify-center rounded-xl border border-border bg-background"
            onClick={() => {
              dispatch({ type: 'setSheet', sheet: 'notifications' });
              dispatch({ type: 'markNotifsRead' });
            }}
            aria-label="Notifications"
          >
            <Bell className="h-4 w-4" />
            {unread > 0 ? (
              <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-emerald-700 px-1 text-[10px] font-bold text-white">
                {unread}
              </span>
            ) : null}
          </button>
        </div>
      </div>

      {children}

      <nav className="fixed bottom-0 left-0 right-0 z-40 border-t border-border/80 bg-background/95 pb-[max(0.5rem,env(safe-area-inset-bottom))] backdrop-blur">
        <div className="mx-auto grid max-w-lg grid-cols-4 gap-1 px-2 pt-2">
          {TABS.map((tab) => {
            const Icon = tab.icon;
            return (
              <NavLink
                key={tab.to}
                to={tab.to}
                end={tab.end}
                className={({ isActive }) =>
                  cn(
                    'flex flex-col items-center gap-1 rounded-xl px-2 py-2 text-[11px] font-semibold',
                    isActive ? 'bg-emerald-50 text-emerald-900' : 'text-muted-foreground',
                  )
                }
              >
                <Icon className="h-4 w-4" />
                {tab.label}
              </NavLink>
            );
          })}
        </div>
      </nav>

      <Sheet
        open={state.sheet === 'notifications'}
        title="Notifications"
        onClose={() => dispatch({ type: 'setSheet', sheet: null })}
      >
        <div className="space-y-2">
          {state.notifications.map((n) => (
            <div key={n.id} className="rounded-xl border border-border/70 p-3">
              <p className="text-sm font-semibold">{n.title}</p>
              <p className="text-xs text-muted-foreground">{n.body}</p>
            </div>
          ))}
        </div>
      </Sheet>

      <Sheet
        open={state.sheet === 'active-lock'}
        title="One active seat at a time"
        onClose={() => dispatch({ type: 'setSheet', sheet: null })}
      >
        <p className="mb-3 text-sm text-muted-foreground">
          Cancel your current seat before requesting another for the same corridor.
        </p>
        <ProtoBtn className="w-full" onClick={() => { dispatch({ type: 'setSheet', sheet: null }); navigate('/cleaner-city/prototype/rides'); }}>
          Open My Rides
        </ProtoBtn>
      </Sheet>

      <Sheet
        open={['declined', 'cancelled', 'otp-fail', 'need-meeting', 'timeout', 'no-show', 'dispute', 'share', 'gate-offer', 'gps', 'empty-matches', 'verify-email'].includes(state.sheet || '')}
        title={
          state.sheet === 'declined' ? 'Host declined'
            : state.sheet === 'cancelled' ? 'Ride cancelled'
              : state.sheet === 'otp-fail' ? 'OTP did not match'
                : state.sheet === 'need-meeting' ? 'Meeting point needed'
                  : state.sheet === 'timeout' ? 'No response'
                    : state.sheet === 'no-show' ? 'Marked no-show'
                      : state.sheet === 'dispute' ? 'Issue reported'
                        : state.sheet === 'share' ? 'Trip share link'
                          : state.sheet === 'gate-offer' ? 'Finish host setup'
                            : state.sheet === 'gps' ? 'GPS unavailable'
                              : state.sheet === 'verify-email' ? 'Verify your office email'
                                : 'No matches'
        }
        icon={state.sheet === 'verify-email' ? <Building2 className="h-5 w-5" /> : undefined}
        onClose={() => dispatch({ type: 'setSheet', sheet: null })}
      >
        {state.sheet === 'otp-fail' && (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">Enter the code shown on the guest phone: 482916.</p>
            <ProtoBtn className="w-full" onClick={() => dispatch({ type: 'setSheet', sheet: null })}>Try again</ProtoBtn>
          </div>
        )}
        {state.sheet === 'share' && (
          <div className="space-y-3">
            <p className="rounded-xl bg-secondary px-3 py-2 font-mono text-xs">
              https://sociva.in/cleaner-city/share/{state.ride?.shareToken}
            </p>
            <p className="text-sm text-muted-foreground">Public live viewer (mock). Revoke anytime from the ride.</p>
          </div>
        )}
        {state.sheet === 'gate-offer' && (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">Vehicle and verified emergency contact are required before publishing seats.</p>
            <ProtoBtn className="w-full" onClick={() => { dispatch({ type: 'setSheet', sheet: null }); navigate('/cleaner-city/prototype/profile/vehicle'); }}>
              Open vehicle setup
            </ProtoBtn>
          </div>
        )}
        {state.sheet === 'empty-matches' && (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">No seats on your corridor right now.</p>
            <ProtoBtn className="w-full" onClick={() => { dispatch({ type: 'toggleWaitlist' }); dispatch({ type: 'setSheet', sheet: null }); }}>
              {state.waitlisted ? 'Leave waitlist' : 'Join waitlist'}
            </ProtoBtn>
            <ProtoBtn variant="secondary" className="w-full" onClick={() => { dispatch({ type: 'setMode', mode: 'offer' }); dispatch({ type: 'setSheet', sheet: null }); navigate('/cleaner-city/prototype/discover'); }}>
              Offer a seat instead
            </ProtoBtn>
          </div>
        )}
        {state.sheet === 'verify-email' && (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Find neighbors going to your workplace and make trusted everyday commutes. This prototype uses a demo code.
            </p>
            <label className="block">
              <span className="text-sm font-semibold">Work email</span>
              <input
                className="mt-1.5 w-full rounded-xl border border-emerald-700/40 px-3 py-2.5 text-sm outline-none focus:border-emerald-800"
                placeholder="you@company.com"
                defaultValue={me.email}
                readOnly
              />
            </label>
            <ProtoBtn
              className="w-full"
              onClick={() => {
                dispatch({ type: 'setSheet', sheet: null });
                dispatch({
                  type: 'setDemoHint',
                  hint: 'Work email verified (mock). Your trusted member badge shows on seat requests.',
                });
              }}
            >
              Send verification code →
            </ProtoBtn>
            <p className="text-[11px] text-muted-foreground">
              Office email verification is mocked for this demo; real email delivery and shared accounts are not connected.
            </p>
          </div>
        )}
        {['declined', 'cancelled', 'timeout', 'no-show', 'dispute', 'need-meeting', 'gps'].includes(state.sheet || '') && (
          <p className="text-sm text-muted-foreground">
            {state.sheet === 'declined' && 'You can request another host or join the waitlist.'}
            {state.sheet === 'cancelled' && 'Both sides are notified. History stays under Completed.'}
            {state.sheet === 'timeout' && 'The request expired after no host response. Try another match.'}
            {state.sheet === 'no-show' && 'Logged for trust. You can report more detail from the ride.'}
            {state.sheet === 'dispute' && 'Your side is recorded. Admin resolution stays outside this resident flow.'}
            {state.sheet === 'need-meeting' && 'Pick a meeting point before starting the trip.'}
            {state.sheet === 'gps' && 'Use a saved society meeting suggestion or drop a pin manually.'}
          </p>
        )}
      </Sheet>
    </div>
  );
}
