// @ts-nocheck
import { useState, useCallback } from 'react';
import { supabase, SUPABASE_URL } from '@/integrations/supabase/client';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { GuardConfirmationPoller } from '@/components/security/GuardConfirmationPoller';
import { toast } from 'sonner';
import { CheckCircle, XCircle, User, Search, Clock, QrCode } from 'lucide-react';
import { notify } from '@/lib/notify';

interface VerifiedResident {
  name: string;
  flat_number: string;
  block: string;
  avatar_url?: string;
  user_id: string;
}

interface Props {
  societyId: string;
}

export function GuardResidentQRTab({ societyId }: Props) {
  const [tokenInput, setTokenInput] = useState('');
  const [isVerifying, setIsVerifying] = useState(false);
  const [verifiedResident, setVerifiedResident] = useState<VerifiedResident | null>(null);
  const [verificationStatus, setVerificationStatus] = useState<'idle' | 'success' | 'expired' | 'failed' | 'awaiting'>('idle');
  const [errorMessage, setErrorMessage] = useState('');
  const [pendingEntryId, setPendingEntryId] = useState<string | null>(null);
  const [confirmTimeout, setConfirmTimeout] = useState(20);

  const handleConfirmationComplete = useCallback((status: 'confirmed' | 'denied' | 'expired') => {
    if (status === 'confirmed') setVerificationStatus('success');
  }, []);

  const resetVerification = useCallback(() => {
    setTokenInput(''); setVerifiedResident(null); setVerificationStatus('idle');
    setErrorMessage(''); setPendingEntryId(null);
  }, []);

  const handleValidateToken = async (tokenValue?: string) => {
    const token = tokenValue || tokenInput;
    if (!token.trim()) return;
    setIsVerifying(true); setVerifiedResident(null); setVerificationStatus('idle'); setPendingEntryId(null);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { notify.block('Please log in'); return; }

      const response = await fetch(
        `${SUPABASE_URL}/functions/v1/gate-token?action=validate`,
        {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ token }),
        }
      );
      const result = await response.json();

      if (result.valid && result.awaiting_confirmation) {
        setVerifiedResident(result.resident); setVerificationStatus('awaiting');
        setPendingEntryId(result.entry_id); setConfirmTimeout(result.timeout_seconds || 20);
      } else if (result.valid) {
        setVerifiedResident(result.resident); setVerificationStatus('success');
      } else if (result.expired) {
        setVerificationStatus('expired'); setErrorMessage('QR code has expired. Ask resident to refresh.');
      } else {
        setVerificationStatus('failed'); setErrorMessage(result.error || 'Invalid QR code');
      }
    } catch {
      setVerificationStatus('failed'); setErrorMessage('Verification failed');
    } finally { setIsVerifying(false); }
  };

  return (
    <div className="space-y-4">
      {/* QR Scan Card */}
      <Card className="border-2 border-primary/30">
        <CardContent className="p-4 space-y-3">
          <div className="text-center">
            <QrCode className="mx-auto text-primary mb-1" size={32} />
            <h3 className="font-bold">Resident QR Verification</h3>
            <p className="text-xs text-muted-foreground">Paste QR code data or scan</p>
          </div>
          <Input
            value={tokenInput}
            onChange={e => { setTokenInput(e.target.value); if (verificationStatus !== 'idle') resetVerification(); }}
            placeholder="Paste QR code content..."
            className="text-center h-14 text-sm"
          />
          <Button onClick={() => handleValidateToken()} disabled={!tokenInput.trim() || isVerifying} className="w-full h-12 text-lg" size="lg">
            <Search size={20} className="mr-2" />
            {isVerifying ? 'Verifying...' : 'Verify Entry'}
          </Button>
        </CardContent>
      </Card>

      {/* Verification Results */}
      {verificationStatus === 'awaiting' && pendingEntryId && verifiedResident && (
        <GuardConfirmationPoller
          entryId={pendingEntryId} timeoutSeconds={confirmTimeout}
          residentName={verifiedResident.name} flatNumber={verifiedResident.flat_number}
          block={verifiedResident.block} onComplete={handleConfirmationComplete}
        />
      )}

      {verificationStatus === 'success' && verifiedResident && (
        <Card className="border-success/50 bg-success/5">
          <CardContent className="p-4 space-y-3">
            <div className="text-center">
              <CheckCircle className="mx-auto text-success mb-2" size={48} />
              <p className="text-xl font-bold text-success">VERIFIED</p>
            </div>
            <div className="bg-background rounded-xl p-4 flex items-center gap-3">
              {verifiedResident.avatar_url ? (
                <img src={verifiedResident.avatar_url} className="w-12 h-12 rounded-full object-cover" alt="" />
              ) : (
                <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center"><User size={24} className="text-primary" /></div>
              )}
              <div>
                <p className="text-lg font-bold">{verifiedResident.name}</p>
                <p className="text-sm text-muted-foreground">Block {verifiedResident.block}, Flat {verifiedResident.flat_number}</p>
              </div>
            </div>
            <Button variant="outline" className="w-full h-10" onClick={resetVerification}>Verify Next</Button>
          </CardContent>
        </Card>
      )}

      {verificationStatus === 'expired' && (
        <Card className="border-warning/50 bg-warning/5">
          <CardContent className="p-4 text-center">
            <Clock className="mx-auto text-warning mb-2" size={48} />
            <p className="text-xl font-bold text-warning">EXPIRED</p>
            <p className="text-sm text-muted-foreground mt-1">{errorMessage}</p>
            <Button variant="outline" className="mt-3" onClick={resetVerification}>Try Again</Button>
          </CardContent>
        </Card>
      )}

      {verificationStatus === 'failed' && (
        <Card className="border-destructive/50 bg-destructive/5">
          <CardContent className="p-4 text-center">
            <XCircle className="mx-auto text-destructive mb-2" size={48} />
            <p className="text-xl font-bold text-destructive">INVALID</p>
            <p className="text-sm text-muted-foreground mt-1">{errorMessage}</p>
            <Button variant="outline" className="mt-3" onClick={resetVerification}>Try Again</Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
