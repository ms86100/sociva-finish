// @ts-nocheck
import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { CleanerCityChrome } from '@/components/cleaner-city/CleanerCityChrome';
import { CleanerCityGate } from '@/components/cleaner-city/CleanerCityGate';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  preferredRouteFromProfile,
  useCheckWorkEmailDomain,
  useCleanerCityProfile,
  useCleanerCityWorkVerification,
  useCommuteTemplates,
  useOfficeLocations,
  useUpsertCommuteProfile,
  useWorkEmailOtp,
} from '@/hooks/queries/useCleanerCity';
import { CleanerCityRouteSetupPanel } from '@/components/cleaner-city/CleanerCityRouteSetupPanel';
import {
  CLEANER_CITY_TRANSPORT,
  WORK_EMAIL_BADGE,
} from '@/lib/cleaner-city/constants';
import {
  getCleanerCityIntent,
  setCleanerCityIntent,
  type CleanerCityIntent,
} from '@/lib/cleaner-city/intent';
import { cn } from '@/lib/utils';
import { CheckCircle2 } from 'lucide-react';

type Step = 1 | 2 | 3 | 4;

/** Host choosers persist role=both so Find and Offer both work. */
function persistedRoleForIntent(intent: CleanerCityIntent): 'guest' | 'both' {
  return intent === 'guest' ? 'guest' : 'both';
}

const PATH_OPTIONS = [
  {
    intent: 'guest' as const,
    role: 'guest' as const,
    transport: 'looking',
    title: 'I need a seat',
    hint: 'Catch a ride with neighbours',
  },
  {
    intent: 'host' as const,
    role: 'both' as const,
    transport: 'car',
    title: 'I can offer seats',
    hint: 'Share empty seats on your drive',
  },
  {
    intent: 'both' as const,
    role: 'both' as const,
    transport: 'car',
    title: 'Both',
    hint: 'Find seats and offer them',
  },
] as const;

