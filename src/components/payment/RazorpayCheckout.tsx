// @ts-nocheck
import { useState, useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerDescription,
} from '@/components/ui/drawer';
import { Loader2, CreditCard, CheckCircle, XCircle, RefreshCw, WifiOff, Clock, ExternalLink } from 'lucide-react';
import { useRazorpay } from '@/hooks/useRazorpay';
import { useCurrency } from '@/hooks/useCurrency';

interface RazorpayCheckoutProps {
  isOpen: boolean;
  onClose: () => void;
  orderId: string;
  orderIds?: string[];
  amount: number;
  sellerId: string;
  sellerName: string;
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  onPaymentSuccess: (paymentId: string) => void;
  onPaymentFailed: () => void;
  onDismiss?: () => void;
}

export function RazorpayCheckout({
  isOpen,
  onClose,
  orderId,
  orderIds,
  amount,
  sellerId,
  sellerName,
  customerName,
  customerEmail,
  customerPhone,
  onPaymentSuccess,
  onPaymentFailed,
  onDismiss,
}: RazorpayCheckoutProps) {
  const { createOrder, isLoading, isScriptLoaded, scriptError, retryLoadScript } = useRazorpay();
  const { formatPrice } = useCurrency();
  const [status, setStatus] = useState<'pending' | 'processing' | 'verifying' | 'success' | 'confirming' | 'failed' | 'blocked'>('pending');
  const statusRef = useRef(status);
  const processingTimeoutRef = useRef<ReturnType<typeof setTimeout>>();
  const paymentInFlightRef = useRef(false);

  // Keep statusRef in sync for use in callbacks that close over stale state
  useEffect(() => { statusRef.current = status; }, [status]);

  const successFinalRef = useRef(false);

  useEffect(() => {
    if (isOpen) {
      // Only reset to pending if success hasn't already fired for this attempt
      if (!successFinalRef.current) {
        setStatus('pending');
      }
      paymentInFlightRef.current = false;
    } else {
      // Delay reset of terminal guard to ensure close lifecycle completes first.
      // This prevents handleClose from running after successFinalRef is cleared.
      const timer = setTimeout(() => {
        successFinalRef.current = false;
      }, 500);
      return () => clearTimeout(timer);
    }
    return () => {
      if (processingTimeoutRef.current) clearTimeout(processingTimeoutRef.current);
    };
  }, [isOpen]);

  const handlePayment = async () => {
    // Double-tap guard
    if (paymentInFlightRef.current) return;
    paymentInFlightRef.current = true;

    setStatus('processing');

    processingTimeoutRef.current = setTimeout(() => {
      setStatus((prev) => (prev === 'processing' ? 'pending' : prev));
      paymentInFlightRef.current = false;
    }, 15000);

    await createOrder({
      orderId,
      orderIds: orderIds || [orderId],
      amount,
      sellerId,
      customerName,
      customerEmail,
      customerPhone,
      businessName: sellerName,
      onSuccess: (paymentId, razorpayOrderId) => {
        if (processingTimeoutRef.current) clearTimeout(processingTimeoutRef.current);
        paymentInFlightRef.current = false;
        if (razorpayOrderId) {
          console.log('[Payment] Razorpay order_id for reconciliation:', razorpayOrderId);
        }
        // Mark success as terminal — prevents drawer lifecycle from reverting to 'pending'
        successFinalRef.current = true;
        setStatus('success');
        onPaymentSuccess(paymentId);
      },
      onFailure: (error) => {
        if (processingTimeoutRef.current) clearTimeout(processingTimeoutRef.current);
        paymentInFlightRef.current = false;
        // Detect popup-blocked specific error
        if (error?.code === 'POPUP_BLOCKED') {
          setStatus('blocked');
        } else {
          setStatus('failed');
        }
      },
      onDismiss: () => {
        if (processingTimeoutRef.current) clearTimeout(processingTimeoutRef.current);
        paymentInFlightRef.current = false;
        // Guard: if payment already succeeded, don't reset to pending
        if (successFinalRef.current || ['verifying', 'success', 'confirming'].includes(statusRef.current)) {
          console.log('[Payment] onDismiss suppressed — successFinal:', successFinalRef.current, 'status:', statusRef.current);
          return;
        }
        // Close the drawer entirely instead of resetting to 'pending' (which causes a loop)
        if (onDismiss) {
          onDismiss();
        }
        setStatus('pending');
        onClose();
      },
    });
  };

  const handleRetry = () => {
    paymentInFlightRef.current = false;
    setStatus('pending');
  };

  const handleClose = () => {
    if (processingTimeoutRef.current) clearTimeout(processingTimeoutRef.current);
    paymentInFlightRef.current = false;

    // CRITICAL: If success already fired, NEVER call onPaymentFailed or onDismiss.
    // The drawer close lifecycle must not undo a successful payment.
    if (successFinalRef.current || status === 'success') {
      // Silent close — parent already handled success
      onClose();
      return;
    }

    if (status === 'pending' || status === 'blocked') {
      if (onDismiss) {
        onDismiss();
        setStatus('pending');
        onClose();
        return;
      }
    } else {
      onPaymentFailed();
    }
    setStatus('pending');
    onClose();
  };

  const publishedUrl = 'https://sociva.lovable.app';

  return (
    <Drawer open={isOpen} onOpenChange={handleClose}>
      <DrawerContent className="max-h-[85vh]">
        <DrawerHeader className="text-center pb-4">
          <DrawerTitle>Pay Online</DrawerTitle>
          <DrawerDescription>
            Pay {formatPrice(amount)} to {sellerName}
          </DrawerDescription>
        </DrawerHeader>

        <div className="py-6 px-4 overflow-y-auto" style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}>
          {status === 'pending' && (
            <div className="text-center space-y-6">
              <div className="w-20 h-20 mx-auto rounded-full bg-primary/10 flex items-center justify-center">
                <CreditCard className="text-primary" size={40} />
              </div>
              <div>
                <p className="font-semibold text-2xl">{formatPrice(amount)}</p>
                <p className="text-sm text-muted-foreground mt-1">
                  Secure payment via Razorpay
                </p>
                <div className="flex items-center justify-center gap-2 mt-3">
                  <img src="https://razorpay.com/assets/razorpay-glyph.svg" alt="Razorpay" className="h-4" />
                  <span className="text-xs text-muted-foreground">UPI · Cards · Netbanking · Wallets</span>
                </div>
              </div>

              {scriptError && !isScriptLoaded && (
                <div className="bg-destructive/10 border border-destructive/20 rounded-xl p-3 flex items-center gap-3">
                  <WifiOff size={18} className="text-destructive shrink-0" />
                  <div className="text-left flex-1 min-w-0">
                    <p className="text-xs font-medium text-destructive">Payment service unavailable</p>
                    <p className="text-[11px] text-muted-foreground mt-0.5">Check your internet connection</p>
                  </div>
                  <Button variant="outline" size="sm" className="shrink-0 h-8 text-xs" onClick={retryLoadScript}>
                    Retry
                  </Button>
                </div>
              )}

              <div className="flex gap-3 pt-4">
                <Button
                  variant="outline"
                  className="flex-1 min-h-[48px]"
                  onClick={handleClose}
                >
                  Cancel
                </Button>
                <Button
                  className="flex-1 min-h-[48px]"
                  onClick={handlePayment}
                  disabled={isLoading || !isScriptLoaded || paymentInFlightRef.current}
                >
                  {isLoading ? (
                    <>
                      <Loader2 className="mr-2 animate-spin" size={16} />
                      Processing…
                    </>
                  ) : (
                    'Pay Now'
                  )}
                </Button>
              </div>
            </div>
          )}

          {status === 'processing' && (
            <div className="text-center space-y-4 py-8">
              <Loader2 className="mx-auto animate-spin text-primary" size={48} />
              <div>
                <p className="font-semibold">Opening Payment</p>
                <p className="text-sm text-muted-foreground">
                  Complete payment in the popup
                </p>
              </div>
            </div>
          )}

          {status === 'verifying' && (
            <div className="text-center space-y-4 py-8">
              <Loader2 className="mx-auto animate-spin text-primary" size={48} />
              <div>
                <p className="font-semibold">Verifying Payment…</p>
                <p className="text-sm text-muted-foreground">
                  Confirming with payment server
                </p>
              </div>
            </div>
          )}

          {status === 'success' && (
            <div className="text-center space-y-4 py-8">
              <div className="w-20 h-20 mx-auto rounded-full bg-success/10 flex items-center justify-center">
                <CheckCircle className="text-success" size={48} />
              </div>
              <div>
                <p className="font-semibold text-success">Payment Successful!</p>
                <p className="text-sm text-muted-foreground">
                  Your order is confirmed
                </p>
              </div>
            </div>
          )}

          {status === 'confirming' && (
            <div className="text-center space-y-4 py-8">
              <div className="w-20 h-20 mx-auto rounded-full bg-warning/10 flex items-center justify-center">
                <Clock className="text-warning" size={48} />
              </div>
              <div>
                <p className="font-semibold text-foreground">Payment Received</p>
                <p className="text-sm text-muted-foreground">
                  We're confirming your order — check your orders page for updates
                </p>
              </div>
            </div>
          )}

          {status === 'blocked' && (
            <div className="text-center space-y-6 py-4">
              <div className="w-20 h-20 mx-auto rounded-full bg-warning/10 flex items-center justify-center">
                <ExternalLink className="text-warning" size={40} />
              </div>
              <div>
                <p className="font-semibold text-foreground">Payment window couldn't open</p>
                <p className="text-sm text-muted-foreground mt-1">
                  Your browser blocked the payment popup. Please open the app directly to complete payment.
                </p>
              </div>
              <Button
                variant="outline"
                className="min-h-[48px] w-full"
                onClick={() => window.open(publishedUrl, '_blank')}
              >
                <ExternalLink size={16} className="mr-2" />
                Open App
              </Button>
              <div className="flex gap-3">
                <Button variant="outline" className="flex-1 min-h-[48px]" onClick={handleClose}>
                  Cancel
                </Button>
                <Button className="flex-1 min-h-[48px]" onClick={handleRetry}>
                  <RefreshCw size={16} className="mr-2" />
                  Retry
                </Button>
              </div>
            </div>
          )}

          {status === 'failed' && (
            <div className="text-center space-y-6 py-4">
              <div className="w-20 h-20 mx-auto rounded-full bg-destructive/10 flex items-center justify-center">
                <XCircle className="text-destructive" size={48} />
              </div>
              <div>
                <p className="font-semibold text-destructive">Payment Failed</p>
                <p className="text-sm text-muted-foreground">
                  The payment was not completed
                </p>
              </div>
              <div className="flex gap-3 pt-4">
                <Button variant="outline" className="flex-1 min-h-[48px]" onClick={handleClose}>
                  Cancel
                </Button>
                <Button className="flex-1 min-h-[48px]" onClick={handleRetry}>
                  <RefreshCw size={16} className="mr-2" />
                  Retry
                </Button>
              </div>
            </div>
          )}
        </div>
      </DrawerContent>
    </Drawer>
  );
}
