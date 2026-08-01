// @ts-nocheck
import { useState, useEffect, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import { CheckCircle, XCircle, Clock, Shield, AlertTriangle } from 'lucide-react';

interface PendingConfirmation {
  id: string;
  entry_time: string;
  confirmation_expires_at: string;
  confirmation_status: string;
}

export function ResidentConfirmation() {
  const { profile, effectiveSocietyId } = useAuth();
  const [pending, setPending] = useState<PendingConfirmation[]>([]);
  const [timeLeftMap, setTimeLeftMap] = useState<Record<string, number>>({});
  const fetchingRef = useRef(false);

  const fetchPending = async () => {
    if (!profile?.id || fetchingRef.current) return;
    fetchingRef.current = true;
    try {
      const { data } = await supabase
        .from('gate_entries')
        .select('id, entry_time, confirmation_expires_at, confirmation_status')
        .eq('user_id', profile.id)
        .eq('awaiting_confirmation', true)
        .eq('confirmation_status', 'pending')
        .gt('confirmation_expires_at', new Date().toISOString())
        .order('entry_time', { ascending: false })
        .limit(5);
      setPending((data as PendingConfirmation[]) || []);
    } finally {
      fetchingRef.current = false;
    }
  };

  // Realtime subscription
  useEffect(() => {
    if (!profile?.id || !effectiveSocietyId) return;
    fetchPending();

    const channel = supabase
      .channel('gate-confirmation')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'gate_entries',
          filter: `user_id=eq.${profile.id}`,
        },
        () => fetchPending()
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [profile?.id, effectiveSocietyId]);

  // GA BLOCKER 1: Fallback polling every 5 seconds while pending entries exist
  useEffect(() => {
    if (!profile?.id) return;

    const pollInterval = setInterval(() => {
      fetchPending();
    }, 5000);

    return () => clearInterval(pollInterval);
  }, [profile?.id]);

  // Countdown timer for all pending entries
  useEffect(() => {
    if (pending.length === 0) return;
    const interval = setInterval(() => {
      const now = Date.now();
      const newMap: Record<string, number> = {};
      let anyExpired = false;
      for (const entry of pending) {
        const expiresAt = new Date(entry.confirmation_expires_at).getTime();
        const left = Math.max(0, Math.ceil((expiresAt - now) / 1000));
        newMap[entry.id] = left;
        if (left === 0) anyExpired = true;
      }
      setTimeLeftMap(newMap);
      if (anyExpired) fetchPending();
    }, 1000);
    return () => clearInterval(interval);
  }, [pending]);

  const respond = async (entryId: string, approved: boolean) => {
    const now = new Date().toISOString();
    const { error } = await supabase
      .from('gate_entries')
      .update({
        confirmation_status: approved ? 'confirmed' : 'denied',
        awaiting_confirmation: false,
        ...(approved
          ? { confirmed_by_resident_at: now }
          : { confirmation_denied_at: now }),
      })
      .eq('id', entryId)
      .eq('user_id', profile?.id);

    if (error) {
      // RLS blocks updates after expiry — inform user
      if (error.code === '42501' || error.message?.includes('row-level security')) {
        toast.error('This entry has expired and can no longer be confirmed.');
      } else {
        toast.error('Failed to respond');
      }
      fetchPending();
      return;
    }

    toast.success(approved ? 'Entry confirmed' : 'Entry denied');
    fetchPending();
  };

  if (pending.length === 0) return null;

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <AlertTriangle size={16} className="text-warning" />
        <h3 className="text-sm font-semibold">Confirm Your Entry</h3>
      </div>
      {pending.map((entry) => {
        const timeLeft = timeLeftMap[entry.id] ?? 0;
        return (
          <Card key={entry.id} className="border-2 border-warning/30 bg-warning/5">
            <CardContent className="p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Shield size={20} className="text-primary" />
                  <div>
                    <p className="font-semibold text-sm">Are you at the gate?</p>
                    <p className="text-xs text-muted-foreground">
                      Security scanned your QR code
                    </p>
                  </div>
                </div>
                <Badge variant={timeLeft <= 5 ? 'destructive' : 'secondary'} className="gap-1">
                  <Clock size={10} />
                  {timeLeft}s
                </Badge>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Button
                  variant="destructive"
                  className="h-12"
                  onClick={() => respond(entry.id, false)}
                >
                  <XCircle size={18} className="mr-2" /> Not Me
                </Button>
                <Button
                  className="h-12"
                  onClick={() => respond(entry.id, true)}
                >
                  <CheckCircle size={18} className="mr-2" /> Yes, It's Me
                </Button>
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}