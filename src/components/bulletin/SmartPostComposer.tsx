// @ts-nocheck
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from '@/components/ui/drawer';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { cn, friendlyError } from '@/lib/utils';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import { Loader2, ImagePlus, X, Sparkles, Check, Clock } from 'lucide-react';
import { notify } from '@/lib/notify';
import { useFeedbackPopup } from '@/components/FeedbackPopupProvider';
import {
  resolveCommunityIntent,
  SMART_CATEGORY_AUDIENCE,
  SMART_CATEGORY_LABELS,
  type CommunityIntentResult,
  type SmartGroupCategory,
} from '@/lib/community-intent';
import { CATEGORY_CONFIG } from './CategoryFilter';
import { assessPeacekeeperTone } from '@/lib/peacekeeper';

interface SmartPostComposerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
}

type Step = 'compose' | 'confirm' | 'peacekeeper';
type TtlOption = '24h' | '7d' | '30d' | 'until_resolved' | 'never';

const TTL_OPTIONS: { value: TtlOption; label: string }[] = [
  { value: '24h', label: '24 hours' },
  { value: '7d', label: '7 days' },
  { value: '30d', label: '30 days' },
  { value: 'until_resolved', label: 'Until resolved' },
  { value: 'never', label: 'Never' },
];

function expiresAtFromTtl(ttl: TtlOption): string | null {
  if (ttl === 'never' || ttl === 'until_resolved') return null;
  const ms =
    ttl === '24h' ? 24 * 60 * 60 * 1000
      : ttl === '7d' ? 7 * 24 * 60 * 60 * 1000
        : 30 * 24 * 60 * 60 * 1000;
  return new Date(Date.now() + ms).toISOString();
}

const ALL_EDITABLE: SmartGroupCategory[] = [
  'find_help',
  'recommendation',
  'rent_sell',
  'buy_sell',
  'announcement',
  'event',
  'alert',
  'maintenance',
  'poll',
  'lost_found',
];

