// @ts-nocheck
import { useCallback, useEffect, useRef, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { adminNotify } from '@/lib/admin-notify';
import { Send, Smartphone, Monitor, Users, Loader2, CheckCircle2, Trash2 } from 'lucide-react';
import { format } from 'date-fns';
import { cn, friendlyError } from '@/lib/utils';
import { motion } from 'framer-motion';
import { CampaignPhonePreview } from '@/components/admin/campaign/CampaignPhonePreview';
import {
  CampaignDeepLinkPicker,
  emptyDeepLink,
  type CampaignDeepLinkValue,
} from '@/components/admin/campaign/CampaignDeepLinkPicker';
import {
  CampaignAudiencePicker,
  type AudienceMode,
} from '@/components/admin/campaign/CampaignAudiencePicker';

const TITLE_MAX = 65;
const BODY_MAX = 180;
const BODY_WARN = 150;

const EMOJIS = ['🍗', '🔥', '🎉', '🎟️', '👉', '✨', '🛒', '😋', '⚡', '🏠'];

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
  whatsapp_queued?: number;
}

interface CampaignRow {
  id: string;
  title: string;
  body: string;
  target_platform: string;
  target_audience?: string;
  status: string;
  targeted_count: number;
  sent_count: number;
  failed_count: number;
  cleaned_count: number;
  created_at: string;
  completed_at: string | null;
  data?: Record<string, string> | null;
}

function insertAtCursor(
  value: string,
  insert: string,
  el: HTMLInputElement | HTMLTextAreaElement | null,
  setValue: (v: string) => void,
  max: number,
) {
  if (!el) {
    setValue((value + insert).slice(0, max));
    return;
  }
  const start = el.selectionStart ?? value.length;
  const end = el.selectionEnd ?? value.length;
  const next = `${value.slice(0, start)}${insert}${value.slice(end)}`.slice(0, max);
  setValue(next);
  requestAnimationFrame(() => {
    const pos = Math.min(start + insert.length, next.length);
    el.setSelectionRange(pos, pos);
    el.focus();
  });
}

