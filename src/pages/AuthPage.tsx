// @ts-nocheck
import { useEffect, useRef, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ArrowRight, Loader2, CheckCircle2, Search, MapPin, Building2, Plus, ArrowLeft, ShieldCheck, Sparkles, Home, Phone, RefreshCw } from 'lucide-react';
import { Checkbox } from '@/components/ui/checkbox';
import { InputOTP, InputOTPGroup, InputOTPSlot, InputOTPSeparator } from '@/components/ui/input-otp';
import { motion, AnimatePresence } from 'framer-motion';
import authHero from '@/assets/auth-hero.jpg';
import { useAuthPage } from '@/hooks/useAuthPage';

// ─── OTP Step with keyboard-aware scrolling ─────────────────────────────
function OtpStep({ auth }: { auth: ReturnType<typeof useAuthPage> }) {
  const otpContainerRef = useRef<HTMLDivElement>(null);
  const hasAutoSubmitted = useRef(false);

  useEffect(() => {
    const scrollOtpIntoView = () => {
      otpContainerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    };
    const initialTimer = setTimeout(scrollOtpIntoView, 350);
    const vv = window.visualViewport;
    if (vv) {
      const handleResize = () => setTimeout(scrollOtpIntoView, 100);
      vv.addEventListener('resize', handleResize);
      return () => { clearTimeout(initialTimer); vv.removeEventListener('resize', handleResize); };
    }
    return () => clearTimeout(initialTimer);
  }, []);

  // Auto-verify when all 4 digits are filled (handles autofill & manual entry)
  useEffect(() => {
    const canVerify =
      auth.otp.length === 4 &&
      !!auth.otpReqId &&
      !auth.isSendingOtp &&
      !auth.isVerifyingOtp;
    if (canVerify && !hasAutoSubmitted.current) {
      hasAutoSubmitted.current = true;
      auth.handleVerifyOtp();
      return;
    }
    // Only allow a fresh auto-submit after the user edits the OTP again
    if (auth.otp.length < 4) {
      hasAutoSubmitted.current = false;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- handleVerifyOtp is stable enough via loading gate
  }, [auth.otp, auth.otpReqId, auth.isSendingOtp, auth.isVerifyingOtp]);

  const verifyDisabled =
    auth.otp.length < 4 || !auth.otpReqId || auth.isVerifyingOtp;

  return (
    <motion.div key="otp" initial={{ opacity: 0, x: 30 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -30 }} transition={{ duration: 0.25 }} className="space-y-5 pb-48">
      <div className="text-center space-y-1">
        <p className="text-sm text-muted-foreground">
          {auth.isSendingOtp && !auth.otpReqId ? 'Sending OTP to' : 'OTP sent to'}
        </p>
        <p className="text-base font-semibold text-foreground">{auth.settings.defaultCountryCode} {auth.phone}</p>
        {auth.isSendingOtp && !auth.otpReqId && (
          <p className="text-xs text-muted-foreground inline-flex items-center gap-1.5 pt-1">
            <Loader2 className="animate-spin" size={12} /> Sending…
          </p>
        )}
      </div>
      <div ref={otpContainerRef} className="flex justify-center" style={{ scrollMarginBottom: '280px' }}>
        <InputOTP
          maxLength={4}
          value={auth.otp}
          onChange={(value) => {
            auth.setOtpError(null);
            auth.setOtp(value);
          }}
          autoFocus
        >
          <InputOTPGroup className="gap-3">
            <InputOTPSlot index={0} className="w-14 h-14 text-2xl font-semibold rounded-xl border-2" />
            <InputOTPSlot index={1} className="w-14 h-14 text-2xl font-semibold rounded-xl border-2" />
            <InputOTPSlot index={2} className="w-14 h-14 text-2xl font-semibold rounded-xl border-2" />
            <InputOTPSlot index={3} className="w-14 h-14 text-2xl font-semibold rounded-xl border-2" />
          </InputOTPGroup>
        </InputOTP>
      </div>
      {auth.otpError && (
        <p role="alert" className="text-sm text-destructive text-center font-medium px-2">
          {auth.otpError}
        </p>
      )}
      <Button onClick={auth.handleVerifyOtp} disabled={verifyDisabled} className="w-full h-12 rounded-xl text-base font-semibold">
        {auth.isVerifyingOtp ? <Loader2 className="animate-spin mr-2" size={18} /> : <CheckCircle2 className="mr-2" size={18} />}
        {auth.isSendingOtp && !auth.otpReqId ? 'Waiting for OTP…' : 'Verify & Continue'}
      </Button>
      <div className="flex items-center justify-between">
        <button type="button" onClick={() => { auth.setStep('phone'); auth.setOtp(''); auth.setOtpReqId(null); auth.setOtpError(null); }} className="text-xs text-muted-foreground hover:text-foreground transition-colors inline-flex items-center gap-1">
          <ArrowLeft size={12} /> Change number
        </button>
        <div>
          {auth.resendCooldown > 0 ? (
            <p className="text-xs text-muted-foreground">Resend in <span className="font-semibold text-primary">{auth.resendCooldown}s</span></p>
          ) : (
            <button type="button" onClick={() => auth.handleSendOtp(true)} disabled={auth.isSendingOtp || auth.isVerifyingOtp || !auth.otpReqId} className="text-xs text-primary font-medium hover:underline inline-flex items-center gap-1">
              <RefreshCw size={12} /> Resend OTP
            </button>
          )}
        </div>
      </div>
    </motion.div>
  );
}

export default function AuthPage() {
  const auth = useAuthPage();

  return (
    <div className="min-h-[100dvh] bg-gradient-to-b from-background to-secondary/20 overflow-y-auto safe-top">
      {/* Hero Banner */}
      <div className="relative h-28 sm:h-40 md:h-56 overflow-hidden">
        <img src={authHero} alt="Community marketplace" className="w-full h-full object-cover" />
        <div className="absolute inset-0 bg-gradient-to-b from-black/40 via-black/20 to-background" />
        <div className="absolute bottom-6 left-5 right-5">
          <div className="flex items-center gap-2 mb-1">
            <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center">
              <Home className="text-primary-foreground" size={16} />
            </div>
            <h1 className="text-2xl font-extrabold text-white tracking-tight drop-shadow-lg">{auth.settings.platformName}</h1>
          </div>
          <p className="text-sm text-white/80 drop-shadow font-medium">What your neighbors make, no app can deliver</p>
        </div>
      </div>

      {/* Trust Badge */}
      <div className="mx-5 -mt-3 relative z-10 mb-4">
        <div className="bg-primary/5 border border-primary/15 rounded-xl px-4 py-2.5 flex items-center gap-2.5">
          <ShieldCheck className="text-primary shrink-0" size={18} />
          <p className="text-xs text-foreground/80 font-medium">Only verified residents can join. No strangers. No exceptions.</p>
        </div>
      </div>

      {/* Main Card */}
      <div className="px-5 pb-8">
        <div className="bg-card rounded-2xl border border-border shadow-lg overflow-hidden">
          {/* Step Progress */}
          <div className="p-6 pb-4">
            {auth.step !== 'phone' && (
              <div className="flex items-center gap-1 mb-5">
                {auth.stepLabels.map((label, i) => (
                  <div key={label} className="flex-1 flex flex-col items-center gap-1">
                    <div className={`w-full h-1.5 rounded-full transition-colors ${i + 1 <= auth.currentStepNum ? 'bg-primary' : 'bg-muted'}`} />
                    <span className={`text-[10px] font-medium ${i + 1 <= auth.currentStepNum ? 'text-primary' : 'text-muted-foreground'}`}>{label}</span>
                  </div>
                ))}
              </div>
            )}
            <StepHeader step={auth.step} societySubStep={auth.societySubStep} />
          </div>

          {/* Form Content */}
          <div className="px-6 pb-6 overflow-visible">
            <AnimatePresence mode="wait">
              {/* Step 1: Phone */}
              {auth.step === 'phone' && (
                <motion.div key="phone" initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 20 }} transition={{ duration: 0.25 }} className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="phone">Phone Number</Label>
                    <div className="flex gap-2">
                      <div className="flex items-center px-3 bg-muted rounded-xl border border-input text-sm font-medium h-12 shrink-0">
                        {auth.settings.defaultCountryCode}
                      </div>
                      <div className="relative flex-1">
                        <Input
                          id="phone"
                          type="tel"
                          placeholder="10-digit mobile number"
                          value={auth.phone}
                          onChange={(e) => auth.setPhone(auth.formatPhone(e.target.value))}
                          maxLength={10}
                          className="h-12 rounded-xl pr-10"
                          autoFocus
                        />
                        {auth.phone.length === 10 && (
                          <CheckCircle2 size={18} className="absolute right-3 top-1/2 -translate-y-1/2 text-primary" />
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-start gap-3 pt-1">
                    <Checkbox
                      id="age-confirm"
                      checked={auth.ageConfirmed}
                      onCheckedChange={(checked) => auth.setAgeConfirmed(checked === true)}
                      className="mt-0.5"
                    />
                    <div>
                      <label htmlFor="age-confirm" className="text-xs text-muted-foreground leading-snug">
                        I confirm that I am <strong>18 years of age or older</strong> and agree to the{' '}
                        <span className="text-primary underline cursor-pointer" onClick={() => window.open('https://www.sociva.in/#/terms', '_blank', 'noopener,noreferrer')}>Terms & Conditions</span> and{' '}
                        <span className="text-primary underline cursor-pointer" onClick={() => window.open('https://www.sociva.in/#/privacy-policy', '_blank', 'noopener,noreferrer')}>Privacy Policy</span>.
                      </label>
                    </div>
                  </div>

                  <Button
                    onClick={() => auth.handleSendOtp(false)}
                    disabled={auth.phone.length !== 10 || !auth.ageConfirmed || auth.isSendingOtp}
                    className="w-full h-12 rounded-xl text-base font-semibold"
                  >
                    {auth.isSendingOtp ? <Loader2 className="animate-spin mr-2" size={18} /> : <ArrowRight className="mr-2" size={18} />}
                    Send OTP
                  </Button>

                  <div className="bg-muted/50 rounded-xl p-3 text-xs text-muted-foreground text-center">
                    <p>📱 We'll send a 4-digit OTP to verify your number</p>
                    <p className="mt-1 text-muted-foreground/70">Same process for new & existing users</p>
                  </div>
                </motion.div>
              )}

              {/* Step 2: OTP Verification */}
              {auth.step === 'otp' && (
                <OtpStep auth={auth} />
              )}

              {/* Step 3: Society Selection (new users) */}
              {auth.step === 'society' && (
                <motion.div key="society" initial={{ opacity: 0, x: 30 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -30 }} transition={{ duration: 0.25 }} className="space-y-4">
                  <AnimatePresence mode="wait">
                    {auth.societySubStep === 'request-form' && (
                      <motion.div key="request-form" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }} className="space-y-3">
                        <div className="space-y-2"><Label>Society Name *</Label><Input placeholder="e.g., Prestige Lakeside Habitat" value={auth.newSocietyData.name} onChange={(e) => auth.setNewSocietyData({ ...auth.newSocietyData, name: e.target.value })} className="h-12 rounded-xl" /></div>
                        <div className="space-y-2"><Label>Full Address</Label><Input placeholder="Street, area, locality" value={auth.newSocietyData.address} onChange={(e) => auth.setNewSocietyData({ ...auth.newSocietyData, address: e.target.value })} className="h-12 rounded-xl" /></div>
                        <div className="space-y-2"><Label>Landmark</Label><Input placeholder="Near park, temple, mall..." value={auth.newSocietyData.landmark} onChange={(e) => auth.setNewSocietyData({ ...auth.newSocietyData, landmark: e.target.value })} className="h-12 rounded-xl" /></div>
                        <div className="grid grid-cols-2 gap-3">
                          <div className="space-y-2"><Label>City *</Label><Input placeholder="City" value={auth.newSocietyData.city} onChange={(e) => auth.setNewSocietyData({ ...auth.newSocietyData, city: e.target.value })} className="h-12 rounded-xl" /></div>
                          <div className="space-y-2"><Label>Pincode *</Label><Input placeholder="PIN code" value={auth.newSocietyData.pincode} onChange={(e) => auth.setNewSocietyData({ ...auth.newSocietyData, pincode: e.target.value.replace(/\D/g, '').slice(0, 6) })} className="h-12 rounded-xl" /></div>
                        </div>
                        <div className="space-y-2">
                          <Label>Contact Number *</Label>
                          <div className="flex gap-2">
                            <div className="flex items-center px-3 bg-muted rounded-xl border border-input text-sm font-medium h-12">{auth.settings.defaultCountryCode}</div>
                            <Input placeholder="Your phone number" value={auth.newSocietyData.contact} onChange={(e) => auth.setNewSocietyData({ ...auth.newSocietyData, contact: e.target.value.replace(/\D/g, '').slice(0, 10) })} maxLength={10} className="flex-1 h-12 rounded-xl" />
                          </div>
                        </div>
                        <div className="bg-muted/50 rounded-xl p-3 text-xs text-muted-foreground">Your request will be reviewed by our team. We'll contact you once the society is approved.</div>
                        <div className="flex gap-2">
                          <Button variant="outline" onClick={() => auth.setSocietySubStep('search')} className="flex-1 h-12 rounded-xl">Back</Button>
                          <Button onClick={auth.handleRequestNewSociety} disabled={auth.isLoading || !auth.newSocietyData.name || !auth.newSocietyData.city || !auth.newSocietyData.pincode || auth.newSocietyData.contact.length !== 10} className="flex-1 h-12 rounded-xl font-semibold">
                            {auth.isLoading ? <Loader2 className="animate-spin mr-2" size={18} /> : null} Submit Request
                          </Button>
                        </div>
                      </motion.div>
                    )}

                    {auth.societySubStep === 'search' && (
                      <motion.div key="search" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }} className="space-y-4">
                        {!auth.mapsLoaded && (
                          <div className="flex items-center gap-2 p-2.5 bg-muted/50 rounded-xl border border-border animate-pulse">
                            <Loader2 size={14} className="text-muted-foreground animate-spin shrink-0" />
                            <span className="text-xs text-muted-foreground">Loading Google Maps...</span>
                          </div>
                        )}
                        <div className="relative">
                          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={16} />
                          <Input placeholder="Search society, area, landmark, pincode..." value={auth.societySearch} onChange={(e) => auth.handleSearchChange(e.target.value)} className="pl-9 h-12 rounded-xl" autoFocus />
                          {(auth.isSearching || auth.isLoadingSocieties) && <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 animate-spin text-muted-foreground" size={16} />}
                        </div>
                        {(auth.showDbResults || auth.showGoogleResults) && (
                          <div className="max-h-56 overflow-y-auto space-y-1.5 scrollbar-thin">
                            {auth.showDbResults && (
                              <>
                                <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider px-1">Registered Societies</p>
                                {auth.filteredSocieties.map((s) => (
                                  <button key={s.id} onClick={() => auth.handleSelectDbSociety(s)} className={`w-full text-left p-3 rounded-xl border-2 transition-all ${auth.selectedSociety?.id === s.id ? 'border-primary bg-primary/5 shadow-sm' : 'border-border hover:border-primary/30'}`}>
                                    <div className="flex items-center gap-3">
                                      <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0"><Building2 size={18} className="text-primary" /></div>
                                      <div className="min-w-0">
                                        <p className="font-medium text-sm truncate">{s.name}</p>
                                        <p className="text-xs text-muted-foreground truncate">{[s.city, s.state, s.pincode].filter(Boolean).join(', ')}</p>
                                      </div>
                                      {auth.selectedSociety?.id === s.id && <CheckCircle2 size={18} className="text-primary shrink-0 ml-auto" />}
                                    </div>
                                  </button>
                                ))}
                              </>
                            )}
                            {auth.showGoogleResults && (
                              <>
                                <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider px-1 mt-2">Google Maps Results</p>
                                {auth.predictions.map((p) => (
                                  <button key={p.placeId} onClick={() => auth.handleSelectGooglePlace(p.placeId)} className="w-full text-left p-3 rounded-xl border-2 border-border hover:border-primary/30 transition-all">
                                    <div className="flex items-center gap-3">
                                      <div className="w-10 h-10 rounded-xl bg-accent/10 flex items-center justify-center shrink-0"><MapPin size={18} className="text-accent" /></div>
                                      <div className="min-w-0">
                                        <p className="font-medium text-sm truncate">{p.mainText}</p>
                                        <p className="text-xs text-muted-foreground truncate">{p.secondaryText}</p>
                                      </div>
                                    </div>
                                  </button>
                                ))}
                              </>
                             )}
                           </div>
                         )}

                         {/* Society Match Confirmation UI */}
                         {auth.potentialMatches.length > 0 && (
                           <div className="space-y-2 border-2 border-primary/20 rounded-xl p-4 bg-primary/5">
                             <p className="text-sm font-semibold text-foreground">We found similar communities:</p>
                             <div className="space-y-1.5">
                               {auth.potentialMatches.map((m) => (
                                 <button
                                   key={m.society_id}
                                   onClick={() => auth.handleConfirmMatch(m.society_id)}
                                   className="w-full text-left p-3 rounded-xl border-2 border-border hover:border-primary/50 transition-all bg-background"
                                 >
                                   <div className="flex items-center justify-between gap-2">
                                     <div className="flex items-center gap-3 min-w-0">
                                       <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                                         <Building2 size={16} className="text-primary" />
                                       </div>
                                       <span className="font-medium text-sm truncate">{m.society_name}</span>
                                     </div>
                                     <span className="text-xs text-muted-foreground shrink-0">{Math.round(m.confidence * 100)}%</span>
                                   </div>
                                 </button>
                               ))}
                               <button
                                 onClick={auth.handleRejectMatches}
                                 className="w-full text-left p-3 rounded-xl border-2 border-dashed border-border hover:border-muted-foreground/40 transition-all"
                               >
                                 <div className="flex items-center gap-3">
                                   <div className="w-9 h-9 rounded-lg bg-muted flex items-center justify-center shrink-0">
                                     <Plus size={16} className="text-muted-foreground" />
                                   </div>
                                   <span className="text-sm text-muted-foreground">None of these — create new</span>
                                 </div>
                               </button>
                             </div>
                           </div>
                         )}

                         {auth.societySearch.length >= 3 && !auth.showDbResults && !auth.showGoogleResults && !auth.isSearching && !auth.selectedSociety && auth.potentialMatches.length === 0 && (
                           <p className="text-center text-sm text-muted-foreground py-4">No results found for "{auth.societySearch}"</p>
                         )}
                         {auth.societySearch.length < 2 && !auth.selectedSociety && auth.potentialMatches.length === 0 && (
                           <div className="text-center py-6 space-y-2">
                             <div className="mx-auto w-12 h-12 rounded-2xl bg-muted flex items-center justify-center"><Search size={20} className="text-muted-foreground" /></div>
                             <p className="text-sm text-muted-foreground">Start typing to search for your society</p>
                             <p className="text-xs text-muted-foreground/70">Search by society name, area, landmark, or pincode</p>
                           </div>
                         )}

                         {/* Invite code if needed */}
                         {auth.selectedSociety?.invite_code && (
                           <div className="space-y-2 pt-1">
                             <Label>Invite Code</Label>
                             <Input placeholder="Enter society invite code" value={auth.inviteCode} onChange={(e) => auth.setInviteCode(e.target.value)} className="h-12 rounded-xl" />
                           </div>
                         )}

                         {/* Can't find society link */}
                         <div className="text-center pt-1">
                           <button type="button" onClick={() => auth.setSocietySubStep('request-form')} className="text-sm text-primary font-medium hover:underline inline-flex items-center gap-1">
                             <Plus size={14} /> Can't find your society? Request it
                           </button>
                         </div>

                        <Button
                          onClick={auth.handleSocietyComplete}
                          disabled={!auth.selectedSociety || (auth.selectedSociety.invite_code ? !auth.inviteCode.trim() : false) || auth.isLoading}
                          className="w-full h-12 rounded-xl font-semibold"
                        >
                          {auth.isLoading ? <Loader2 className="animate-spin mr-2" size={18} /> : <ArrowRight className="mr-2" size={18} />}
                          Complete Setup
                        </Button>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>

        {/* Legal Footer */}
        <div className="text-center text-xs text-muted-foreground mt-6 px-4 space-y-1.5">
          <p>By continuing, you agree to our{' '}<Link to="/terms" className="text-primary font-medium hover:underline">Terms of Service</Link>{' '}and{' '}<Link to="/privacy-policy" className="text-primary font-medium hover:underline">Privacy Policy</Link>.</p>
          <p className="font-medium text-muted-foreground/70">Available for verified residential society members only.</p>
        </div>
      </div>
    </div>
  );
}

// ── Step Header ──
function StepHeader({ step, societySubStep }: { step: string; societySubStep: string }) {
  const iconClass = "mx-auto w-14 h-14 rounded-2xl bg-gradient-to-br from-primary/20 to-primary/5 flex items-center justify-center mb-3";
  const configs: Record<string, { icon: React.ReactNode; title: string; subtitle: string }> = {
    phone: { icon: <Phone className="text-primary" size={26} />, title: 'Welcome', subtitle: 'Enter your phone number to continue' },
    otp: { icon: <Sparkles className="text-primary" size={26} />, title: 'Verify OTP', subtitle: 'Enter the code sent to your phone' },
    'society-search': { icon: <MapPin className="text-primary" size={26} />, title: 'Find Your Society', subtitle: 'Search by name, area, or pincode' },
    'society-request-form': { icon: <MapPin className="text-primary" size={26} />, title: 'Request Society', subtitle: 'Submit details for admin review' },
  };

  const key = step === 'society' ? `society-${societySubStep}` : step;
  const config = configs[key];
  if (!config) return null;

  return (
    <div className="text-center">
      <div className={iconClass}>{config.icon}</div>
      <h2 className="text-xl font-bold">{config.title}</h2>
      <p className="text-sm text-muted-foreground mt-1">{config.subtitle}</p>
    </div>
  );
}
