import { Link, useNavigate, useParams } from 'react-router-dom';
import { useProto } from '../store';
import { MapPlane, ProtoBtn, ProtoCard, ProtoPage, StatusPill } from '../ui';

const QUICK = ['Running 5 min late', 'At the gate', 'On my way'];

export function RideMissionScreen({ rideIdProp }: { rideIdProp?: string } = {}) {
  const params = useParams();
  const id = rideIdProp || params.id;
  const { state, dispatch } = useProto();
  const navigate = useNavigate();
  const ride = state.ride;
  const isHost = state.perspective === 'arjun';
  const isGuest = state.perspective === 'priya';

  if (!ride || ride.id !== id) {
    return (
      <ProtoPage>
        <p className="text-sm text-muted-foreground">Ride not found in this demo session.</p>
        <ProtoBtn className="mt-3 w-full" onClick={() => navigate('/cleaner-city/prototype/discover')}>
          Back to Discover
        </ProtoBtn>
      </ProtoPage>
    );
  }

  return (
    <ProtoPage>
      <div className="flex items-start justify-between gap-2">
        <div>
          <Link to="/cleaner-city/prototype/rides" className="text-xs font-semibold text-emerald-800">
            ← My Rides
          </Link>
          <h1 className="mt-1 text-xl font-semibold tracking-tight">Shared commute</h1>
          <p className="text-sm text-muted-foreground">Same journey · role-specific actions</p>
        </div>
        <StatusPill tone={ride.status === 'started' ? 'live' : 'ok'}>{ride.status.replace('_', ' ')}</StatusPill>
      </div>

      <ProtoCard>
        <p className="text-sm font-semibold">Today · 08:35 · To office</p>
        <p className="mt-1 text-sm text-muted-foreground">Host Arjun · Guest Priya · Tower H → Manyata</p>
        <p className="mt-2 text-sm">
          Meeting: <span className="font-semibold">{ride.meetingPoint || 'Not set yet'}</span>
        </p>
      </ProtoCard>

      <MapPlane
        label={ride.meetingPoint || 'Corridor preview'}
        meta={ride.status === 'started' ? 'Live tracking · foreground honesty note' : 'Set meeting point to unlock OTP'}
      />

      {ride.status === 'requested' && (
        <ProtoCard>
          <p className="font-semibold">{isHost ? 'Priya is waiting' : 'Waiting for Arjun'}</p>
          {isHost ? (
            <div className="mt-3 flex gap-2">
              <ProtoBtn className="flex-1" onClick={() => dispatch({ type: 'acceptRequest' })}>Accept</ProtoBtn>
              <ProtoBtn variant="secondary" className="flex-1" onClick={() => dispatch({ type: 'declineRequest' })}>Decline</ProtoBtn>
            </div>
          ) : (
            <div className="mt-3 flex gap-2">
              <ProtoBtn variant="secondary" className="flex-1" onClick={() => dispatch({ type: 'cancelRide', by: 'priya' })}>
                Cancel seat
              </ProtoBtn>
              <ProtoBtn variant="ghost" onClick={() => dispatch({ type: 'timeoutRequest' })}>Simulate timeout</ProtoBtn>
            </div>
          )}
        </ProtoCard>
      )}

      {(ride.status === 'confirmed' || (ride.status === 'pickup_pending' && !ride.meetingPoint)) && (
        <ProtoCard>
          <p className="font-semibold">Choose meeting point</p>
          <p className="mt-1 text-sm text-muted-foreground">Same pin for both. Not the same as Offer match pins.</p>
          <div className="mt-3 space-y-2">
            {['Tower H main gate', 'ORR bus bay', 'Use GPS (mock)'].map((label) => (
              <ProtoBtn
                key={label}
                variant="secondary"
                className="w-full justify-start"
                onClick={() => {
                  if (label.startsWith('Use GPS')) dispatch({ type: 'setSheet', sheet: 'gps' });
                  else dispatch({ type: 'setMeetingPoint', label });
                }}
              >
                {label}
              </ProtoBtn>
            ))}
          </div>
        </ProtoCard>
      )}

      {ride.status === 'pickup_pending' && ride.meetingPoint && (
        <ProtoCard>
          <p className="font-semibold">Pickup verification</p>
          {isGuest ? (
            <>
              <p className="mt-1 text-sm text-muted-foreground">Show this code to Arjun</p>
              <p className="mt-3 text-center font-mono text-4xl font-bold tracking-[0.25em] text-emerald-900">
                {ride.otp || '••••••'}
              </p>
              <div className="mt-3 flex gap-2">
                <ProtoBtn className="flex-1" onClick={() => dispatch({ type: 'createOtp' })}>
                  {ride.otp ? 'Refresh code' : 'Create pickup code'}
                </ProtoBtn>
                <ProtoBtn variant="ghost" onClick={() => dispatch({ type: 'noShow' })}>No-show</ProtoBtn>
              </div>
            </>
          ) : (
            <>
              <p className="mt-1 text-sm text-muted-foreground">Enter the code from Priya’s screen</p>
              <input
                className="mt-3 w-full rounded-xl border border-border px-3 py-3 text-center font-mono text-2xl tracking-[0.3em]"
                value={ride.otpEntered}
                onChange={(e) => dispatch({ type: 'setOtpEntered', value: e.target.value })}
                placeholder="000000"
                inputMode="numeric"
              />
              <ProtoBtn className="mt-3 w-full" onClick={() => dispatch({ type: 'verifyOtp' })}>
                Start trip
              </ProtoBtn>
            </>
          )}
        </ProtoCard>
      )}

      {ride.status === 'started' && (
        <>
          <ProtoCard>
            <p className="font-semibold">Drop sequence</p>
            <p className="mt-1 text-xs text-muted-foreground">Auto road order - separate from optional Offer match pins.</p>
            <div className="mt-3 space-y-2">
              {ride.dropStops.map((stop, i) => (
                <div key={stop.label} className="flex items-center justify-between gap-2 rounded-xl bg-secondary px-3 py-2">
                  <span className={`text-sm ${stop.done ? 'line-through text-muted-foreground' : 'font-medium'}`}>
                    {i + 1}. {stop.label}
                  </span>
                  {isHost && !stop.done ? (
                    <ProtoBtn variant="secondary" className="h-8 min-h-8 px-2 text-xs" onClick={() => dispatch({ type: 'markDrop', index: i })}>
                      Dropped
                    </ProtoBtn>
                  ) : null}
                </div>
              ))}
            </div>
            {isHost ? (
              <ProtoBtn className="mt-3 w-full" onClick={() => dispatch({ type: 'completeRide' })}>
                Complete ride
              </ProtoBtn>
            ) : (
              <p className="mt-3 text-sm text-muted-foreground">Following live. Message Arjun if needed.</p>
            )}
          </ProtoCard>

          <div className="grid grid-cols-2 gap-2">
            <ProtoBtn variant="secondary" onClick={() => dispatch({ type: 'createShare' })}>Share trip</ProtoBtn>
            <ProtoBtn variant="danger" onClick={() => dispatch({ type: 'setDemoHint', hint: 'SOS mock: contacts + admins notified; Call 112 stays separate.' })}>
              SOS
            </ProtoBtn>
            <ProtoBtn variant="secondary" onClick={() => dispatch({ type: 'setDemoHint', hint: 'VoIP call opens when LiveKit is configured; else Message fallback.' })}>
              Call
            </ProtoBtn>
            <ProtoBtn variant="ghost" onClick={() => dispatch({ type: 'setSheet', sheet: 'gps' })}>GPS issue</ProtoBtn>
          </div>
        </>
      )}

      {ride.status === 'completed' && (
        <ProtoCard>
          <p className="font-semibold">Trip complete</p>
          <p className="mt-1 text-sm text-muted-foreground">Rate · optional fuel · report if needed</p>
          <div className="mt-3 flex gap-2">
            <ProtoBtn
              className="flex-1"
              onClick={() => dispatch({ type: 'rate', who: state.perspective })}
            >
              {isGuest ? (ride.guestRated ? 'Rated ✓' : 'Rate host') : ride.hostRated ? 'Rated ✓' : 'Rate guest'}
            </ProtoBtn>
            {isGuest ? (
              <ProtoBtn
                variant="secondary"
                className="flex-1"
                disabled={!ride.fuelProposed || ride.fuelAccepted}
                onClick={() => dispatch({ type: 'acceptFuel' })}
              >
                {ride.fuelAccepted ? 'Fuel paid' : `Pay ₹${ride.fuelProposed || 60}`}
              </ProtoBtn>
            ) : (
              <ProtoBtn variant="secondary" className="flex-1" onClick={() => dispatch({ type: 'proposeFuel', amount: 60 })}>
                Fuel ₹{ride.fuelProposed || 60}
              </ProtoBtn>
            )}
          </div>
          <div className="mt-2 flex gap-2">
            <ProtoBtn variant="ghost" className="flex-1" onClick={() => dispatch({ type: 'dispute' })}>
              Report issue
            </ProtoBtn>
            <ProtoBtn variant="ghost" className="flex-1" onClick={() => dispatch({ type: 'setDemoHint', hint: 'Block partner is available after completed rides (Profile → Safety).' })}>
              Block
            </ProtoBtn>
          </div>
        </ProtoCard>
      )}

      <ProtoCard>
        <p className="mb-2 text-sm font-semibold">Chat</p>
        <div className="mb-3 max-h-36 space-y-2 overflow-y-auto">
          {ride.chat.map((m) => (
            <div key={m.id} className={`rounded-xl px-3 py-2 text-sm ${m.from === state.perspective ? 'ml-6 bg-emerald-50' : 'mr-6 bg-secondary'}`}>
              <p className="text-[10px] font-medium uppercase text-muted-foreground">{m.from}</p>
              {m.text}
            </div>
          ))}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {QUICK.map((q) => (
            <button
              key={q}
              type="button"
              className="rounded-full border border-border px-2.5 py-1 text-xs font-medium"
              onClick={() => dispatch({ type: 'sendChat', text: q })}
            >
              {q}
            </button>
          ))}
        </div>
      </ProtoCard>
    </ProtoPage>
  );
}
