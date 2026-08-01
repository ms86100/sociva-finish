// @ts-nocheck
import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Send, Smartphone, Monitor, Users, Loader2, CheckCircle2, XCircle, Trash2 } from 'lucide-react';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';
import { motion } from 'framer-motion';

const SCREEN_OPTIONS = [
  { value: '', label: 'None (default)' },
  { value: 'offers', label: 'Offers' },
  { value: 'orders', label: 'Orders' },
  { value: 'bulletin', label: 'Bulletin' },
  { value: 'marketplace', label: 'Marketplace' },
  { value: 'profile', label: 'Profile' },
];

const PLATFORM_OPTIONS = [
  { value: 'all', label: 'All Devices', icon: Monitor },
  { value: 'ios', label: 'iOS Only', icon: Smartphone },
  { value: 'android', label: 'Android Only', icon: Smartphone },
];

interface CampaignResult {
  campaign_id: string;
  targeted: number;
  sent: number;
  failed: number;
  cleaned: number;
}

interface CampaignRow {
  id: string;
  title: string;
  body: string;
  target_platform: string;
  status: string;
  targeted_count: number;
  sent_count: number;
  failed_count: number;
  cleaned_count: number;
  created_at: string;
  completed_at: string | null;
}

export function CampaignSender() {
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [screen, setScreen] = useState('');
  const [platform, setPlatform] = useState('all');
  const [societyId, setSocietyId] = useState<string>('');
  const [societies, setSocieties] = useState<{ id: string; name: string }[]>([]);
  const [deviceCount, setDeviceCount] = useState<number | null>(null);
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<CampaignResult | null>(null);
  const [history, setHistory] = useState<CampaignRow[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(true);

  // Load societies list
  useEffect(() => {
    supabase
      .from('societies')
      .select('id, name')
      .eq('is_active', true)
      .order('name')
      .then(({ data }) => {
        if (data) setSocieties(data);
      });
  }, []);

  // Load campaign history
  useEffect(() => {
    loadHistory();
  }, []);

  async function loadHistory() {
    setLoadingHistory(true);
    const { data } = await supabase
      .from('campaigns' as any)
      .select('id, title, body, target_platform, status, targeted_count, sent_count, failed_count, cleaned_count, created_at, completed_at')
      .order('created_at', { ascending: false })
      .limit(20);
    if (data) setHistory(data as any);
    setLoadingHistory(false);
  }

  // Preview device count when filters change
  useEffect(() => {
    const timer = setTimeout(async () => {
      let query = supabase
        .from('device_tokens')
        .select('id', { count: 'exact', head: true });

      if (platform === 'ios') query = query.eq('platform', 'ios');
      else if (platform === 'android') query = query.eq('platform', 'android');

      const { count } = await query;
      setDeviceCount(count ?? 0);
    }, 300);
    return () => clearTimeout(timer);
  }, [platform]);

  async function handleSend() {
    if (!title.trim() || !body.trim()) {
      toast.error('Title and body are required');
      return;
    }

    setSending(true);
    setResult(null);

    try {
      const payload: any = {
        title: title.trim(),
        body: body.trim(),
        target: {
          platform,
          user_ids: [],
          society_id: societyId || null,
        },
      };

      if (screen) {
        payload.data = { screen, type: 'campaign' };
      }

      const { data, error } = await supabase.functions.invoke('send-campaign', {
        body: payload,
      });

      if (error) throw error;

      setResult(data as CampaignResult);
      toast.success(`Campaign sent to ${data.sent} devices`);
      setTitle('');
      setBody('');
      setScreen('');
      loadHistory();
    } catch (err: any) {
      toast.error(err.message || 'Failed to send campaign');
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="space-y-5">
      {/* ── Compose Form ── */}
      <Card className="border-0 shadow-[var(--shadow-card)] rounded-2xl">
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-bold flex items-center gap-2">
            <Send size={16} className="text-primary" />
            Send Campaign
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold">Title *</Label>
            <Input
              placeholder="e.g. Flash Sale — 50% Off!"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="rounded-xl"
              maxLength={100}
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs font-semibold">Body *</Label>
            <Textarea
              placeholder="e.g. Hurry — sale ends at midnight!"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              className="rounded-xl min-h-[80px]"
              maxLength={500}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">Deep Link Screen</Label>
              <Select value={screen} onValueChange={setScreen}>
                <SelectTrigger className="rounded-xl text-xs">
                  <SelectValue placeholder="None" />
                </SelectTrigger>
                <SelectContent>
                  {SCREEN_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value || '_none'}>{o.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">Platform</Label>
              <Select value={platform} onValueChange={setPlatform}>
                <SelectTrigger className="rounded-xl text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PLATFORM_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs font-semibold">Target Society</Label>
            <Select value={societyId || '_all'} onValueChange={(v) => setSocietyId(v === '_all' ? '' : v)}>
              <SelectTrigger className="rounded-xl text-xs">
                <SelectValue placeholder="All societies" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="_all">All Societies</SelectItem>
                {societies.map((s) => (
                  <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Device count preview */}
          <div className="flex items-center justify-between pt-2 border-t border-border/30">
            <div className="flex items-center gap-2">
              <Users size={14} className="text-muted-foreground" />
              <span className="text-xs text-muted-foreground font-medium">
                {deviceCount !== null ? (
                  <>Will send to <span className="font-bold text-foreground">{deviceCount}</span> device{deviceCount !== 1 ? 's' : ''}</>
                ) : (
                  'Counting devices…'
                )}
              </span>
            </div>

            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  disabled={sending || !title.trim() || !body.trim() || deviceCount === 0}
                  className="rounded-xl font-semibold gap-2"
                  size="sm"
                >
                  {sending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                  {sending ? 'Sending…' : 'Send Campaign'}
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent className="rounded-2xl">
                <AlertDialogHeader>
                  <AlertDialogTitle className="font-bold">Send Campaign?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This will send a push notification to <strong>{deviceCount}</strong> device{deviceCount !== 1 ? 's' : ''}.
                    <br /><br />
                    <strong>Title:</strong> {title}<br />
                    <strong>Body:</strong> {body}
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel className="rounded-xl">Cancel</AlertDialogCancel>
                  <AlertDialogAction className="rounded-xl font-semibold" onClick={handleSend}>
                    Send to {deviceCount} devices
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </CardContent>
      </Card>

      {/* ── Result ── */}
      {result && (
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
          <Card className="border-0 shadow-[var(--shadow-card)] rounded-2xl bg-emerald-50 dark:bg-emerald-950/20">
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-3">
                <CheckCircle2 size={16} className="text-emerald-600" />
                <span className="text-sm font-bold text-emerald-700 dark:text-emerald-400">Campaign Sent</span>
              </div>
              <div className="grid grid-cols-4 gap-3 text-center">
                <div>
                  <p className="text-lg font-extrabold">{result.targeted}</p>
                  <p className="text-[10px] text-muted-foreground font-semibold uppercase">Targeted</p>
                </div>
                <div>
                  <p className="text-lg font-extrabold text-emerald-600">{result.sent}</p>
                  <p className="text-[10px] text-muted-foreground font-semibold uppercase">Sent</p>
                </div>
                <div>
                  <p className="text-lg font-extrabold text-destructive">{result.failed}</p>
                  <p className="text-[10px] text-muted-foreground font-semibold uppercase">Failed</p>
                </div>
                <div>
                  <p className="text-lg font-extrabold text-amber-600">{result.cleaned}</p>
                  <p className="text-[10px] text-muted-foreground font-semibold uppercase">Cleaned</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </motion.div>
      )}

      {/* ── History ── */}
      <Card className="border-0 shadow-[var(--shadow-card)] rounded-2xl">
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-bold">Campaign History</CardTitle>
        </CardHeader>
        <CardContent>
          {loadingHistory ? (
            <p className="text-xs text-muted-foreground py-8 text-center">Loading…</p>
          ) : history.length === 0 ? (
            <p className="text-xs text-muted-foreground py-8 text-center">No campaigns sent yet</p>
          ) : (
            <div className="space-y-2.5">
              {history.map((c) => (
                <div
                  key={c.id}
                  className="flex items-start justify-between p-3 rounded-xl bg-muted/40 hover:bg-muted/60 transition-colors"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-bold truncate">{c.title}</p>
                    <p className="text-xs text-muted-foreground line-clamp-1 mt-0.5">{c.body}</p>
                    <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                      <Badge variant="secondary" className="text-[10px] h-5 rounded-md">{c.target_platform}</Badge>
                      <Badge
                        variant={c.status === 'completed' ? 'default' : c.status === 'failed' ? 'destructive' : 'secondary'}
                        className="text-[10px] h-5 rounded-md"
                      >
                        {c.status}
                      </Badge>
                      <span className="text-[10px] text-muted-foreground">
                        {format(new Date(c.created_at), 'MMM d, h:mm a')}
                      </span>
                    </div>
                  </div>
                  <div className="text-right shrink-0 ml-3">
                    <p className="text-xs font-bold">{c.sent_count}/{c.targeted_count}</p>
                    <p className="text-[10px] text-muted-foreground">delivered</p>
                    {c.cleaned_count > 0 && (
                      <div className="flex items-center gap-1 mt-0.5 justify-end">
                        <Trash2 size={10} className="text-amber-500" />
                        <span className="text-[10px] text-amber-600">{c.cleaned_count}</span>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
