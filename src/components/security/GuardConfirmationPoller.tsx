// @ts-nocheck
import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { CheckCircle, XCircle, Clock, Loader2 } from 'lucide-react';

interface GuardConfirmationPollerProps {
  entryId: string;
  timeoutSeconds: number;
  residentName: string;
  flatNumber: string;
  block: string;
  onComplete: (status: 'confirmed' | 'denied' | 'expired') => void;
}

export function GuardConfirmationPoller({
  entryId,
  timeoutSeconds,
  residentName,
  flatNumber,
  block,
  onComplete,
}: GuardConfirmationPollerProps) {
  const [timeLeft, setTimeLeft] = useState(timeoutSeconds);
  const [status, setStatus] = useState<'waiting' | 'confirmed' | 'denied' | 'expired'>('waiting');
  const resolvedRef = useRef(false);

  const handleResolution = useCallback((newStatus: 'confirmed' | 'denied' | 'expired') => {
    if (resolvedRef.current) return; // Prevent duplicate toasts from realtime + poll race
    resolvedRef.current = true;
    setStatus(newStatus);
    onComplete(newStatus);
  }, [onComplete]);

  // Realtime subscription
  useEffect(() => {
    const channel = supabase
      .channel(`gate-entry-${entryId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'gate_entries',
          filter: `id=eq.${entryId}`,
        },
        (payload) => {
          const newStatus = payload.new.confirmation_status;
          if (newStatus === 'confirmed') handleResolution('confirmed');
          else if (newStatus === 'denied') handleResolution('denied');
        }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [entryId, handleResolution]);

  // GA BLOCKER 1: Fallback polling every 4 seconds
  useEffect(() => {
    if (status !== 'waiting') return;

    const pollInterval = setInterval(async () => {
      if (resolvedRef.current) return;
      try {
        const { data } = await supabase
          .from('gate_entries')
          .select('confirmation_status')
          .eq('id', entryId)
          .single();

        if (!data || resolvedRef.current) return;
        if (data.confirmation_status === 'confirmed') handleResolution('confirmed');
        else if (data.confirmation_status === 'denied') handleResolution('denied');
      } catch {
        // Silently ignore poll errors — realtime is primary
      }
    }, 4000);

    return () => clearInterval(pollInterval);
  }, [entryId, status, handleResolution]);

  // Countdown
  useEffect(() => {
    if (status !== 'waiting') return;
    if (timeLeft <= 0) {
      handleResolution('expired');
      return;
    }
    const timer = setTimeout(() => setTimeLeft(t => t - 1), 1000);
    return () => clearTimeout(timer);
  }, [timeLeft, status, handleResolution]);

  if (status === 'confirmed') {
    return (
      <Card className="border-2 border-success/50 bg-success/5">
        <CardContent className="p-6 text-center space-y-2">
          <CheckCircle className="mx-auto text-success" size={64} />
          <p className="text-2xl font-bold text-success">CONFIRMED</p>
          <p className="text-sm text-muted-foreground">
            {residentName} confirmed their identity
          </p>
          <p className="text-xs text-muted-foreground">
            Block {block}, Flat {flatNumber}
          </p>
        </CardContent>
      </Card>
    );
  }

  if (status === 'denied') {
    return (
      <Card className="border-2 border-destructive/50 bg-destructive/5">
        <CardContent className="p-6 text-center space-y-2">
          <XCircle className="mx-auto text-destructive" size={64} />
          <p className="text-2xl font-bold text-destructive">DENIED</p>
          <p className="text-sm text-muted-foreground">
            Resident denied this entry. Do NOT allow access.
          </p>
        </CardContent>
      </Card>
    );
  }

  if (status === 'expired') {
    return (
      <Card className="border-2 border-warning/50 bg-warning/5">
        <CardContent className="p-6 text-center space-y-2">
          <Clock className="mx-auto text-warning" size={64} />
          <p className="text-2xl font-bold text-warning">NO RESPONSE</p>
          <p className="text-sm text-muted-foreground">
            Resident did not respond. QR was valid — use judgment.
          </p>
          <p className="text-xs text-muted-foreground">
            {residentName} • Block {block}, Flat {flatNumber}
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-2 border-primary/30">
      <CardContent className="p-6 text-center space-y-4">
        <Loader2 className="mx-auto text-primary animate-spin" size={48} />
        <p className="text-xl font-bold">Waiting for Resident</p>
        <p className="text-sm text-muted-foreground">
          {residentName} • Block {block}, Flat {flatNumber}
        </p>
        <Badge variant={timeLeft <= 5 ? 'destructive' : 'secondary'} className="text-lg gap-2 px-4 py-1">
          <Clock size={14} />
          {timeLeft}s
        </Badge>
        <p className="text-xs text-muted-foreground">
          Resident has been notified to confirm
        </p>
      </CardContent>
    </Card>
  );
}