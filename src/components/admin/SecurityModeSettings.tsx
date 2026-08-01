// @ts-nocheck
import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import { logAudit } from '@/lib/audit';
import { Shield, Clock, Lock } from 'lucide-react';

export function SecurityModeSettings() {
  const { effectiveSocietyId, effectiveSociety } = useAuth();
  const [mode, setMode] = useState('basic');
  const [timeout, setTimeout_] = useState(20);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (!effectiveSocietyId) return;
    fetchSettings();
  }, [effectiveSocietyId]);

  const fetchSettings = async () => {
    if (!effectiveSocietyId) return;
    const { data } = await supabase
      .from('societies')
      .select('security_mode, security_confirmation_timeout_seconds')
      .eq('id', effectiveSocietyId)
      .single();
    if (data) {
      setMode(data.security_mode || 'basic');
      setTimeout_(data.security_confirmation_timeout_seconds || 20);
    }
  };

  const updateMode = async (newMode: string) => {
    if (!effectiveSocietyId) return;
    setIsSaving(true);
    setMode(newMode);
    const { error } = await supabase
      .from('societies')
      .update({ security_mode: newMode })
      .eq('id', effectiveSocietyId);
    if (error) {
      toast.error('Failed to update security mode');
    } else {
      await logAudit('security_mode_changed', 'society', effectiveSocietyId, effectiveSocietyId, { mode: newMode });
      toast.success(`Security mode set to ${newMode}`);
    }
    setIsSaving(false);
  };

  const updateTimeout = async (value: number) => {
    if (!effectiveSocietyId) return;
    const clamped = Math.min(Math.max(value, 10), 120);
    setTimeout_(clamped);
    const { error } = await supabase
      .from('societies')
      .update({ security_confirmation_timeout_seconds: clamped })
      .eq('id', effectiveSocietyId);
    if (error) {
      toast.error('Failed to update timeout');
    }
  };

  return (
    <Card className="border-0 shadow-[var(--shadow-card)] rounded-2xl">
      <CardContent className="p-4 space-y-4">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-xl bg-rose-500/10 flex items-center justify-center">
            <Shield size={15} className="text-rose-600" />
          </div>
          <h3 className="font-bold text-sm">Gate Security Mode</h3>
        </div>

        <div className="space-y-3">
          <div>
            <Label className="text-sm font-semibold">Security Level</Label>
            <Select value={mode} onValueChange={updateMode} disabled={isSaving}>
              <SelectTrigger className="mt-1.5 rounded-xl">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="basic">
                  <div className="flex items-center gap-2">
                    <span>🟢 Basic</span>
                    <span className="text-xs text-muted-foreground">— QR scan only</span>
                  </div>
                </SelectItem>
                <SelectItem value="confirmation">
                  <div className="flex items-center gap-2">
                    <span>🟡 Confirmation</span>
                    <span className="text-xs text-muted-foreground">— QR + resident approval</span>
                  </div>
                </SelectItem>
                <SelectItem value="ai_match" disabled>
                  <div className="flex items-center gap-2">
                    <span>🔴 AI Match</span>
                    <Badge variant="outline" className="text-[8px] h-4 gap-0.5 rounded-md">
                      <Lock size={8} /> Enterprise
                    </Badge>
                  </div>
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          {mode === 'confirmation' && (
            <div>
              <Label className="text-sm font-semibold flex items-center gap-1.5">
                <Clock size={12} /> Confirmation Timeout (seconds)
              </Label>
              <Input
                type="number"
                min={10}
                max={120}
                value={timeout}
                onChange={(e) => updateTimeout(parseInt(e.target.value) || 20)}
                className="mt-1.5 w-32 rounded-xl"
              />
              <p className="text-xs text-muted-foreground mt-1.5">
                How long to wait for resident response (10–120s)
              </p>
            </div>
          )}

          <div className="text-xs text-muted-foreground bg-muted/50 rounded-xl p-4 space-y-1">
            {mode === 'basic' && (
              <>
                <p><strong>Basic Mode:</strong> Guard scans QR → instant verification.</p>
                <p>Best for low-risk, daytime entry.</p>
              </>
            )}
            {mode === 'confirmation' && (
              <>
                <p><strong>Confirmation Mode:</strong> Guard scans QR → resident gets push notification → must confirm identity in app.</p>
                <p>Best for premium societies, night-time entry, or high-security periods.</p>
              </>
            )}
            {mode === 'ai_match' && (
              <p><strong>AI Match Mode:</strong> Future feature — camera snapshot matched against profile photo.</p>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
