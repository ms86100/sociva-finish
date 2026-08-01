// @ts-nocheck
import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Copy, KeyRound, RefreshCw, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';

interface GenericOtpCardProps {
  orderId: string;
  targetStatus: string;
  targetStatusLabel: string;
}

export function GenericOtpCard({ orderId, targetStatus, targetStatusLabel }: GenericOtpCardProps) {
  const [code, setCode] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRegenerating, setIsRegenerating] = useState(false);

  const generateCode = async (showToast = false) => {
    try {
      const { data, error } = await supabase.rpc('generate_generic_otp', {
        _order_id: orderId,
        _target_status: targetStatus,
      });
      if (error) throw error;
      setCode(data as string);
      if (showToast) toast.success('New code generated');
    } catch (err: any) {
      console.error('Failed to generate OTP:', err);
      if (showToast) toast.error('Failed to generate code');
    }
  };

  useEffect(() => {
    setIsLoading(true);
    // First check if code already exists
    supabase
      .from('order_otp_codes')
      .select('otp_code, verified, expires_at')
      .eq('order_id', orderId)
      .eq('target_status', targetStatus)
      .maybeSingle()
      .then(({ data }) => {
        if (data && !data.verified && new Date(data.expires_at) > new Date()) {
          setCode(data.otp_code);
          setIsLoading(false);
        } else {
          // Generate new code
          generateCode().finally(() => setIsLoading(false));
        }
      });
  }, [orderId, targetStatus]);

  const handleCopy = () => {
    if (!code) return;
    navigator.clipboard.writeText(code).catch(() => {});
    toast.success('Code copied');
  };

  const handleRegenerate = async () => {
    setIsRegenerating(true);
    await generateCode(true);
    setIsRegenerating(false);
  };

  if (isLoading) {
    return (
      <div className="bg-primary/5 border border-primary/20 rounded-xl p-4 flex items-center justify-center gap-2">
        <Loader2 size={16} className="animate-spin text-primary" />
        <span className="text-sm text-muted-foreground">Generating verification code…</span>
      </div>
    );
  }

  return (
    <div className="bg-primary/5 border border-primary/20 rounded-xl p-4">
      <div className="flex items-center gap-2 mb-2">
        <KeyRound size={16} className="text-primary" />
        <p className="text-xs font-semibold text-primary uppercase tracking-wide">Verification Code</p>
      </div>
      <p className="text-xs text-muted-foreground mb-3">
        Share this code with the other party. They'll enter it to mark the order as <strong>{targetStatusLabel}</strong>.
      </p>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-3xl font-bold font-mono tracking-[0.3em] text-foreground">{code}</span>
          <button onClick={handleCopy} className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center hover:bg-primary/20 transition-colors">
            <Copy size={14} className="text-primary" />
          </button>
        </div>
        <Button variant="ghost" size="sm" onClick={handleRegenerate} disabled={isRegenerating} className="text-xs gap-1.5 text-muted-foreground">
          {isRegenerating ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
          New code
        </Button>
      </div>
    </div>
  );
}