export function CampaignSender() {
  const { user } = useAuth();
  const titleRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);

  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [coupon, setCoupon] = useState('');
  const [emojiTarget, setEmojiTarget] = useState<'title' | 'body'>('body');
  const [deepLink, setDeepLink] = useState<CampaignDeepLinkValue>(emptyDeepLink());
  const [platform, setPlatform] = useState('all');
  const [audienceMode, setAudienceMode] = useState<AudienceMode>('never_ordered');
  const [societyId, setSocietyId] = useState('');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [societies, setSocieties] = useState<{ id: string; name: string }[]>([]);

  const [previewUsers, setPreviewUsers] = useState(0);
  const [previewDevices, setPreviewDevices] = useState(0);
  const [resolvedUserIds, setResolvedUserIds] = useState<string[]>([]);
  const [counting, setCounting] = useState(false);

  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<CampaignResult | null>(null);
  const [history, setHistory] = useState<CampaignRow[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmTyped, setConfirmTyped] = useState('');

  useEffect(() => {
    supabase
      .from('societies')
      .select('id, name')
      .eq('is_active', true)
      .order('name')
      .then(({ data }) => {
        if (data) setSocieties(data);
      });
    loadHistory();
  }, []);

  async function loadHistory() {
    setLoadingHistory(true);
    const { data } = await supabase
      .from('campaigns' as any)
      .select('id, title, body, target_platform, target_audience, status, targeted_count, sent_count, failed_count, cleaned_count, created_at, completed_at, data')
      .order('created_at', { ascending: false })
      .limit(20);
    if (data) setHistory(data as any);
    setLoadingHistory(false);
  }

  const refreshCount = useCallback(async () => {
    setCounting(true);
    try {
      if (audienceMode === 'pick') {
        const tokenIds = selectedIds;
        if (tokenIds.length === 0) {
          setPreviewUsers(0);
          setPreviewDevices(0);
          setResolvedUserIds([]);
          return;
        }
        const { data, error } = await supabase.rpc('admin_campaign_audience_preview' as any, {
          _platform: platform,
          _society_id: societyId || null,
          _never_ordered: false,
          _user_ids: tokenIds,
          _exclude_user_id: null,
        });
        if (error) throw error;
        const row = Array.isArray(data) ? data[0] : data;
        setPreviewUsers(row?.user_count ?? 0);
        setPreviewDevices(row?.device_count ?? 0);
        setResolvedUserIds(row?.user_ids || tokenIds);
        return;
      }

      if (audienceMode === 'society' && !societyId) {
        setPreviewUsers(0);
        setPreviewDevices(0);
        setResolvedUserIds([]);
        return;
      }

      const { data, error } = await supabase.rpc('admin_campaign_audience_preview' as any, {
        _platform: platform,
        _society_id: audienceMode === 'society' ? societyId : null,
        _never_ordered: audienceMode === 'never_ordered',
        _user_ids: null,
        _exclude_user_id: audienceMode === 'never_ordered' ? (user?.id || null) : null,
      });
      if (error) throw error;
      const row = Array.isArray(data) ? data[0] : data;
      setPreviewUsers(row?.user_count ?? 0);
      setPreviewDevices(row?.device_count ?? 0);
      setResolvedUserIds(row?.user_ids || []);
    } catch (err) {
      console.warn('audience preview failed', err);
      setPreviewUsers(0);
      setPreviewDevices(0);
      setResolvedUserIds([]);
    } finally {
      setCounting(false);
    }
  }, [audienceMode, platform, societyId, selectedIds, user?.id]);

  useEffect(() => {
    const t = setTimeout(() => {
      void refreshCount();
    }, 300);
    return () => clearTimeout(t);
  }, [refreshCount]);

  const needsTypedConfirm = previewUsers > 50;
  const canCompose = title.trim().length > 0 && body.trim().length > 0;
  const deepLinkReady =
    deepLink.kind === 'none' ||
    (deepLink.kind === 'screen' && !!deepLink.referencePath) ||
    (deepLink.kind === 'store' && !!deepLink.sellerId) ||
    (deepLink.kind === 'product' && !!deepLink.productId);

  const audienceReady =
    (audienceMode === 'all') ||
    (audienceMode === 'society' && !!societyId) ||
    (audienceMode === 'never_ordered') ||
    (audienceMode === 'pick' && selectedIds.length > 0);

  const canSend = canCompose && deepLinkReady && audienceReady && previewDevices > 0 && !sending;

  function buildDataPayload(): Record<string, string> {
    const data: Record<string, string> = {
      type: 'campaign',
      audience_preset: audienceMode,
    };
    if (deepLink.referencePath) {
      data.reference_path = deepLink.referencePath;
      data.route = deepLink.referencePath;
    }
    if (deepLink.screen) data.screen = deepLink.screen;
    if (deepLink.sellerId) data.seller_id = deepLink.sellerId;
    if (deepLink.productId) data.product_id = deepLink.productId;
    if (coupon.trim()) data.coupon = coupon.trim();
    return data;
  }

  function buildTarget(forTestMe = false) {
    if (forTestMe) {
      return {
        platform,
        user_ids: user?.id ? [user.id] : [],
        society_id: null,
      };
    }
    if (audienceMode === 'all') {
      return { platform, user_ids: [], society_id: null };
    }
    if (audienceMode === 'society') {
      return { platform, user_ids: [], society_id: societyId || null };
    }
    // never_ordered + pick: explicit IDs so count matches send
    return {
      platform,
      user_ids: resolvedUserIds.length > 0 ? resolvedUserIds : selectedIds,
      society_id: null,
    };
  }

  async function invokeSend(opts: { testMe?: boolean } = {}) {
    if (!canCompose) {
      adminNotify.error('Title and body are required');
      return;
    }
    if (!opts.testMe && !canSend) {
      adminNotify.error('Fix audience / deep link before sending');
      return;
    }
    if (opts.testMe && !user?.id) {
      adminNotify.error('Not signed in');
      return;
    }

    setSending(true);
    setResult(null);
    try {
      const payload = {
        title: title.trim(),
        body: body.trim(),
        data: buildDataPayload(),
        target: buildTarget(!!opts.testMe),
      };
      const { data, error } = await supabase.functions.invoke('send-campaign', { body: payload });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      setResult(data as CampaignResult);
      adminNotify.success(
        opts.testMe
          ? `Test sent to your device (${data.sent || 0})`
          : `Campaign sent to ${data.sent} devices`,
      );
      if (!opts.testMe) {
        setConfirmOpen(false);
        setConfirmTyped('');
        loadHistory();
      }
    } catch (err: any) {
      adminNotify.error(friendlyError(err) || 'Failed to send campaign');
    } finally {
      setSending(false);
    }
  }

  function applyCouponHelper() {
    const code = coupon.trim();
    if (!code) {
      adminNotify.error('Enter a coupon code first');
      return;
    }
    if (body.includes(code)) {
      adminNotify.error('Coupon already in body');
      return;
    }
    const insert = body.trim() ? ` Coupon: ${code}` : `Coupon: ${code}`;
    insertAtCursor(body, insert, bodyRef.current, setBody, BODY_MAX);
  }

  const audienceBadge = useCallback((c: CampaignRow) => {
    const preset = c.data?.audience_preset || c.target_audience || 'all';
    if (preset === 'never_ordered') return 'never ordered';
    if (preset === 'pick' || preset === 'custom') return 'custom';
    if (preset === 'society') return 'society';
    return 'all';
  }, []);

  return (
    <div className="space-y-5">
      <Card className="border-0 shadow-[var(--shadow-card)] rounded-2xl">
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-bold flex items-center gap-2">
            <Send size={16} className="text-primary" />
            Campaign composer
          </CardTitle>
          <p className="text-[11px] text-muted-foreground">
            Plain text only — no markdown. Put coupon codes in the body.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label className="text-xs font-semibold">Title *</Label>
              <span className={cn('text-[10px] font-medium', title.length > TITLE_MAX - 10 ? 'text-amber-600' : 'text-muted-foreground')}>
                {title.length}/{TITLE_MAX}
              </span>
            </div>
            <Input
              ref={titleRef}
              placeholder="e.g. Relax. It's the Weekend!"
              value={title}
              onFocus={() => setEmojiTarget('title')}
              onChange={(e) => setTitle(e.target.value.slice(0, TITLE_MAX))}
              className="rounded-xl"
              maxLength={TITLE_MAX}
            />
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label className="text-xs font-semibold">Body *</Label>
              <span className={cn('text-[10px] font-medium', body.length > BODY_WARN ? 'text-amber-600' : 'text-muted-foreground')}>
                {body.length}/{BODY_MAX}
              </span>
            </div>
            <Textarea
              ref={bodyRef}
              placeholder="e.g. Craving Biryani? Pre-order from ₹99 + 50% OFF. Coupon: O-Biryani-Kal-aana."
              value={body}
              onFocus={() => setEmojiTarget('body')}
              onChange={(e) => setBody(e.target.value.slice(0, BODY_MAX))}
              className="rounded-xl min-h-[96px]"
              maxLength={BODY_MAX}
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-[10px] font-semibold text-muted-foreground">
              Emoji ({emojiTarget})
            </Label>
            <div className="flex flex-wrap gap-1.5">
              {EMOJIS.map((e) => (
                <button
                  key={e}
                  type="button"
                  className="h-8 w-8 rounded-lg border border-border bg-background text-base hover:bg-muted/50"
                  onClick={() => {
                    if (emojiTarget === 'title') {
                      insertAtCursor(title, e, titleRef.current, setTitle, TITLE_MAX);
                    } else {
                      insertAtCursor(body, e, bodyRef.current, setBody, BODY_MAX);
                    }
                  }}
                >
                  {e}
                </button>
              ))}
            </div>
          </div>

          <div className="flex gap-2 items-end">
            <div className="flex-1 space-y-1.5">
              <Label className="text-xs font-semibold">Coupon helper (optional)</Label>
              <Input
                placeholder="O-BIRYANI-KAL-AANA"
                value={coupon}
                onChange={(e) => setCoupon(e.target.value)}
                className="rounded-xl text-xs"
              />
            </div>
            <Button type="button" variant="outline" size="sm" className="rounded-xl shrink-0" onClick={applyCouponHelper}>
              Insert into body
            </Button>
          </div>

          <CampaignPhonePreview title={title} body={body} />

          <CampaignDeepLinkPicker value={deepLink} onChange={setDeepLink} />

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

          <CampaignAudiencePicker
            mode={audienceMode}
            onModeChange={(m) => {
              setAudienceMode(m);
              if (m !== 'pick') setSelectedIds([]);
            }}
            societyId={societyId}
            onSocietyChange={setSocietyId}
            societies={societies}
            selectedIds={selectedIds}
            onSelectedIdsChange={setSelectedIds}
            excludeUserId={user?.id}
          />

          <div className="rounded-xl bg-muted/40 px-3 py-2 text-[11px] text-muted-foreground">
            Users who opted into WhatsApp promotions may also get a WhatsApp copy of this campaign.
          </div>

          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-2 border-t border-border/30">
            <div className="flex items-center gap-2">
              <Users size={14} className="text-muted-foreground" />
              <span className="text-xs text-muted-foreground font-medium">
                {counting ? (
                  'Counting…'
                ) : (
                  <>
                    Will notify <span className="font-bold text-foreground">{previewDevices}</span> device
                    {previewDevices !== 1 ? 's' : ''} ·{' '}
                    <span className="font-bold text-foreground">{previewUsers}</span> user
                    {previewUsers !== 1 ? 's' : ''}
                  </>
                )}
              </span>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="rounded-xl font-semibold"
                disabled={sending || !canCompose || !user?.id}
                onClick={() => void invokeSend({ testMe: true })}
              >
                {sending ? <Loader2 size={14} className="animate-spin" /> : null}
                Send test to me
              </Button>
              <Button
                type="button"
                size="sm"
                className="rounded-xl font-semibold gap-2"
                disabled={!canSend}
                onClick={() => {
                  setConfirmTyped('');
                  setConfirmOpen(true);
                }}
              >
                <Send size={14} />
                Review & send
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent className="rounded-2xl max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle className="font-bold">Send campaign?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm text-muted-foreground">
                <p>
                  Push to <strong className="text-foreground">{previewDevices}</strong> devices (
                  <strong className="text-foreground">{previewUsers}</strong> users) · {platform}
                </p>
                <p>
                  <strong className="text-foreground">Title:</strong> {title}
                </p>
                <p>
                  <strong className="text-foreground">Body:</strong> {body}
                </p>
                <p>
                  <strong className="text-foreground">Deep link:</strong>{' '}
                  {deepLink.referencePath || 'None'}
                </p>
                <p className="text-[11px]">
                  WhatsApp copy may also go to opted-in promotion users.
                </p>
                {needsTypedConfirm && (
                  <div className="space-y-1.5 pt-1">
                    <Label className="text-xs">Type SEND to confirm</Label>
                    <Input
                      value={confirmTyped}
                      onChange={(e) => setConfirmTyped(e.target.value)}
                      className="rounded-xl"
                      placeholder="SEND"
                    />
                  </div>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="rounded-xl">Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="rounded-xl font-semibold"
              disabled={sending || (needsTypedConfirm && confirmTyped.trim() !== 'SEND')}
              onClick={(e) => {
                e.preventDefault();
                void invokeSend();
              }}
            >
              {sending ? 'Sending…' : `Send to ${previewDevices} devices`}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

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
                      <Badge variant="outline" className="text-[10px] h-5 rounded-md">{audienceBadge(c)}</Badge>
                      {c.data?.reference_path && (
                        <Badge variant="outline" className="text-[10px] h-5 rounded-md font-mono max-w-[160px] truncate">
                          {c.data.reference_path}
                        </Badge>
                      )}
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
