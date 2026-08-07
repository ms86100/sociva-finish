// @ts-nocheck
import { useState, useEffect, useCallback } from 'react';
import { supabase, SUPABASE_URL } from '@/integrations/supabase/client';
import { AppLayout } from '@/components/layout/AppLayout';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useAuth } from '@/contexts/AuthContext';
import { QrCode, RefreshCw, Shield, Clock, CheckCircle } from 'lucide-react';
import { toast } from 'sonner';
import { friendlyError } from '@/lib/utils';
import { FeatureGate } from '@/components/ui/FeatureGate';
import QRCode from '@/components/security/QRCodeDisplay';
import { ManualEntryApproval } from '@/components/security/ManualEntryApproval';
import { ResidentConfirmation } from '@/components/security/ResidentConfirmation';
import { notify } from '@/lib/notify';

export default function GateEntryPage() {
  const { profile, effectiveSocietyId } = useAuth();
  const [token, setToken] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<number>(0);
  const [timeLeft, setTimeLeft] = useState(0);
  const [isGenerating, setIsGenerating] = useState(false);
  const [recentEntries, setRecentEntries] = useState<any[]>([]);

  const generateToken = useCallback(async () => {
    setIsGenerating(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { notify.block('Please log in'); return; }

      const response = await fetch(
        `${SUPABASE_URL}/functions/v1/gate-token?action=generate`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${session.access_token}`,
            'Content-Type': 'application/json',
          },
        }
      );

      const result = await response.json();
      if (!response.ok) throw new Error(result.error);

      setToken(result.token);
      setExpiresAt(result.expires_at);
      setTimeLeft(60);
    } catch (error: any) {
      toast.error(friendlyError(error));
    } finally {
      setIsGenerating(false);
    }
  }, []);

  // Countdown timer with auto-refresh
  useEffect(() => {
    if (timeLeft <= 0) { setToken(null); return; }
    const interval = setInterval(() => {
      setTimeLeft(prev => {
        if (prev <= 1) { setToken(null); return 0; }
        if (prev === 6) { generateToken(); }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [timeLeft, generateToken]);

  // Fetch recent entries
  useEffect(() => {
    if (!profile?.id) return;
    if (!effectiveSocietyId) return;
    supabase
      .from('gate_entries')
      .select('*')
      .eq('user_id', profile.id)
      .eq('society_id', effectiveSocietyId)
      .order('entry_time', { ascending: false })
      .limit(5)
      .then(({ data }) => setRecentEntries(data || []));
  }, [profile?.id, effectiveSocietyId]);

  return (
    <AppLayout headerTitle="Gate Entry" showLocation={false}>
      <FeatureGate feature={["gate_entry", "visitor_management"]}>
      <div className="p-4 space-y-4">
        {/* Resident Confirmation (for confirmation mode) */}
        <ResidentConfirmation />

        {/* QR Code Card */}
        <Card className="border-2 border-primary/20">
          <CardContent className="p-6 text-center space-y-4">
            <div>
              <Shield className="mx-auto text-primary mb-2" size={32} />
              <h2 className="text-lg font-bold">Digital Gate Pass</h2>
              <p className="text-sm text-muted-foreground">
                Show this code to the security guard
              </p>
            </div>

            {token ? (
              <div className="space-y-3">
                <QRCode value={token} size={220} />
                
                <div className="flex items-center justify-center gap-2">
                  <Clock size={16} className={timeLeft <= 10 ? 'text-destructive' : 'text-muted-foreground'} />
                  <span className={`text-2xl font-mono font-bold tabular-nums ${timeLeft <= 10 ? 'text-destructive animate-pulse' : 'text-foreground'}`}>
                    {timeLeft}s
                  </span>
                </div>
                
                <Badge variant={timeLeft <= 10 ? 'destructive' : 'secondary'} className="text-xs">
                  {timeLeft <= 10 ? 'Expiring soon!' : 'Valid — show to guard'}
                </Badge>

                <Button
                  variant="outline"
                  className="w-full"
                  onClick={generateToken}
                  disabled={isGenerating}
                >
                  <RefreshCw size={16} className="mr-2" />
                  Refresh Code
                </Button>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="w-56 h-56 mx-auto bg-muted rounded-xl flex items-center justify-center">
                  <QrCode size={64} className="text-muted-foreground/30" />
                </div>
                <Button
                  onClick={generateToken}
                  disabled={isGenerating}
                  className="w-full h-14 text-lg"
                  size="lg"
                >
                  {isGenerating ? (
                    <RefreshCw size={20} className="mr-2 animate-spin" />
                  ) : (
                    <Shield size={20} className="mr-2" />
                  )}
                  Generate Gate Code
                </Button>
              </div>
            )}

            <div className="pt-2 border-t">
              <p className="text-xs text-muted-foreground">
                {profile?.name} • Block {profile?.block}, Flat {profile?.flat_number}
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Manual Entry Approval */}
        <ManualEntryApproval />

        {/* Recent Entries */}
        {recentEntries.length > 0 && (
          <div>
            <h3 className="text-sm font-semibold text-muted-foreground mb-2">Recent Entries</h3>
            <div className="space-y-2">
              {recentEntries.map(entry => (
                <Card key={entry.id}>
                  <CardContent className="p-3 flex items-center gap-3">
                    <CheckCircle size={16} className="text-success shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium capitalize">{entry.entry_type.replace('_', ' ')}</p>
                      <p className="text-xs text-muted-foreground">
                        {new Date(entry.entry_time).toLocaleString()}
                      </p>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        )}
      </div>
      </FeatureGate>
    </AppLayout>
  );
}
