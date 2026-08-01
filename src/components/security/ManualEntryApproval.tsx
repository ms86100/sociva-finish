// @ts-nocheck
import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import { CheckCircle, XCircle, Clock, Shield } from 'lucide-react';

interface ManualRequest {
  id: string;
  flat_number: string;
  claimed_name: string;
  status: string;
  created_at: string;
}

export function ManualEntryApproval() {
  const { profile } = useAuth();
  const [requests, setRequests] = useState<ManualRequest[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!profile?.id) return;
    fetchRequests();

    // Subscribe to realtime changes for this resident
    const channel = supabase
      .channel('manual-entry-requests')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'manual_entry_requests',
          filter: `resident_id=eq.${profile.id}`,
        },
        () => fetchRequests()
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [profile?.id]);

  const fetchRequests = async () => {
    if (!profile?.id) return;
    const { data } = await supabase
      .from('manual_entry_requests')
      .select('*')
      .eq('resident_id', profile.id)
      .eq('status', 'pending')
      .order('created_at', { ascending: false })
      .limit(5);
    setRequests((data as ManualRequest[]) || []);
    setIsLoading(false);
  };

  const respondToRequest = async (requestId: string, approved: boolean) => {
    if (!profile?.id) return;
    const status = approved ? 'approved' : 'denied';
    const { error } = await supabase
      .from('manual_entry_requests')
      .update({
        status,
        responded_at: new Date().toISOString(),
      })
      .eq('id', requestId)
      .eq('resident_id', profile.id);

    if (error) {
      toast.error('Failed to respond');
      return;
    }

    toast.success(approved ? 'Entry approved' : 'Entry denied');
    fetchRequests();
  };

  if (isLoading || requests.length === 0) return null;

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Shield size={16} className="text-warning" />
        <h3 className="text-sm font-semibold">Gate Entry Requests</h3>
      </div>
      {requests.map((req) => (
        <Card key={req.id} className="border-warning/30 bg-warning/5">
          <CardContent className="p-4 space-y-3">
            <div className="flex items-start justify-between">
              <div>
                <p className="font-semibold text-sm">
                  Someone at the gate claims to be:
                </p>
                <p className="text-lg font-bold mt-1">"{req.claimed_name}"</p>
                <p className="text-xs text-muted-foreground mt-1">
                  Flat {req.flat_number} • {new Date(req.created_at).toLocaleTimeString()}
                </p>
              </div>
              <Badge variant="outline" className="shrink-0">
                <Clock size={10} className="mr-1" /> Pending
              </Badge>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Button
                variant="destructive"
                className="h-12"
                onClick={() => respondToRequest(req.id, false)}
              >
                <XCircle size={18} className="mr-2" /> Deny
              </Button>
              <Button
                className="h-12"
                onClick={() => respondToRequest(req.id, true)}
              >
                <CheckCircle size={18} className="mr-2" /> Approve
              </Button>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