export function SmartPostComposer({ open, onOpenChange, onCreated }: SmartPostComposerProps) {
  const { user, profile } = useAuth();
  const [step, setStep] = useState<Step>('compose');
  const [body, setBody] = useState('');
  const [title, setTitle] = useState('');
  const [attachments, setAttachments] = useState<File[]>([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [intent, setIntent] = useState<CommunityIntentResult | null>(null);
  const [selectedCategories, setSelectedCategories] = useState<SmartGroupCategory[]>([]);
  const [helphubMatches, setHelphubMatches] = useState<any[]>([]);
  const [ttl, setTtl] = useState<TtlOption>('30d');
  const [peaceNudge, setPeaceNudge] = useState<{ reason: string; calmerVersion: string } | null>(null);

  const resetForm = () => {
    setStep('compose');
    setBody('');
    setTitle('');
    setAttachments([]);
    setIntent(null);
    setSelectedCategories([]);
    setHelphubMatches([]);
    setTtl('30d');
    setPeaceNudge(null);
  };

  useEffect(() => {
    if (!open) resetForm();
  }, [open]);

  const livePreview = useMemo(() => {
    if (body.trim().length < 8) return null;
    return resolveCommunityIntent(body);
  }, [body]);

  const handleAttachmentPick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (attachments.length + files.length > 4) {
      toast.error('Max 4 images allowed');
      return;
    }
    setAttachments((prev) => [...prev, ...files]);
  };

  const uploadAttachments = async (): Promise<string[]> => {
    if (!user?.id) throw new Error('Not authenticated');
    const urls: string[] = [];
    for (const file of attachments) {
      const ext = file.name.split('.').pop();
      const path = `${user.id}/bulletin/${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`;
      const { error } = await supabase.storage.from('app-images').upload(path, file);
      if (error) throw error;
      const { data: urlData } = supabase.storage.from('app-images').getPublicUrl(path);
      urls.push(urlData.publicUrl);
    }
    return urls;
  };

  const goToConfirm = async () => {
    if (!body.trim() && !title.trim()) {
      toast.error('Write something for your neighbours first');
      return;
    }
    const text = [title.trim(), body.trim()].filter(Boolean).join('\n');
    const resolved = resolveCommunityIntent(text);
    if (resolved.matchBand === 'none' || resolved.confidence < 0.3) {
      // Force user to pick a category - still allow with announcement default
      resolved.primaryCategory = resolved.primaryCategory || 'announcement';
      if (!resolved.categories.length) resolved.categories = ['announcement'];
    }
    setIntent(resolved);
    setSelectedCategories(resolved.categories);
    if (!title.trim() && resolved.suggestedTitle) {
      setTitle(resolved.suggestedTitle);
    }

    if (resolved.primaryCategory === 'find_help' && profile?.society_id && resolved.serviceCategory) {
      try {
        let q = supabase
          .from('helphub_listings')
          .select('id, display_name, category, work_type, availability, recommender_name, tower_or_block')
          .eq('society_id', profile.society_id)
          .eq('status', 'active')
          .gt('expires_at', new Date().toISOString())
          .order('created_at', { ascending: false })
          .limit(5);
        q = q.eq('category', resolved.serviceCategory);
        const { data } = await q;
        setHelphubMatches(data || []);
      } catch {
        setHelphubMatches([]);
      }
    } else {
      setHelphubMatches([]);
    }

    setStep('confirm');
  };

  const toggleCategory = (cat: SmartGroupCategory) => {
    setSelectedCategories((prev) => {
      if (prev.includes(cat)) {
        if (prev.length === 1) return prev;
        return prev.filter((c) => c !== cat);
      }
      return [...prev, cat];
    });
  };

  const primaryCategory = selectedCategories[0] || intent?.primaryCategory || 'announcement';

  const runPublish = async (bodyOverride?: string) => {
    if (!profile?.society_id || !user) {
      notify.block('You must belong to a society');
      return;
    }
    if (!title.trim()) {
      toast.error('Add a short title');
      return;
    }
    if (!intent) return;
    if (intent.matchBand === 'none' && selectedCategories.length === 0) {
      toast.error('Pick at least one category before publishing');
      return;
    }

    const finalBody = (bodyOverride !== undefined ? bodyOverride : body).trim();

    setLoading(true);
    try {
      let attachment_urls: string[] = [];
      if (attachments.length > 0) {
        setUploading(true);
        attachment_urls = await uploadAttachments();
        setUploading(false);
      }

      const contentToCheck = `${title.trim()} ${finalBody}`;
      try {
        const { data: reviewResult } = await supabase.functions.invoke('ai-auto-review', {
          body: {
            target_type: 'bulletin_post',
            content: contentToCheck,
            society_id: profile.society_id,
          },
        });
        if (reviewResult?.decision === 'reject' || reviewResult?.decision === 'rejected') {
          toast.error(
            reviewResult?.reason ||
              'Your post was flagged for inappropriate content. Please revise and try again.',
          );
          setLoading(false);
          return;
        }
      } catch (reviewErr) {
        console.warn('[SmartPostComposer] Content moderation unavailable, allowing post:', reviewErr);
      }

      const userCorrected =
        selectedCategories[0] !== intent.primaryCategory ||
        selectedCategories.length !== intent.categories.length ||
        selectedCategories.some((c, i) => c !== intent.categories[i]);

      const expiresAt = expiresAtFromTtl(ttl);
      const postData: any = {
        society_id: profile.society_id,
        author_id: profile.id,
        category: primaryCategory,
        title: title.trim(),
        body: finalBody || null,
        attachment_urls,
        intent: intent.intent,
        service_category: intent.serviceCategory,
        status: 'open',
        expires_at: expiresAt,
        structured: {
          match_band: intent.matchBand,
          confidence: intent.confidence,
          ttl,
        },
      };

      const { data: inserted, error } = await supabase
        .from('bulletin_posts')
        .insert(postData)
        .select('id')
        .single();
      if (error) throw error;
      const postId = inserted.id;

      const categoryRows = selectedCategories.map((category, idx) => ({
        post_id: postId,
        category,
        is_primary: idx === 0,
      }));
      const { error: catErr } = await supabase.from('bulletin_post_categories').insert(categoryRows);
      if (catErr) console.warn('[SmartPostComposer] category map insert failed', catErr);

      const { error: classErr } = await supabase.from('bulletin_post_classifications').insert({
        post_id: postId,
        intent: intent.intent,
        suggested_categories: intent.categories,
        service_category: intent.serviceCategory,
        confidence: intent.confidence,
        match_band: intent.matchBand,
        user_corrected: userCorrected,
        raw_signals: { signals: intent.signals },
      });
      if (classErr) console.warn('[SmartPostComposer] classification insert failed', classErr);

      const { showFeedback: fb } = useFeedbackPopup();
      fb({ title: 'Posted to your community!', variant: 'success' });
      resetForm();
      onOpenChange(false);
      onCreated();
    } catch (err: any) {
      toast.error('Failed to create post: ' + friendlyError(err));
    } finally {
      setLoading(false);
      setUploading(false);
    }
  };

  const handlePublish = async () => {
    const tone = assessPeacekeeperTone(`${title}\n${body}`);
    if (tone.needsNudge && step !== 'peacekeeper') {
      setPeaceNudge({ reason: tone.reason, calmerVersion: tone.calmerVersion });
      setStep('peacekeeper');
      return;
    }
    await runPublish();
  };

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent className="max-h-[90vh] overflow-y-auto">
        <DrawerHeader>
          <DrawerTitle className="flex items-center gap-2">
            <Sparkles size={18} className="text-primary" />
            {step === 'compose' ? "What's happening in your community?" : 'Sociva understood your post'}
          </DrawerTitle>
        </DrawerHeader>

        <div className="space-y-4 mt-2 px-1 pb-6">
          {step === 'compose' && (
            <>
              <div>
                <Label htmlFor="smart-title">Title (optional)</Label>
                <Input
                  id="smart-title"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Short headline"
                  maxLength={200}
                />
              </div>
              <div>
                <Label htmlFor="smart-body">Your post</Label>
                <Textarea
                  id="smart-body"
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  placeholder="Ask for help, share something, find a service or announce an event..."
                  rows={5}
                />
              </div>

              {livePreview && livePreview.matchBand !== 'none' && (
                <div className="rounded-xl border border-border bg-muted/40 p-3 text-xs space-y-1">
                  <p className="font-medium text-foreground flex items-center gap-1">
                    <Sparkles size={12} className="text-primary" /> Smart preview
                  </p>
                  <p className="text-muted-foreground">
                    Likely route:{' '}
                    <span className="text-foreground font-medium">
                      {SMART_CATEGORY_LABELS[livePreview.primaryCategory]}
                    </span>
                    {livePreview.serviceCategory ? ` · ${livePreview.serviceCategory}` : ''}
                  </p>
                </div>
              )}

              <div>
                <Label>Photos (optional)</Label>
                <div className="flex flex-wrap gap-2 mt-1">
                  {attachments.map((file, i) => (
                    <div key={i} className="relative w-16 h-16 rounded-lg overflow-hidden border border-border">
                      <img
                        src={URL.createObjectURL(file)}
                        alt=""
                        className="w-full h-full object-cover"
                      />
                      <button
                        type="button"
                        className="absolute top-0.5 right-0.5 bg-background/80 rounded-full p-0.5"
                        onClick={() => setAttachments((prev) => prev.filter((_, idx) => idx !== i))}
                      >
                        <X size={12} />
                      </button>
                    </div>
                  ))}
                  {attachments.length < 4 && (
                    <label className="w-16 h-16 rounded-lg border border-dashed border-border flex items-center justify-center cursor-pointer hover:border-primary/40">
                      <ImagePlus size={18} className="text-muted-foreground" />
                      <input
                        type="file"
                        accept="image/*"
                        className="hidden"
                        multiple
                        onChange={handleAttachmentPick}
                      />
                    </label>
                  )}
                </div>
              </div>

              <Button className="w-full" onClick={goToConfirm} disabled={!body.trim() && !title.trim()}>
                Continue
              </Button>
            </>
          )}

          {step === 'confirm' && intent && (
            <>
              <div className="rounded-xl border border-primary/20 bg-primary/5 p-3 space-y-2">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <Check size={16} className="text-primary" />
                  Ready
                </div>
                <p className="text-xs text-muted-foreground">
                  Your post will appear in the feeds below. Edit categories if needed before publishing.
                </p>
                {intent.matchBand === 'weak' || intent.matchBand === 'none' ? (
                  <p className="text-xs text-warning">
                    We are less sure about this one - please confirm the category.
                  </p>
                ) : null}
              </div>

              <div>
                <Label htmlFor="confirm-title">Title</Label>
                <Input
                  id="confirm-title"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  maxLength={200}
                />
              </div>

              <div>
                <p className="text-sm font-medium mb-2">Your post will appear in</p>
                <div className="flex flex-wrap gap-2">
                  {ALL_EDITABLE.map((cat) => {
                    const active = selectedCategories.includes(cat);
                    const cfg = CATEGORY_CONFIG[cat];
                    const Icon = cfg?.icon;
                    return (
                      <button
                        key={cat}
                        type="button"
                        onClick={() => toggleCategory(cat)}
                        className={cn(
                          'flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border transition-all',
                          active
                            ? 'bg-primary text-primary-foreground border-primary'
                            : 'bg-card border-border text-muted-foreground',
                        )}
                      >
                        {Icon ? <Icon size={12} /> : null}
                        {SMART_CATEGORY_LABELS[cat]}
                      </button>
                    );
                  })}
                </div>
                <p className="text-xs text-muted-foreground mt-2">
                  {SMART_CATEGORY_AUDIENCE[primaryCategory]}
                </p>
              </div>

              {intent.serviceCategory && (
                <Badge variant="secondary" className="text-xs">
                  Service: {intent.serviceCategory.replace(/_/g, ' ')}
                </Badge>
              )}

              {helphubMatches.length > 0 && (
                <div className="rounded-xl border border-border p-3 space-y-2">
                  <p className="text-sm font-medium">Neighbours already recommend</p>
                  <p className="text-xs text-muted-foreground">
                    From HelpHub in your society - not background-verified.
                  </p>
                  {helphubMatches.map((m) => (
                    <Link
                      key={m.id}
                      to={`/help-hub/${m.id}`}
                      className="block rounded-lg bg-muted/50 px-3 py-2 text-sm hover:bg-muted"
                    >
                      <span className="font-medium">{m.display_name}</span>
                      <span className="text-xs text-muted-foreground block">
                        {m.category}
                        {m.recommender_name ? ` · recommended by ${m.recommender_name}` : ''}
                      </span>
                    </Link>
                  ))}
                </div>
              )}

              {(primaryCategory === 'buy_sell' || primaryCategory === 'rent_sell') && (
                <div className="text-xs text-muted-foreground rounded-lg border border-border p-3">
                  Tip: after posting, you can also list on the{' '}
                  <Link to="/search" className="text-primary underline">
                    marketplace
                  </Link>{' '}
                  for structured buy, sell or rental discovery.
                </div>
              )}

              <div>
                <Label className="flex items-center gap-1.5 mb-2">
                  <Clock size={14} /> How long should this stay active?
                </Label>
                <div className="flex flex-wrap gap-2">
                  {TTL_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => setTtl(opt.value)}
                      className={cn(
                        'px-3 py-1.5 rounded-full text-xs font-medium border transition-all',
                        ttl === opt.value
                          ? 'bg-primary text-primary-foreground border-primary'
                          : 'bg-card border-border text-muted-foreground',
                      )}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
                <p className="text-[10px] text-muted-foreground mt-1.5">
                  Expired posts leave the default feed but stay in history.
                </p>
              </div>

              <div className="flex gap-2">
                <Button variant="outline" className="flex-1" onClick={() => setStep('compose')}>
                  Back
                </Button>
                <Button className="flex-1" onClick={handlePublish} disabled={loading || uploading}>
                  {loading || uploading ? (
                    <Loader2 className="animate-spin" size={16} />
                  ) : (
                    'Publish to community'
                  )}
                </Button>
              </div>
            </>
          )}

          {step === 'peacekeeper' && peaceNudge && (
            <>
              <div className="rounded-xl border border-warning/30 bg-warning/10 p-3 space-y-2">
                <p className="text-sm font-medium text-foreground">{peaceNudge.reason}</p>
                <p className="text-xs text-muted-foreground">
                  You can still post as-is. A calmer version often gets better neighbour responses.
                </p>
              </div>
              <div className="rounded-xl border border-border p-3 space-y-1">
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Calmer version</p>
                <p className="text-sm text-foreground whitespace-pre-wrap">{peaceNudge.calmerVersion}</p>
              </div>
              <div className="flex flex-col gap-2">
                <Button
                  className="w-full"
                  disabled={loading || uploading}
                  onClick={async () => {
                    setBody(peaceNudge.calmerVersion);
                    await runPublish(peaceNudge.calmerVersion);
                  }}
                >
                  {loading ? <Loader2 className="animate-spin" size={16} /> : 'Use calmer version'}
                </Button>
                <Button
                  variant="outline"
                  className="w-full"
                  disabled={loading || uploading}
                  onClick={() => runPublish()}
                >
                  Post as-is
                </Button>
                <Button variant="ghost" className="w-full" onClick={() => setStep('confirm')}>
                  Back to edit
                </Button>
              </div>
            </>
          )}
        </div>
      </DrawerContent>
    </Drawer>
  );
}
