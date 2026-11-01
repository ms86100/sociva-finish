// @ts-nocheck
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { AppLayout } from '@/components/layout/AppLayout';
import { CleanerCityGate } from '@/components/cleaner-city/CleanerCityGate';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  useCleanerCityProfile,
  useCleanerCityWorkVerification,
  useUpsertCommuteProfile,
  useWorkEmailOtp,
} from '@/hooks/queries/useCleanerCity';
import {
  CLEANER_CITY_ROLES,
  CLEANER_CITY_TRANSPORT,
  WORK_EMAIL_BADGE,
} from '@/lib/cleaner-city/constants';
import { cn } from '@/lib/utils';

export default function CleanerCitySetupPage() {
  const { data: profile } = useCleanerCityProfile();
  const { data: verification } = useCleanerCityWorkVerification();
  const upsert = useUpsertCommuteProfile();
  const { send, verify } = useWorkEmailOtp();

  const [role, setRole] = useState('both');
  const [transport, setTransport] = useState('looking');
  const [companyName, setCompanyName] = useState('');
  const [email, setEmail] = useState('');
  const [otp, setOtp] = useState('');
  const [otpSent, setOtpSent] = useState(false);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    if (!profile) return;
    setRole(profile.role);
    setTransport(profile.transport_preference);
    setCompanyName(profile.company_name || '');
    setPaused(!!profile.is_paused);
  }, [profile]);

  useEffect(() => {
    if (verification?.email) setEmail(verification.email);
  }, [verification]);

  const saveProfile = async () => {
    try {
      await upsert.mutateAsync({
        role,
        transport_preference: transport,
        company_name: companyName,
        is_paused: paused,
      });
      toast.success('Commute profile saved');
    } catch (e: any) {
      toast.error(e?.message || 'Could not save profile');
    }
  };

  const sendOtp = async () => {
    try {
      await send.mutateAsync(email);
      setOtpSent(true);
      toast.success('Code sent to your work email');
    } catch (e: any) {
      toast.error(e?.message || 'Could not send code');
    }
  };

  const verifyOtp = async () => {
    try {
      await verify.mutateAsync({ email, code: otp });
      toast.success(WORK_EMAIL_BADGE);
      setOtp('');
      setOtpSent(false);
    } catch (e: any) {
      toast.error(e?.message || 'Invalid or expired code');
    }
  };

  return (
    <AppLayout headerTitle="Set up commute">
      <CleanerCityGate>
        <div className="p-4 pb-24 space-y-5" data-testid="cleaner-city-setup">
          <div>
            <h1 className="text-xl font-bold text-foreground">Register your commute</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Work email must be on an approved corporate domain. Badge: {WORK_EMAIL_BADGE}.
            </p>
          </div>

          <section className="rounded-2xl border border-border bg-card p-4 space-y-3">
            <h2 className="text-sm font-semibold">Commute profile</h2>
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
              <Label htmlFor="cc-company">Company</Label>
              <Input
                id="cc-company"
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
                placeholder="e.g. Airbus"
              />
            </div>
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <input
                type="checkbox"
                checked={paused}
                onChange={(e) => setPaused(e.target.checked)}
              />
              Pause commute visibility
            </label>
            <Button onClick={saveProfile} disabled={upsert.isPending} className="w-full">
              {upsert.isPending ? 'Saving...' : 'Save commute profile'}
            </Button>
          </section>

          <section className="rounded-2xl border border-border bg-card p-4 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-sm font-semibold">Official work email</h2>
              {verification?.status === 'verified' && (
                <span className="text-[11px] font-bold text-emerald-700 bg-emerald-50 px-2 py-1 rounded-full">
                  {WORK_EMAIL_BADGE}
                </span>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              Only approved corporate domains. Personal Gmail and similar addresses are rejected.
            </p>
            <div className="space-y-2">
              <Label htmlFor="cc-email">Work email</Label>
              <Input
                id="cc-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="name@company.com"
                disabled={verification?.status === 'verified' && !otpSent}
              />
            </div>
            {!otpSent ? (
              <Button
                variant="outline"
                onClick={sendOtp}
                disabled={send.isPending || !email}
                className="w-full"
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
                />
                <div className="flex gap-2">
                  <Button onClick={verifyOtp} disabled={verify.isPending || otp.length !== 6} className="flex-1">
                    {verify.isPending ? 'Verifying...' : 'Verify'}
                  </Button>
                  <Button variant="ghost" onClick={sendOtp} disabled={send.isPending}>
                    Resend
                  </Button>
                </div>
              </div>
            )}
            {verification?.status === 'verified' && (
              <Button variant="link" className="px-0 h-auto text-xs" onClick={() => setOtpSent(true)}>
                Re-verify a different work email
              </Button>
            )}
          </section>

          <Link to="/cleaner-city" className="block text-center text-sm text-primary font-semibold">
            Back to A Cleaner City
          </Link>
        </div>
      </CleanerCityGate>
    </AppLayout>
  );
}
