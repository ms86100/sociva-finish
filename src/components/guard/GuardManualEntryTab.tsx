// @ts-nocheck
import { useState, useEffect, useRef } from 'react';
import { supabase, SUPABASE_URL } from '@/integrations/supabase/client';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import { AlertTriangle, Send, CheckCircle, XCircle, Clock, Loader2 } from 'lucide-react';
import { notify } from '@/lib/notify';

interface Props {
  societyId: string;
}

export function GuardManualEntryTab({ societyId }: Props) {
  const { profile } = useAuth();
  const [flatInput, setFlatInput] = useState('');
  const [nameInput, setNameInput] = useState('');
  const [manualStatus, setManualStatus] = useState<'idle' | 'sent' | 'approved' | 'denied' | 'expired'>('idle');
  const [isSending, setIsSending] = useState(false);
  const manualRequestIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (manualStatus !== 'sent' || !manualRequestIdRef.current) return;
    const channel = supabase
      .channel(`manual-entry-${manualRequestIdRef.current}`)
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'manual_entry_requests',
        filter: `id=eq.${manualRequestIdRef.current}`,
      }, (payload) => {
        const newStatus = (payload.new as any).status;
        if (newStatus === 'approved') { setManualStatus('approved'); toast.success('✅ Entry approved by resident!'); }
        else if (newStatus === 'denied') { setManualStatus('denied'); toast.error('❌ Entry denied by resident'); }
        else if (newStatus === 'expired') { setManualStatus('expired'); toast.warning('⏰ Request expired'); }
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [manualStatus]);

  const handleManualEntry = async () => {
    if (!flatInput.trim() || !nameInput.trim() || !societyId || !profile) return;
    setIsSending(true);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { notify.block('Please log in'); return; }

      const rlResponse = await fetch(
        `${SUPABASE_URL}/functions/v1/gate-token?action=rate_check_manual`,
        { method: 'POST', headers: { 'Authorization': `Bearer ${session.access_token}`, 'Content-Type': 'application/json' }, body: '{}' }
      );
      if (rlResponse.status === 429) { toast.error('Too many requests. Please wait.'); return; }

      const { data: resident } = await supabase
        .from('profiles')
        .select('id, name')
        .eq('society_id', societyId)
        .eq('flat_number', flatInput.trim())
        .eq('verification_status', 'approved')
        .maybeSingle();

      const { data: insertData, error } = await supabase.from('manual_entry_requests').insert({
        society_id: societyId,
        flat_number: flatInput.trim(),
        claimed_name: nameInput.trim(),
        requested_by: profile.id,
        resident_id: resident?.id || null,
        status: 'pending',
      }).select('id').single();

      if (error) throw error;
      manualRequestIdRef.current = insertData?.id || null;
      setManualStatus('sent');
      toast.success('Verification request sent to resident');

      if (resident?.id) {
        await supabase.from('notification_queue').insert({
          user_id: resident.id,
          title: '🚨 Gate Entry Request',
          body: `Someone claiming to be "${nameInput.trim()}" is requesting entry. Approve?`,
          type: 'gate_manual_entry',
          reference_path: '/gate-entry',
        });
      }
    } catch {
      toast.error('Failed to send request');
    } finally {
      setIsSending(false);
    }
  };

  const reset = () => {
    setManualStatus('idle');
    setFlatInput('');
    setNameInput('');
    manualRequestIdRef.current = null;
  };

  return (
    <div className="space-y-4">
      <Card className="border-2 border-warning/30">
        <CardContent className="p-6 space-y-4">
          <div className="text-center">
            <AlertTriangle className="mx-auto text-warning mb-2" size={40} />
            <h2 className="text-xl font-bold">Manual Verification</h2>
            <p className="text-sm text-muted-foreground">When visitor has no OTP or resident forgot phone</p>
          </div>
          <Input value={flatInput} onChange={e => setFlatInput(e.target.value)} placeholder="Enter flat number" className="h-14 text-center text-lg" />
          <Input value={nameInput} onChange={e => setNameInput(e.target.value)} placeholder="Person's claimed name" className="h-14 text-center text-lg" />
          <Button onClick={handleManualEntry} disabled={!flatInput.trim() || !nameInput.trim() || manualStatus === 'sent' || isSending} className="w-full h-14 text-lg" variant="outline">
            {isSending ? <Loader2 size={20} className="mr-2 animate-spin" /> : <Send size={20} className="mr-2" />}
            {manualStatus === 'sent' ? 'Request Sent — Waiting...' : 'Send to Resident'}
          </Button>
        </CardContent>
      </Card>

      {manualStatus === 'sent' && (
        <Card className="bg-muted/50">
          <CardContent className="p-6 text-center">
            <Clock className="mx-auto text-muted-foreground mb-2 animate-pulse" size={24} />
            <p className="text-sm font-medium">Waiting for resident confirmation...</p>
          </CardContent>
        </Card>
      )}
      {manualStatus === 'approved' && (
        <Card className="border-success/50 bg-success/5">
          <CardContent className="p-4 text-center">
            <CheckCircle className="mx-auto text-success mb-2" size={48} />
            <p className="text-xl font-bold text-success">APPROVED</p>
            <Button variant="outline" className="mt-3" onClick={reset}>Next Entry</Button>
          </CardContent>
        </Card>
      )}
      {manualStatus === 'denied' && (
        <Card className="border-destructive/50 bg-destructive/5">
          <CardContent className="p-4 text-center">
            <XCircle className="mx-auto text-destructive mb-2" size={48} />
            <p className="text-xl font-bold text-destructive">DENIED</p>
            <Button variant="outline" className="mt-3" onClick={reset}>Next Entry</Button>
          </CardContent>
        </Card>
      )}
      {manualStatus === 'expired' && (
        <Card className="border-warning/50 bg-warning/5">
          <CardContent className="p-4 text-center">
            <Clock className="mx-auto text-warning mb-2" size={48} />
            <p className="text-xl font-bold text-warning">EXPIRED</p>
            <Button variant="outline" className="mt-3" onClick={reset}>Try Again</Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
