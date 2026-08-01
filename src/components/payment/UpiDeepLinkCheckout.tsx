// @ts-nocheck
import { useState, useEffect, useRef, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet';
import { Loader2, CheckCircle, XCircle, RefreshCw, Copy, ImagePlus, X, ShieldCheck, ShieldAlert, ShieldX } from 'lucide-react';
import { useCurrency } from '@/hooks/useCurrency';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import QRCodeDisplay from '@/components/security/QRCodeDisplay';

interface UpiDeepLinkCheckoutProps {
  isOpen: boolean;
  onClose: () => void;
  orderId: string;
  amount: number;
  sellerUpiId: string;
  sellerName: string;
  onPaymentConfirmed: () => void;
  onPaymentFailed: () => void;
}

type CheckoutStep = 'pay' | 'confirm' | 'done' | 'failed';

const UPI_STEP_KEY = 'sociva_upi_checkout_step';
const UPI_OPENED_APP_KEY = 'sociva_upi_opened_app';

export function UpiDeepLinkCheckout({
  isOpen,
  onClose,
  orderId,
  amount,
  sellerUpiId,
  sellerName,
  onPaymentConfirmed,
  onPaymentFailed,
}: UpiDeepLinkCheckoutProps) {
  const { formatPrice } = useCurrency();
  const [verification, setVerification] = useState<{ status?: string; holder?: string | null; verifiedAt?: string | null }>({});

  useEffect(() => {
    if (!sellerUpiId) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from('seller_profiles')
        .select('upi_verification_status, upi_holder_name, upi_verified_at')
        .eq('upi_id', sellerUpiId)
        .maybeSingle();
      if (!cancelled && data) setVerification({ status: (data as any).upi_verification_status, holder: (data as any).upi_holder_name, verifiedAt: (data as any).upi_verified_at });
    })();
    return () => { cancelled = true; };
  }, [sellerUpiId]);

  const trustBadge = (() => {
    const s = verification.status;
    const stale = s === 'valid' && verification.verifiedAt && (Date.now() - new Date(verification.verifiedAt).getTime() > 30 * 24 * 3600 * 1000);
    if (s === 'valid' && !stale) return { tone: 'ok' as const, icon: ShieldCheck, text: verification.holder ? `Paying to: ${verification.holder}` : 'Verified seller UPI' };
    if (s === 'stale' || stale) return { tone: 'warn' as const, icon: ShieldAlert, text: 'Seller UPI verification expired — proceed with caution.' };
    if (s === 'unavailable' || s === 'unverified' || !s) return { tone: 'danger' as const, icon: ShieldX, text: 'Seller UPI is not verified. We cannot guarantee the recipient. Proceed at your own risk.' };
    return null;
  })();

  const [step, setStepRaw] = useState<CheckoutStep>(() => {
    try {
      const saved = sessionStorage.getItem(UPI_STEP_KEY);
      if (saved && ['pay', 'confirm'].includes(saved)) return saved as CheckoutStep;
    } catch {}
    return 'pay';
  });
  const [screenshotFile, setScreenshotFile] = useState<File | null>(null);
  const [screenshotPreview, setScreenshotPreview] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const hasOpenedApp = useRef<boolean>(
    (() => { try { return sessionStorage.getItem(UPI_OPENED_APP_KEY) === 'true'; } catch { return false; } })()
  );
  const completionTriggeredRef = useRef(false);

  const setStep = useCallback((nextStep: CheckoutStep | ((prev: CheckoutStep) => CheckoutStep)) => {
    setStepRaw(prev => {
      const resolved = typeof nextStep === 'function' ? nextStep(prev) : nextStep;
      try { sessionStorage.setItem(UPI_STEP_KEY, resolved); } catch {}
      return resolved;
    });
  }, []);

  const shortOrderId = orderId.slice(0, 8).toUpperCase();
  const transactionNote = `ORD_${shortOrderId}`;

  const UPI_APPS = [
    { name: 'Google Pay', scheme: 'tez', bg: 'bg-[hsl(217,89%,51%)]', text: 'text-white' },
    { name: 'PhonePe', scheme: 'phonepe', bg: 'bg-[hsl(267,56%,42%)]', text: 'text-white' },
    { name: 'Paytm', scheme: 'paytmmp', bg: 'bg-[hsl(197,97%,46%)]', text: 'text-white' },
  ];

  const buildUpiLink = (scheme: string) =>
    `${scheme}://upi/pay?pa=${encodeURIComponent(sellerUpiId)}&pn=${encodeURIComponent(sellerName)}&am=${amount}&cu=INR&tn=${encodeURIComponent(transactionNote)}`;

  const upiLink = `upi://pay?pa=${encodeURIComponent(sellerUpiId)}&pn=${encodeURIComponent(sellerName)}&am=${amount}&cu=INR&tn=${encodeURIComponent(transactionNote)}`;

  const isRestoredRef = useRef(false);
  useEffect(() => {
    if (isOpen) {
      const savedStep = (() => { try { return sessionStorage.getItem(UPI_STEP_KEY); } catch { return null; } })();
      const savedOpened = (() => { try { return sessionStorage.getItem(UPI_OPENED_APP_KEY) === 'true'; } catch { return false; } })();

      if (savedOpened && savedStep === 'confirm') {
        isRestoredRef.current = true;
        hasOpenedApp.current = true;
        setStep('confirm');
      } else if (!isRestoredRef.current) {
        setStep('pay');
        hasOpenedApp.current = false;
        try { sessionStorage.removeItem(UPI_OPENED_APP_KEY); } catch {}
        completionTriggeredRef.current = false;
      }
    } else {
      isRestoredRef.current = false;
    }
  }, [isOpen]);

  const completeFlow = useCallback(() => {
    if (completionTriggeredRef.current) return;
    completionTriggeredRef.current = true;
    setStep('done');
    try { sessionStorage.removeItem(UPI_STEP_KEY); sessionStorage.removeItem(UPI_OPENED_APP_KEY); } catch {}
    setTimeout(() => onPaymentConfirmed(), 1500);
  }, [onPaymentConfirmed]);

  // On app resume, check payment status
  useEffect(() => {
    if (!isOpen) return;
    const handleVisibilityChange = async () => {
      if (document.visibilityState !== 'visible' || !hasOpenedApp.current || completionTriggeredRef.current) return;
      const { data, error } = await supabase
        .from('orders')
        .select('payment_status, status')
        .eq('id', orderId)
        .maybeSingle();
      if (error || !data) { setStep(prev => prev === 'pay' ? 'confirm' : prev); return; }
      if (data.payment_status === 'paid' || data.payment_status === 'buyer_confirmed') { completeFlow(); return; }
      if (data.status === 'cancelled') { setStep('failed'); return; }
      setStep('confirm');
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [isOpen, orderId, completeFlow]);

  const handlePayWithApp = (scheme: string) => {
    hasOpenedApp.current = true;
    try { sessionStorage.setItem(UPI_OPENED_APP_KEY, 'true'); } catch {}
    setStep('confirm');
    window.open(buildUpiLink(scheme), '_blank');
  };

  const handleCopyUpi = () => {
    navigator.clipboard.writeText(sellerUpiId);
    toast.success('UPI ID copied', { id: 'upi-copy' });
  };

  const handleScreenshotSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) { toast.error('Image must be under 5MB'); return; }
    setScreenshotFile(file);
    setScreenshotPreview(URL.createObjectURL(file));
  };

  const handleRemoveScreenshot = () => {
    setScreenshotFile(null);
    if (screenshotPreview) URL.revokeObjectURL(screenshotPreview);
    setScreenshotPreview(null);
  };

  const confirmSubmittedRef = useRef(false);

  const handleSubmitConfirmation = async () => {
    // Idempotency guard: prevent double-submission on app-switch
    if (confirmSubmittedRef.current) return;
    confirmSubmittedRef.current = true;
    setIsSubmitting(true);
    try {
      let screenshotUrl: string | null = null;

      if (screenshotFile) {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) throw new Error('Not authenticated');
        const ext = screenshotFile.name.split('.').pop() || 'jpg';
        const path = `${user.id}/${orderId}.${ext}`;
        const { error: uploadErr } = await supabase.storage
          .from('payment-proofs')
          .upload(path, screenshotFile, { upsert: true });
        if (uploadErr) throw uploadErr;
        const { data: signedData } = await supabase.storage
          .from('payment-proofs')
          .createSignedUrl(path, 60 * 60 * 24 * 30);
        const { data: urlData } = supabase.storage
          .from('payment-proofs')
          .getPublicUrl(path);
        screenshotUrl = signedData?.signedUrl || urlData?.publicUrl || null;
      }

      const { error } = await supabase.rpc('confirm_upi_payment', {
        _order_id: orderId,
        _upi_transaction_ref: '',
        _payment_screenshot_url: screenshotUrl ?? undefined,
      });
      if (error) throw error;

      // Notify seller
      const { data: orderData } = await supabase
        .from('orders')
        .select('seller_id, buyer_id')
        .eq('id', orderId)
        .single();

      if (orderData) {
        const { data: sellerProfile } = await supabase
          .from('seller_profiles')
          .select('user_id')
          .eq('id', orderData.seller_id)
          .single();

        if (sellerProfile) {
          const evidenceText = screenshotUrl ? 'Screenshot attached.' : 'No evidence provided.';
          await supabase.from('notification_queue').insert({
            user_id: sellerProfile.user_id,
            type: 'order',
            title: '💳 Payment Confirmation Needed',
            body: `Buyer claims UPI payment for Order #${shortOrderId}. ${evidenceText} Please verify and confirm.`,
            reference_path: `/orders/${orderId}`,
            payload: { orderId, status: 'buyer_confirmed', type: 'order' },
          } as any);
          supabase.functions.invoke('process-notification-queue').catch(() => {});
        }
      }

      completeFlow();
    } catch (err) {
      confirmSubmittedRef.current = false; // Allow retry on failure
      console.error('Failed to submit payment confirmation:', err);
      toast.error('Failed to submit payment confirmation', { id: 'upi-submit-err' });
    } finally {
      setIsSubmitting(false);
    }
  };

  const dismissLocked = hasOpenedApp.current && (step === 'confirm' || isSubmitting);

  const handleSystemClose = () => {
    if (dismissLocked) return;
    // Don't trigger onPaymentFailed if completion was already handled
    if (completionTriggeredRef.current) {
      onClose();
      return;
    }
    if (step === 'pay' && !hasOpenedApp.current) {
      try { sessionStorage.removeItem(UPI_STEP_KEY); sessionStorage.removeItem(UPI_OPENED_APP_KEY); } catch {}
      onPaymentFailed();
    }
    onClose();
  };

  const handleCancelOrder = () => {
    try { sessionStorage.removeItem(UPI_STEP_KEY); sessionStorage.removeItem(UPI_OPENED_APP_KEY); } catch {}
    onPaymentFailed();
    onClose();
  };

  return (
    <Sheet open={isOpen} onOpenChange={(nextOpen) => { if (!nextOpen) handleSystemClose(); }}>
      <SheetContent
        side="bottom"
        className="rounded-t-2xl max-h-[90vh] overflow-y-auto"
        onPointerDownOutside={(e) => { if (dismissLocked) e.preventDefault(); }}
        onEscapeKeyDown={(e) => { if (dismissLocked) e.preventDefault(); }}
      >
        <SheetHeader className="text-center pb-4">
          <SheetTitle>Pay via UPI</SheetTitle>
          <SheetDescription>Pay {formatPrice(amount)} to {sellerName}</SheetDescription>
        </SheetHeader>

        <div className="py-4">
          {/* Step 1: Pay */}
          {step === 'pay' && (
            <div className="text-center space-y-5">
              <QRCodeDisplay value={upiLink} size={180} />
              <div>
                <p className="font-semibold text-2xl">{formatPrice(amount)}</p>
                <p className="text-sm text-muted-foreground mt-1">Scan QR or choose your UPI app below</p>
              </div>
              <div className="bg-muted rounded-xl p-3 text-left space-y-2">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-[11px] text-muted-foreground uppercase tracking-wide">UPI ID</p>
                    <p className="text-sm font-mono font-medium">{sellerUpiId}</p>
                  </div>
                  <button onClick={handleCopyUpi} className="text-muted-foreground hover:text-foreground">
                    <Copy size={14} />
                  </button>
                </div>
                <div>
                  <p className="text-[11px] text-muted-foreground uppercase tracking-wide">Order Reference</p>
                  <p className="text-sm font-mono font-medium">{transactionNote}</p>
                </div>
              </div>
              {trustBadge && (
                <div className={`flex items-start gap-2 rounded-xl p-3 text-left text-sm border ${
                  trustBadge.tone === 'ok' ? 'bg-green-50 text-green-800 border-green-200 dark:bg-green-950/30 dark:text-green-300 dark:border-green-900' :
                  trustBadge.tone === 'warn' ? 'bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-950/30 dark:text-amber-300 dark:border-amber-900' :
                  'bg-destructive/10 text-destructive border-destructive/30'
                }`}>
                  <trustBadge.icon size={16} className="shrink-0 mt-0.5" />
                  <span>{trustBadge.text}</span>
                </div>
              )}
              <div className="grid grid-cols-3 gap-3 pt-2">
                {UPI_APPS.map((app) => (
                  <button
                    key={app.scheme}
                    onClick={() => handlePayWithApp(app.scheme)}
                    className={`${app.bg} ${app.text} rounded-xl py-3 px-2 text-sm font-semibold transition-transform active:scale-95`}
                  >
                    {app.name}
                  </button>
                ))}
              </div>
              <Button variant="outline" className="w-full" onClick={handleCancelOrder}>Cancel</Button>
            </div>
          )}

          {/* Step 2: Confirm payment */}
          {step === 'confirm' && (
            <div className="space-y-5">
              <div className="text-center">
                <div className="w-16 h-16 mx-auto rounded-full bg-primary/10 flex items-center justify-center mb-3">
                  <CheckCircle className="text-primary" size={32} />
                </div>
                <p className="font-semibold text-lg">Confirm Your Payment</p>
                <p className="text-sm text-muted-foreground mt-1">
                  {formatPrice(amount)} to {sellerName}
                </p>
              </div>

              <div className="bg-muted/50 rounded-xl p-3.5">
                <p className="text-xs text-muted-foreground leading-relaxed">
                  Complete the payment using your UPI app. Once done, <span className="font-medium text-foreground">upload a screenshot of your payment</span> and tap <span className="font-medium text-foreground">"Confirm Payment"</span> to notify the seller.
                </p>
              </div>

              {/* Optional screenshot upload */}
              <div className="space-y-2">
                {screenshotPreview ? (
                  <div className="relative rounded-xl overflow-hidden border border-border">
                    <img src={screenshotPreview} alt="Payment proof" className="w-full max-h-48 object-contain bg-muted/30" />
                    <button
                      onClick={handleRemoveScreenshot}
                      className="absolute top-2 right-2 bg-background/80 backdrop-blur-sm rounded-full p-1 border border-border hover:bg-destructive/10 transition-colors"
                    >
                      <X size={14} className="text-muted-foreground" />
                    </button>
                  </div>
                ) : (
                  <label className="flex flex-col items-center justify-center gap-1.5 py-4 rounded-xl border-2 border-dashed border-primary/30 hover:border-primary/50 transition-colors cursor-pointer bg-primary/5">
                    <ImagePlus size={18} className="text-primary" />
                    <span className="text-xs font-medium text-primary">Upload payment screenshot</span>
                    <span className="text-[10px] text-muted-foreground">Required to confirm payment</span>
                    <input type="file" accept="image/*" className="hidden" onChange={handleScreenshotSelect} />
                  </label>
                )}
              </div>

              {!screenshotFile && (
                <p className="text-xs text-destructive text-center font-medium">Please upload a payment screenshot to confirm</p>
              )}

              <div className="flex flex-col gap-3 pt-1">
                <Button
                  className="w-full gap-2"
                  onClick={handleSubmitConfirmation}
                  disabled={isSubmitting || !screenshotFile}
                >
                  {isSubmitting ? (
                    <><Loader2 className="animate-spin" size={16} />Submitting...</>
                  ) : (
                    <><CheckCircle size={16} />Confirm Payment</>
                  )}
                </Button>
                <Button variant="outline" className="w-full gap-2" onClick={() => setStep('pay')}>
                  <RefreshCw size={16} />Pay again
                </Button>
                <Button variant="ghost" className="w-full text-muted-foreground" onClick={handleCancelOrder}>
                  Cancel order
                </Button>
              </div>
            </div>
          )}

          {/* Done */}
          {step === 'done' && (
            <div className="text-center space-y-4 py-8">
              <div className="w-20 h-20 mx-auto rounded-full bg-accent/10 flex items-center justify-center">
                <CheckCircle className="text-accent" size={48} />
              </div>
              <div>
                <p className="font-semibold text-accent">Payment Submitted!</p>
                <p className="text-sm text-muted-foreground mt-1">Seller will verify and confirm your payment</p>
              </div>
            </div>
          )}

          {/* Failed */}
          {step === 'failed' && (
            <div className="text-center space-y-6 py-4">
              <div className="w-20 h-20 mx-auto rounded-full bg-destructive/10 flex items-center justify-center">
                <XCircle className="text-destructive" size={48} />
              </div>
              <div>
                <p className="font-semibold text-destructive">Payment Failed</p>
                <p className="text-sm text-muted-foreground">The payment could not be verified</p>
              </div>
              <div className="flex gap-3 pt-4">
                <Button variant="outline" className="flex-1" onClick={handleCancelOrder}>Cancel</Button>
                <Button className="flex-1" onClick={() => setStep('pay')}>
                  <RefreshCw size={16} className="mr-2" />Retry
                </Button>
              </div>
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
