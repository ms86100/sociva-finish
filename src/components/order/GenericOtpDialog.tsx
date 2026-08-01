// @ts-nocheck
import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { InputOTP, InputOTPGroup, InputOTPSlot } from '@/components/ui/input-otp';
import { Loader2, ShieldCheck } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

interface GenericOtpDialogProps {
  orderId: string;
  targetStatus: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onVerified?: () => void;
}

export function GenericOtpDialog({ orderId, targetStatus, open, onOpenChange, onVerified }: GenericOtpDialogProps) {
  const [otp, setOtp] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const canSubmit = useMemo(() => otp.trim().length === 4 && !isSubmitting, [otp, isSubmitting]);

  const handleOtpChange = (value: string) => {
    setOtp(value);
    if (errorMessage) setErrorMessage(null);
  };

  const handleVerify = async () => {
    if (!canSubmit) return;
    setIsSubmitting(true);
    setErrorMessage(null);
    try {
      const { error } = await supabase.rpc('verify_generic_otp_and_advance', {
        _order_id: orderId,
        _otp_code: otp.trim(),
        _target_status: targetStatus,
      });
      if (error) throw error;

      toast.success('OTP verified — order advanced');
      setOtp('');
      setErrorMessage(null);
      onOpenChange(false);
      onVerified?.();
    } catch (error: any) {
      const msg = error?.message || 'Invalid code';
      const friendly = msg.toLowerCase().includes('invalid otp') ? 'Invalid code, please try again'
        : msg.toLowerCase().includes('expired') ? 'Code expired — ask for a new one'
        : msg;
      setErrorMessage(friendly);
      toast.error(friendly);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldCheck size={18} className="text-primary" />
            Verify OTP
          </DialogTitle>
          <DialogDescription>
            Enter the 4-digit code shared by the other party to proceed.
          </DialogDescription>
        </DialogHeader>

        <div className="py-2 space-y-2">
          <div className="flex justify-center">
            <InputOTP maxLength={4} value={otp} onChange={handleOtpChange} autoFocus>
              <InputOTPGroup className="gap-3">
                <InputOTPSlot index={0} className={`w-12 h-12 rounded-xl border-2 ${errorMessage ? 'border-destructive' : ''}`} />
                <InputOTPSlot index={1} className={`w-12 h-12 rounded-xl border-2 ${errorMessage ? 'border-destructive' : ''}`} />
                <InputOTPSlot index={2} className={`w-12 h-12 rounded-xl border-2 ${errorMessage ? 'border-destructive' : ''}`} />
                <InputOTPSlot index={3} className={`w-12 h-12 rounded-xl border-2 ${errorMessage ? 'border-destructive' : ''}`} />
              </InputOTPGroup>
            </InputOTP>
          </div>
          {errorMessage && (
            <p className="text-xs text-destructive text-center font-medium">{errorMessage}</p>
          )}
        </div>

        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSubmitting}>Cancel</Button>
          <Button onClick={handleVerify} disabled={!canSubmit} className="gap-2">
            {isSubmitting ? <Loader2 size={14} className="animate-spin" /> : null}
            {isSubmitting ? 'Verifying...' : 'Verify & Proceed'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
