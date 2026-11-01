// @ts-nocheck
import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { toast } from 'sonner';
import { AppLayout } from '@/components/layout/AppLayout';
import { CleanerCityGate } from '@/components/cleaner-city/CleanerCityGate';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  useApprovedCompanyDomains,
  useCheckWorkEmailDomain,
  useCleanerCityProfile,
  useCleanerCityWorkVerification,
  useRequestCompanyDomain,
  useUpsertCommuteProfile,
  useWorkEmailOtp,
} from '@/hooks/queries/useCleanerCity';
import {
  CLEANER_CITY_ROLES,
  CLEANER_CITY_TRANSPORT,
  WORK_EMAIL_BADGE,
} from '@/lib/cleaner-city/constants';
import { cn } from '@/lib/utils';

type Step = 1 | 2 | 3;

export default function CleanerCitySetupPage() {
  const { data: profile } = useCleanerCityProfile();
  const { data: verification } = useCleanerCityWorkVerification();
  const { data: approvedDomains = [] } = useApprovedCompanyDomains();
  const upsert = useUpsertCommuteProfile();
  const requestDomain = useRequestCompanyDomain();
  const { send, verify } = useWorkEmailOtp();

  const [step, setStep] = useState<Step>(1);
  const [role, setRole] = useState('both');
  const [transport, setTransport] = useState('looking');
  const [companyName, setCompanyName] = useState('');
  const [email, setEmail] = useState('');
  const [otp, setOtp] = useState('');
  const [otpSent, setOtpSent] = useState(false);
  const [resendIn, setResendIn] = useState(0);
  const [requestDomainName, setRequestDomainName] = useState('');
  const [requestCompany, setRequestCompany] = useState('');
  const [showRequestForm, setShowRequestForm] = useState(false);
  const [paused, setPaused] = useState(false);

  const domainCheck = useCheckWorkEmailDomain(email);
  const location = useLocation();
  const arrivalNotice = (location.state as { notice?: string } | null)?.notice || '';
  const verified = verification?.status === 'verified';

  useEffect(() => {
    if (!profile) return;
    setRole(profile.role);
    setTransport(profile.transport_preference);
    setCompanyName(profile.company_name || '');
    setPaused(!!profile.is_paused);
    if (profile && !verified) setStep(2);
    if (profile && verified) setStep(3);
  }, [profile, verified]);

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

  const saveProfile = async () => {
    if (!role) {
      toast.error('Choose how you want to use Cleaner City');
      return;
    }
    try {
      await upsert.mutateAsync({
        role,
        transport_preference: transport,
        company_name: companyName.trim() || null,
        is_paused: paused,
      });
      toast.success('Profile saved');
      setStep(verified ? 3 : 2);
    } catch (e: any) {
      toast.error(e?.message || 'Could not save profile');
    }
  };

  const sendOtp = async () => {
    if (!emailLooksValid) {
      toast.error('Enter a valid work email');
      return;
    }
    if (domainCheck.data && domainCheck.data.ok === false) {
      toast.error(domainCheck.data.message);
      if (domainCheck.data.code === 'domain_not_approved') setShowRequestForm(true);
      return;
    }
    try {
      await send.mutateAsync(email.trim().toLowerCase());
      setOtpSent(true);
      setResendIn(45);
      toast.success('Code sent - check your work inbox (and spam)');
    } catch (e: any) {
      const msg = e?.message || 'Could not send code';
      toast.error(msg);
      if (/not approved|request approval/i.test(msg)) setShowRequestForm(true);
    }
  };

  const verifyOtp = async () => {
    if (otp.length !== 6) {
      toast.error('Enter the 6-digit code');
      return;
    }
    try {
      await verify.mutateAsync({ email: email.trim().toLowerCase(), code: otp });
      toast.success(WORK_EMAIL_BADGE);
      setOtp('');
      setOtpSent(false);
      setStep(3);
    } catch (e: any) {
      toast.error(e?.message || 'Invalid or expired code');
    }
  };

  const submitDomainRequest = async () => {
    const domain =
      requestDomainName.trim().toLowerCase() ||
      (email.includes('@') ? email.split('@')[1] : '');
    if (!domain) {
      toast.error('Enter your company domain (example.com)');
      return;
    }
    try {
      const row = await requestDomain.mutateAsync({
        domain,
        company_name: requestCompany.trim() || companyName.trim() || domain,
      });
      toast.success(
        row?.status === 'approved'
          ? 'Domain already approved - send a code now'
          : 'Domain request sent to admin for approval',
      );
      setShowRequestForm(false);
    } catch (e: any) {
      toast.error(e?.message || 'Could not request domain');
    }
  };

  return (
    <AppLayout headerTitle="Set up commute">
      <CleanerCityGate>
        <div className="p-4 pb-24 space-y-5" data-testid="cleaner-city-setup">
          {arrivalNotice && (
            <div className="rounded-2xl border border-primary/30 bg-primary/5 p-4 text-sm">
              {arrivalNotice}
            </div>
          )}
          <div>
            <h1 className="text-xl font-bold text-foreground">Get ready to commute</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Three short steps. Work email must be on an approved company domain.
            </p>
          </div>

          <div className="flex gap-2" data-testid="cleaner-city-setup-steps">
            {[
              { n: 1, label: 'Profile' },
              { n: 2, label: 'Work email' },
              { n: 3, label: 'Next' },
            ].map((s) => (
              <button
                key={s.n}
                type="button"
                onClick={() => setStep(s.n as Step)}
                className={cn(
                  'flex-1 rounded-xl border px-2 py-2 text-center',
                  step === s.n
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'border-border text-muted-foreground',
                )}
              >
                <p className="text-[10px] font-bold uppercase tracking-wide">Step {s.n}</p>
                <p className="text-xs font-semibold">{s.label}</p>
              </button>
            ))}
          </div>

          {step === 1 && (
            <section className="rounded-2xl border border-border bg-card p-4 space-y-3">
              <h2 className="text-sm font-semibold">1. How will you use Cleaner City?</h2>
              <div className="space-y-2">
                <Label>Role</Label>
                <div className="grid grid-cols-3 gap-2">
                  {CLEANER_CITY_ROLES.map((item) => (
                    <button
                      key={item.value}
                      type="button"
                      onClick={() => setRole(item.value)}
                      className={cn(
                        'rounded-xl border px-2 py-2 text-left',
                        role === item.value ? 'border-primary bg-primary/5' : 'border-border',
                      )}
                    >
                      <p className="text-xs font-semibold">{item.label}</p>
                      <p className="text-[10px] text-muted-foreground">{item.hint}</p>
                    </button>
                  ))}
                </div>
              </div>
              <div className="space-y-2">
                <Label>Transport</Label>
                <div className="grid grid-cols-3 gap-2">
                  {CLEANER_CITY_TRANSPORT.map((item) => (
                    <button
                      key={item.value}
                      type="button"
                      onClick={() => setTransport(item.value)}
                      className={cn(
                        'rounded-xl border px-2 py-2 text-xs font-semibold',
                        transport === item.value ? 'border-primary bg-primary/5' : 'border-border',
                      )}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="cc-company">Company name (optional)</Label>
                <Input
                  id="cc-company"
                  value={companyName}
                  onChange={(e) => setCompanyName(e.target.value)}
                  placeholder="e.g. Airbus"
                />
              </div>
              {verified && (
                <label className="flex items-center gap-2 text-xs text-muted-foreground">
                  <input
                    type="checkbox"
                    checked={paused}
                    onChange={(e) => setPaused(e.target.checked)}
                  />
                  Pause commute visibility
                </label>
              )}
              <Button
                onClick={saveProfile}
                disabled={upsert.isPending}
                className="w-full"
                data-testid="cleaner-city-setup-save-profile"
              >
                {upsert.isPending ? 'Saving...' : verified ? 'Save and continue' : 'Save and verify email'}
              </Button>
            </section>
          )}

          {step === 2 && (
            <section className="rounded-2xl border border-border bg-card p-4 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-sm font-semibold">2. Verify work email</h2>
                {verified && (
                  <span className="text-[11px] font-bold text-emerald-700 bg-emerald-50 px-2 py-1 rounded-full">
                    {WORK_EMAIL_BADGE}
                  </span>
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                Only approved corporate domains. Personal Gmail and similar addresses are rejected.
              </p>

              {approvedDomains.length > 0 && (
                <div className="rounded-xl bg-muted/50 p-3 space-y-2">
                  <p className="text-[11px] font-semibold text-foreground">Approved companies</p>
                  <div className="flex flex-wrap gap-1.5">
                    {approvedDomains.map((d) => (
                      <span
                        key={d.domain}
                        className="rounded-full bg-background border border-border px-2 py-0.5 text-[10px] font-medium"
                      >
                        {d.company_name} · @{d.domain}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {!profile && (
                <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-950">
                  Save your commute profile in Step 1 first, then verify email.
                </div>
              )}

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
                {emailLooksValid && domainCheck.data && (
                  <p
                    className={cn(
                      'text-[11px]',
                      domainCheck.data.ok ? 'text-emerald-700' : 'text-amber-800',
                    )}
                    data-testid="cleaner-city-domain-check"
                  >
                    {domainCheck.data.message}
                  </p>
                )}
              </div>

              {!otpSent ? (
                <Button
                  onClick={sendOtp}
                  disabled={!canSendOtp || !profile}
                  className="w-full"
                  data-testid="cleaner-city-setup-send-otp"
                >
                  {send.isPending ? 'Sending...' : 'Send verification code'}
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
                      className="flex-1"
                    >
                      {verify.isPending ? 'Verifying...' : 'Verify code'}
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

              {(showRequestForm || domainCheck.data?.code === 'domain_not_approved') && (
                <div className="rounded-xl border border-border p-3 space-y-2">
                  <p className="text-xs font-semibold">Request your company domain</p>
                  <p className="text-[11px] text-muted-foreground">
                    Admin must approve before you can verify. You can keep browsing once approved.
                  </p>
                  <Input
                    placeholder="company.com"
                    value={
                      requestDomainName ||
                      (showRequestForm && email.includes('@') ? email.split('@')[1] : '')
                    }
                    onChange={(e) => setRequestDomainName(e.target.value)}
                  />
                  <Input
                    placeholder="Company name"
                    value={requestCompany || companyName}
                    onChange={(e) => setRequestCompany(e.target.value)}
                  />
                  <Button
                    variant="outline"
                    className="w-full"
                    disabled={requestDomain.isPending}
                    onClick={submitDomainRequest}
                  >
                    {requestDomain.isPending ? 'Sending request...' : 'Request domain approval'}
                  </Button>
                </div>
              )}

              {!showRequestForm && domainCheck.data?.code !== 'domain_not_approved' && (
                <button
                  type="button"
                  className="text-xs text-primary font-semibold"
                  onClick={() => setShowRequestForm(true)}
                >
                  My company is not listed - request approval
                </button>
              )}

              {verified && (
                <Button variant="link" className="px-0 h-auto text-xs" onClick={() => setStep(3)}>
                  Continue to next steps
                </Button>
              )}
            </section>
          )}

          {step === 3 && (
            <section className="rounded-2xl border border-border bg-card p-4 space-y-3">
              <h2 className="text-sm font-semibold">3. Finish setup</h2>
              {!verified ? (
                <p className="text-sm text-muted-foreground">
                  Verify your work email in Step 2 before offering or finding rides.
                </p>
              ) : (
                <>
                  <p className="text-sm text-muted-foreground">
                    You are verified. Add your office pin and schedule so matching works.
                  </p>
                  <div className="grid gap-2">
                    <Link
                      to="/cleaner-city/route"
                      className="rounded-xl border border-border px-3 py-3 text-sm font-semibold"
                    >
                      Set office and pickup pins
                    </Link>
                    <Link
                      to="/cleaner-city/schedule"
                      className="rounded-xl border border-border px-3 py-3 text-sm font-semibold"
                    >
                      Set weekly schedule
                    </Link>
                    {(role === 'host' || role === 'both') && (
                      <Link
                        to="/cleaner-city/vehicle"
                        className="rounded-xl border border-border px-3 py-3 text-sm font-semibold"
                      >
                        Add vehicle
                      </Link>
                    )}
                    <Link
                      to="/cleaner-city"
                      className="rounded-xl bg-primary px-3 py-3 text-sm font-semibold text-primary-foreground text-center"
                    >
                      Go to A Cleaner City home
                    </Link>
                  </div>
                </>
              )}
            </section>
          )}

          <Link to="/cleaner-city" className="block text-center text-sm text-primary font-semibold">
            Back to A Cleaner City
          </Link>
        </div>
      </CleanerCityGate>
    </AppLayout>
  );
}
