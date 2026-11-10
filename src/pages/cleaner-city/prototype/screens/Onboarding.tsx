import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useProto } from '../store';
import { MapPlane, ProtoBtn, ProtoHero, ProtoPage, Segmented } from '../ui';
import type { CommuteMode, OnboardingStep } from '../types';

const STEPS: OnboardingStep[] = ['welcome', 'intent', 'email', 'pins', 'schedule'];

export function OnboardingScreen() {
  const { state, dispatch } = useProto();
  const navigate = useNavigate();
  const step = state.onboardingStep === 'done' ? 'schedule' : state.onboardingStep;
  const idx = Math.max(0, STEPS.indexOf(step));

  useEffect(() => {
    if (state.onboardingComplete) {
      navigate('/cleaner-city/prototype', { replace: true });
    }
  }, [state.onboardingComplete, navigate]);

  const go = (next: OnboardingStep) => dispatch({ type: 'setOnboardingStep', step: next });

  const finish = (mode: CommuteMode) => {
    dispatch({ type: 'completeOnboarding', mode });
  };

  return (
    <ProtoPage>
      <div className="flex gap-1.5">
        {STEPS.map((s, i) => (
          <div
            key={s}
            className={`h-1.5 flex-1 rounded-full ${i <= idx ? 'bg-emerald-700' : 'bg-secondary'}`}
          />
        ))}
      </div>

      {step === 'welcome' && (
        <>
          <ProtoHero
            title="A Cleaner City"
            subtitle="Share the road with neighbours who already drive your corridor. Not a taxi - a connected commute."
          />
          <ul className="space-y-2 text-sm text-muted-foreground">
            <li>One profile. Offer a seat or find a seat any day.</li>
            <li>Work email builds trust. Safety stays one tap away.</li>
            <li>Road-based matching - meet, ride, done.</li>
          </ul>
          <ProtoBtn className="w-full" onClick={() => go('intent')}>
            Get started
          </ProtoBtn>
        </>
      )}

      {step === 'intent' && (
        <>
          <h2 className="text-xl font-semibold tracking-tight">How do you want to commute today?</h2>
          <p className="text-sm text-muted-foreground">You can switch anytime. This is not a permanent label.</p>
          <button
            type="button"
            className="rounded-2xl border border-border bg-card p-4 text-left shadow-sm"
            onClick={() => {
              dispatch({ type: 'setMode', mode: 'find' });
              go('email');
            }}
          >
            <p className="font-semibold">I need a seat</p>
            <p className="text-sm text-muted-foreground">Find neighbours heading your way.</p>
          </button>
          <button
            type="button"
            className="rounded-2xl border border-border bg-card p-4 text-left shadow-sm"
            onClick={() => {
              dispatch({ type: 'setMode', mode: 'offer' });
              go('email');
            }}
          >
            <p className="font-semibold">I drive and can share seats</p>
            <p className="text-sm text-muted-foreground">Offer empty seats on your usual road.</p>
          </button>
        </>
      )}

      {step === 'email' && (
        <>
          <h2 className="text-xl font-semibold tracking-tight">Verify your work email</h2>
          <p className="text-sm text-muted-foreground">Official domain only. This is trust, not employment proof.</p>
          <div className="rounded-2xl border border-border bg-card p-4">
            <label className="text-xs font-medium text-muted-foreground">Work email</label>
            <input
              className="mt-1 w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm"
              defaultValue="priya.mehta@infosys.com"
              readOnly
            />
            <label className="mt-3 block text-xs font-medium text-muted-foreground">6-digit code</label>
            <input
              className="mt-1 w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm tracking-[0.3em]"
              defaultValue="194827"
              readOnly
            />
          </div>
          <ProtoBtn className="w-full" onClick={() => go('pins')}>
            Verify and continue
          </ProtoBtn>
        </>
      )}

      {step === 'pins' && (
        <>
          <h2 className="text-xl font-semibold tracking-tight">Home and office corridor</h2>
          <p className="text-sm text-muted-foreground">Exact office stays private. Matching uses the road, not your desk.</p>
          <MapPlane label="Greenfield Tower H → Manyata Tech Park" meta="Outer Ring Rd · ~34 min typical" />
          <ProtoBtn className="w-full" onClick={() => go('schedule')}>
            Looks right
          </ProtoBtn>
        </>
      )}

      {step === 'schedule' && (
        <>
          <h2 className="text-xl font-semibold tracking-tight">Usual leave times</h2>
          <p className="text-sm text-muted-foreground">We will default Find and Offer to these. Edit anytime in Profile.</p>
          <div className="rounded-2xl border border-border bg-card p-4 space-y-3">
            <div className="flex items-center justify-between text-sm">
              <span>Weekdays</span>
              <span className="font-semibold">Mon - Fri</span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span>Leave home</span>
              <span className="font-semibold">08:40</span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span>Leave office</span>
              <span className="font-semibold">18:20</span>
            </div>
            <Segmented
              value={state.preferredMode}
              options={[
                { id: 'find', label: 'Prefer Find' },
                { id: 'offer', label: 'Prefer Offer' },
              ]}
              onChange={(id) => dispatch({ type: 'setMode', mode: id as CommuteMode })}
            />
          </div>
          <ProtoBtn className="w-full" onClick={() => finish(state.preferredMode)}>
            Open my commute home
          </ProtoBtn>
        </>
      )}
    </ProtoPage>
  );
}