export default function CleanerCitySetupPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const arrivalState = (location.state as {
    notice?: string;
    intent?: CleanerCityIntent;
    step?: Step;
  } | null) || {};

  const { data: profile } = useCleanerCityProfile();
  const { data: verification } = useCleanerCityWorkVerification();
  const { data: offices = [] } = useOfficeLocations();
  const { data: templates = [] } = useCommuteTemplates();
  const upsert = useUpsertCommuteProfile();
  const { send, verify } = useWorkEmailOtp();

  const [intent, setIntent] = useState<CleanerCityIntent>(() => {
    return arrivalState.intent || getCleanerCityIntent() || 'guest';
  });
  const isGuestPath = intent === 'guest';
  const isHostPath = intent === 'host';

  const [step, setStep] = useState<Step>(1);
  const [role, setRole] = useState<'guest' | 'both'>(() =>
    persistedRoleForIntent(intent),
  );
  const [transport, setTransport] = useState(
    isGuestPath ? 'looking' : 'car',
  );
  const [companyName, setCompanyName] = useState('');
  const [email, setEmail] = useState('');
  const [otp, setOtp] = useState('');
  const [otpSent, setOtpSent] = useState(false);
  const [resendIn, setResendIn] = useState(0);
  const [paused, setPaused] = useState(false);

  const domainCheck = useCheckWorkEmailDomain(email);
  const verified = verification?.status === 'verified';

  useEffect(() => {
    const next = arrivalState.intent || getCleanerCityIntent();
    if (!next) return;
    setIntent(next);
    setCleanerCityIntent(next);
    setRole(persistedRoleForIntent(next));
    if (next === 'guest') {
      setTransport('looking');
    } else {
      setTransport((t) => (t === 'looking' ? 'car' : t));
    }
  }, [arrivalState.intent]);

  useEffect(() => {
    if (arrivalState.step && [1, 2, 3, 4].includes(arrivalState.step)) {
      setStep(arrivalState.step);
    }
  }, [arrivalState.step]);

  useEffect(() => {
    if (!profile) return;
    if (!arrivalState.intent && !getCleanerCityIntent()) {
      const nextIntent: CleanerCityIntent =
        profile.role === 'guest' ? 'guest' : profile.role === 'host' ? 'host' : 'both';
      setIntent(nextIntent);
      setRole(persistedRoleForIntent(nextIntent));
      setTransport(profile.transport_preference);
    }
    setCompanyName(profile.company_name || '');
    setPaused(!!profile.is_paused);
    if (arrivalState.step) return;
    if (profile && !verified) setStep(2);
    if (profile && verified) setStep(3);
  }, [profile, verified, arrivalState.intent, arrivalState.step]);

  useEffect(() => {
    if (verification?.email) setEmail(verification.email);
  }, [verification]);

  useEffect(() => {
    if (resendIn <= 0) return;
    const t = setTimeout(() => setResendIn((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [resendIn]);

  const emailLooksValid = useMemo(() => {
    const v = email.trim().toLowerCase();
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
  }, [email]);

  const canSendOtp =
    emailLooksValid && domainCheck.data?.ok === true && !send.isPending && resendIn === 0;

  const stepLabels = isGuestPath
    ? [
        { n: 1, label: 'Start' },
        { n: 2, label: 'Email' },
        { n: 3, label: 'Pins' },
        { n: 4, label: 'Go' },
      ]
    : isHostPath
      ? [
          { n: 1, label: 'Start' },
          { n: 2, label: 'Email' },
          { n: 3, label: 'Route' },
          { n: 4, label: 'Offer' },
        ]
      : [
          { n: 1, label: 'Start' },
          { n: 2, label: 'Email' },
          { n: 3, label: 'Route' },
          { n: 4, label: 'Go' },
        ];

  const choosePath = (next: (typeof PATH_OPTIONS)[number]) => {
    setIntent(next.intent);
    setRole(next.role);
    setTransport(next.transport);
    setCleanerCityIntent(next.intent);
  };

  const saveProfile = async () => {
    if (!role) {
      toast.error('Choose how you want to start');
      return;
    }
    const persistRole = persistedRoleForIntent(intent);
    try {
      await upsert.mutateAsync({
        role: persistRole,
        transport_preference: transport,
        company_name: companyName.trim() || null,
        is_paused: paused,
      });
      setRole(persistRole);
      setCleanerCityIntent(intent);
      toast.success(verified ? 'Saved' : 'Next - verify your work email');
      setStep(verified ? 3 : 2);
    } catch (e: any) {
      toast.error(e?.message || 'Could not save profile');
    }
  };

  const detectedCompany =
    domainCheck.data?.ok && domainCheck.data.company_name
      ? (() => {
          const raw = String(domainCheck.data.company_name).trim();
          if (!raw) return '';
          return raw.charAt(0).toUpperCase() + raw.slice(1);
        })()
      : '';

  useEffect(() => {
    if (detectedCompany) setCompanyName(detectedCompany);
  }, [detectedCompany]);

  const sendOtp = async () => {
    if (!emailLooksValid) {
      toast.error('Enter a valid work email');
      return;
    }
    if (domainCheck.data && domainCheck.data.ok === false) {
      toast.error(domainCheck.data.message);
      return;
    }
    try {
      await send.mutateAsync(email.trim().toLowerCase());
      setOtpSent(true);
      setResendIn(45);
      toast.success('Code sent to your work inbox');
    } catch (e: any) {
      toast.error(e?.message || 'Could not send code');
    }
  };

  const verifyOtp = async () => {
    if (otp.length !== 6) {
      toast.error('Enter the 6-digit code');
      return;
    }
    try {
      await verify.mutateAsync({ email: email.trim().toLowerCase(), code: otp });
      const derived =
        detectedCompany ||
        companyName.trim() ||
        (email.includes('@') ? email.split('@')[1]?.split('.')[0] : '') ||
        null;
      if (derived && profile) {
        try {
          const nextRole =
            profile.role === 'guest' || role === 'guest'
              ? persistedRoleForIntent(
                  (profile.role === 'guest' ? 'guest' : intent) as CleanerCityIntent,
                )
              : 'both';
          await upsert.mutateAsync({
            role: nextRole,
            transport_preference: profile.transport_preference || transport,
            company_name: derived,
            is_paused: paused,
          });
          setRole(nextRole);
          setCompanyName(derived);
        } catch {
          // Verification succeeded; company label can be fixed later.
        }
      }
      toast.success(WORK_EMAIL_BADGE);
      setOtp('');
      setOtpSent(false);
      setStep(3);
    } catch (e: any) {
      toast.error(e?.message || 'Invalid or expired code');
    }
  };

  const goFinish = () => setStep(4);

  const workWeekPickupDone = [1, 2, 3, 4, 5].every((day) => {
    const t = templates.find((row) => row.weekday === day);
    return typeof t?.pickup_latitude === 'number' && typeof t?.pickup_longitude === 'number';
  });
  const officeReady = offices.some(
    (o) => typeof o.latitude === 'number' && typeof o.longitude === 'number',
  );
  const roadsReady =
    !!preferredRouteFromProfile(profile, 'to_office') &&
    !!preferredRouteFromProfile(profile, 'to_home');
  const routeStepReady = isGuestPath
    ? workWeekPickupDone && officeReady
    : workWeekPickupDone && officeReady && roadsReady;

  const openHome = () => {
    setCleanerCityIntent(isGuestPath ? 'guest' : isHostPath ? 'host' : 'both');
    navigate(isHostPath ? '/cleaner-city/offer' : '/cleaner-city');
  };

  return (
    <CleanerCityChrome headerTitle="Get started">
      <CleanerCityGate>
        <div
          className="p-4 pb-24 space-y-5"
          data-testid="cleaner-city-setup"
          data-intent={intent}
        >
          <div>
            <h1 className="text-xl font-bold text-foreground">Start your commute</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Empty seats. Shared roads. Neighbours going your way.
            </p>
          </div>

          <div className="overflow-x-auto" data-testid="cleaner-city-setup-steps">
            <nav className="flex min-w-max gap-1 border-b border-border" aria-label="Setup steps">
              {stepLabels.map((s) => (
                <button
                  key={s.n}
                  type="button"
                  onClick={() => setStep(s.n as Step)}
                  className={cn(
                    'shrink-0 border-b-2 px-3 py-2.5 text-sm font-semibold transition-colors',
                    step === s.n
                      ? 'border-primary text-primary'
                      : 'border-transparent text-muted-foreground hover:text-foreground',
                  )}
                >
                  {s.label}
                </button>
              ))}
            </nav>
          </div>

          {step === 1 && (
            <section className="rounded-2xl border border-border bg-card p-4 space-y-4">
              <h2 className="text-sm font-semibold">How do you want to start?</h2>

              <div className="grid gap-2" data-testid="cleaner-city-setup-path-choice">
                {PATH_OPTIONS.map((option) => (
                  <button
                    key={option.intent}
                    type="button"
                    onClick={() => choosePath(option)}
                    className={cn(
                      'rounded-xl border px-3 py-3 text-left transition',
                      intent === option.intent
                        ? 'border-primary bg-primary/5'
                        : 'border-border hover:border-primary/40',
                    )}
                    data-testid={
                      option.intent === 'guest'
                        ? 'cleaner-city-setup-guest-locked'
                        : option.intent === 'host'
                          ? 'cleaner-city-setup-host-choice'
                          : 'cleaner-city-setup-both-choice'
                    }
                  >
                    <p className="text-sm font-extrabold text-foreground">{option.title}</p>
                    <p className="mt-0.5 text-[11px] text-muted-foreground">{option.hint}</p>
                  </button>
                ))}
              </div>

              {!isGuestPath ? (
                <div className="space-y-2">
                  <Label>I drive a</Label>
                  <div className="grid grid-cols-2 gap-2">
                    {CLEANER_CITY_TRANSPORT.filter((t) => t.value !== 'looking').map((item) => (
                      <button
                        key={item.value}
                        type="button"
                        onClick={() => setTransport(item.value)}
                        className={cn(
                          'rounded-xl border px-2 py-2 text-xs font-semibold',
                          transport === item.value
                            ? 'border-primary bg-primary/5'
                            : 'border-border',
                        )}
                      >
                        {item.label}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}

              {verified ? (
                <label className="flex items-center gap-2 text-xs text-muted-foreground">
                  <input
                    type="checkbox"
                    checked={paused}
                    onChange={(e) => setPaused(e.target.checked)}
                  />
                  Pause commute visibility
                </label>
              ) : null}

              <Button
                onClick={saveProfile}
                disabled={upsert.isPending}
                className="w-full h-12 font-semibold"
                data-testid="cleaner-city-setup-save-profile"
              >
                {upsert.isPending ? 'Saving...' : verified ? 'Continue' : 'Continue'}
              </Button>
            </section>
          )}

          {step === 2 && (
            <section className="rounded-2xl border border-border bg-card p-4 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-sm font-semibold">Work email</h2>
                {verified ? (
                  <span className="text-[11px] font-bold text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/40 px-2 py-1 rounded-full">
                    {WORK_EMAIL_BADGE}
                  </span>
                ) : null}
              </div>
              <p className="text-xs text-muted-foreground">
                Use your company email. Gmail and personal inboxes are not allowed.
              </p>

              {!profile ? (
                <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-950 dark:text-amber-100">
                  Choose how you start in the first step, then come back here.
                </div>
              ) : null}

              <div className="space-y-2">
                <Label htmlFor="cc-email">Work email</Label>
                <Input
                  id="cc-email"
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => {
                    setEmail(e.target.value);
                    setOtpSent(false);
                    setOtp('');
                  }}
                  placeholder="name@company.com"
                  disabled={verified && !otpSent}
                  data-testid="cleaner-city-setup-email"
                />
                {emailLooksValid && domainCheck.data?.ok && detectedCompany ? (
                  <div
                    className="flex items-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-50 dark:bg-emerald-950/40 px-3 py-2"
                    data-testid="cleaner-city-domain-check"
                  >
                    <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-700 dark:text-emerald-300" />
                    <p className="text-[12px] font-extrabold text-emerald-800 dark:text-emerald-300">
                      {detectedCompany}
                    </p>
                  </div>
                ) : null}
                {emailLooksValid && domainCheck.data && !domainCheck.data.ok ? (
                  <p className="text-[11px] text-amber-800 dark:text-amber-200" data-testid="cleaner-city-domain-check">
                    {domainCheck.data.message}
                  </p>
                ) : null}
              </div>

              {!otpSent ? (
                <Button
                  onClick={sendOtp}
                  disabled={!canSendOtp || !profile}
                  className="w-full h-12 font-semibold"
                  data-testid="cleaner-city-setup-send-otp"
                >
                  {send.isPending ? 'Sending...' : 'Send code'}
                </Button>
              ) : (
                <div className="space-y-2">
                  <Label htmlFor="cc-otp">6-digit code</Label>
                  <Input
                    id="cc-otp"
                    inputMode="numeric"
                    maxLength={6}
                    value={otp}
                    onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    placeholder="123456"
                    data-testid="cleaner-city-setup-otp"
                  />
                  <div className="flex gap-2">
                    <Button
                      onClick={verifyOtp}
                      disabled={verify.isPending || otp.length !== 6}
                      className="flex-1 h-11 font-semibold"
                    >
                      {verify.isPending ? 'Verifying...' : 'Verify'}
                    </Button>
                    <Button
                      variant="ghost"
                      onClick={sendOtp}
                      disabled={send.isPending || resendIn > 0}
                    >
                      {resendIn > 0 ? `Resend ${resendIn}s` : 'Resend'}
                    </Button>
                  </div>
                </div>
              )}

              {verified ? (
                <Button variant="link" className="px-0 h-auto text-xs" onClick={() => setStep(3)}>
                  Continue
                </Button>
              ) : null}
            </section>
          )}

          {step === 3 && (
            <section className="space-y-3" data-testid="cleaner-city-setup-route-step">
              {!verified ? (
                <div className="rounded-2xl border border-border bg-card p-4">
                  <h2 className="text-sm font-semibold">Set your places</h2>
                  <p className="mt-2 text-sm text-muted-foreground">Verify work email first.</p>
                </div>
              ) : (
                <>
                  <CleanerCityRouteSetupPanel compact pinsOnly={isGuestPath} />
                  {routeStepReady ? (
                    <Button
                      className="w-full h-12 font-semibold"
                      onClick={goFinish}
                      data-testid="cleaner-city-setup-route-continue"
                    >
                      Next
                    </Button>
                  ) : (
                    <p className="text-center text-xs text-muted-foreground">
                      {isGuestPath
                        ? 'Save home and office to continue.'
                        : 'Save home, office, and both roads to continue.'}
                    </p>
                  )}
                </>
              )}
            </section>
          )}

          {step === 4 && (
            <section
              className="rounded-2xl border border-border bg-card p-4 space-y-3"
              data-testid="cleaner-city-setup-done"
            >
              <h2 className="text-sm font-semibold">You are ready</h2>
              {!verified ? (
                <p className="text-sm text-muted-foreground">Verify work email to continue.</p>
              ) : isGuestPath ? (
                <>
                  <p className="text-sm text-muted-foreground">
                    Find seats on your corridor. Optional: set leave times or an emergency contact.
                  </p>
                  <div className="grid gap-2">
                    <Link
                      to="/cleaner-city/schedule"
                      state={{ from: '/cleaner-city/setup' }}
                      className="rounded-xl border border-border px-3 py-3 text-sm font-semibold"
                      data-testid="cleaner-city-setup-guest-schedule"
                    >
                      Set leave times
                    </Link>
                    <Link
                      to="/cleaner-city/safety"
                      className="rounded-xl border border-border px-3 py-3 text-sm font-semibold"
                      data-testid="cleaner-city-setup-guest-safety"
                    >
                      Add emergency contact
                    </Link>
                    <Button
                      className="h-12 w-full font-semibold"
                      onClick={openHome}
                      data-testid="cleaner-city-setup-guest-find-cta"
                    >
                      Find a seat
                    </Button>
                  </div>
                </>
              ) : (
                <>
                  <p className="text-sm text-muted-foreground">
                    {isHostPath
                      ? 'Add a vehicle and leave times. You can offer seats and find seats.'
                      : 'Find a seat or offer empty ones whenever you drive.'}
                  </p>
                  <div className="grid gap-2">
                    <Link
                      to="/cleaner-city/schedule"
                      state={{ from: '/cleaner-city/setup' }}
                      className="rounded-xl border border-border px-3 py-3 text-sm font-semibold"
                    >
                      Set leave times
                    </Link>
                    {role === 'both' && (
                      <Link
                        to="/cleaner-city/vehicle"
                        className="rounded-xl border border-border px-3 py-3 text-sm font-semibold"
                        data-testid="cleaner-city-setup-host-vehicle"
                      >
                        Add vehicle
                      </Link>
                    )}
                    {role === 'both' && (
                      <Button
                        className="h-12 w-full font-semibold"
                        onClick={() => {
                          setCleanerCityIntent(isHostPath ? 'host' : 'both');
                          navigate('/cleaner-city/offer');
                        }}
                        data-testid="cleaner-city-setup-host-offer-cta"
                      >
                        Offer seats
                      </Button>
                    )}
                    <Button
                      variant={role === 'both' ? 'outline' : 'default'}
                      className="h-12 w-full font-semibold"
                      onClick={() => {
                        setCleanerCityIntent('guest');
                        navigate('/cleaner-city');
                      }}
                      data-testid="cleaner-city-setup-find-cta"
                    >
                      Find a seat
                    </Button>
                  </div>
                </>
              )}
            </section>
          )}
        </div>
      </CleanerCityGate>
    </CleanerCityChrome>
  );
}
