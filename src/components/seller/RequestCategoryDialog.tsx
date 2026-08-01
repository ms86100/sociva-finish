// @ts-nocheck
import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import { Loader2, Sparkles, CheckCircle2, Clock, ListChecks, ArrowRight } from 'lucide-react';
import { notify } from '@/lib/notify';

interface RequestCategoryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialName: string;
  parentGroupInfos: { value: string; label: string }[];
  sellerId?: string | null;
  draftProductId?: string | null;
  /** Slug of the "Other <group>" fallback the seller can use right now, if available. */
  fallbackCategory?: string | null;
  fallbackCategoryLabel?: string | null;
  onSubmitted?: (parentGroupSlug: string | null) => void;
  /** When true, keep seller in onboarding — no links into SellerRoute. */
  onboardingMode?: boolean;
}

export function RequestCategoryDialog({
  open, onOpenChange, initialName, parentGroupInfos, sellerId, draftProductId,
  fallbackCategory, fallbackCategoryLabel, onSubmitted, onboardingMode = false,
}: RequestCategoryDialogProps) {
  const { user } = useAuth();
  const [name, setName] = useState(initialName);
  const [group, setGroup] = useState<string>('');
  const [example, setExample] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submittedName, setSubmittedName] = useState<string | null>(null);

  // Sync initial name when dialog reopens
  useEffect(() => {
    if (open) {
      if (!submittedName) setName(initialName);
    } else {
      // Reset on close so reopening starts fresh
      setSubmittedName(null);
    }
  }, [open, initialName]);

  const resetForm = () => {
    setName('');
    setGroup('');
    setExample('');
  };

  const handleSubmit = async () => {
    if (!user) {
      notify.block('Please sign in to request a category');
      return;
    }
    if (!name.trim()) {
      toast.error('Enter the category name you want to sell');
      return;
    }
    setSubmitting(true);
    try {
      const { error } = await supabase.from('category_requests').insert({
        seller_id: sellerId || null,
        requested_by: user.id,
        requested_name: name.trim(),
        parent_group_hint: group || null,
        parent_group_slug: group || null,
        example_product: example.trim() || null,
        draft_product_id: draftProductId || null,
      });
      if (error) throw error;

      // Ping admins (best-effort) so requests don't sit unnoticed
      try {
        const { notifyAdminsCategoryRequest } = await import('@/lib/admin-notifications');
        await notifyAdminsCategoryRequest(name.trim(), user.id);
      } catch { /* non-blocking */ }

      // Fire upstream effect (auto-select fallback in onboarding) but DON'T close —
      // we want the seller to see the confirmation.
      onSubmitted?.(group || null);
      setSubmittedName(name.trim());
      resetForm();
    } catch (err: any) {
      const msg = `${err?.message ?? ''}`;
      let friendly = msg;
      if (msg.includes('category_request_limit_pending')) friendly = 'You already have 5 pending requests. Please wait for review.';
      else if (msg.includes('category_request_limit_daily')) friendly = 'Daily request limit reached. Try again tomorrow.';
      else if (msg.includes('category_requests_pending_unique') || msg.includes('duplicate key')) friendly = 'You already requested this category — it\'s pending review.';
      toast.error('Could not submit request', { description: friendly });
    } finally {
      setSubmitting(false);
    }
  };

  /* ──────────── Confirmation view ──────────── */
  if (submittedName) {
    const sellNowHref = fallbackCategory
      ? (draftProductId ? `/seller/products/${draftProductId}/edit` : `/seller/products/new?category=${fallbackCategory}`)
      : '/seller/products';

    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-[460px]">
          <DialogHeader>
            <div className="w-14 h-14 mx-auto mb-3 rounded-full bg-emerald-500/15 flex items-center justify-center">
              <CheckCircle2 className="text-emerald-600" size={28} />
            </div>
            <DialogTitle className="text-center">Request received</DialogTitle>
            <DialogDescription className="text-center">
              We're reviewing <strong className="text-foreground">"{submittedName}"</strong>. You'll get a
              notification the moment it's approved — usually within 24 hours.
            </DialogDescription>
          </DialogHeader>

          <div className="rounded-lg bg-muted/40 p-3 flex items-start gap-2 text-xs">
            <Clock size={14} className="text-muted-foreground mt-0.5 shrink-0" />
            <p className="text-muted-foreground">
              You don't have to wait. {fallbackCategory
                ? <>Continue onboarding under <strong className="text-foreground">{fallbackCategoryLabel || 'the closest category'}</strong> — we'll add your requested category when it's live.</>
                : <>Pick the closest existing category and keep going.</>}
            </p>
          </div>

          <DialogFooter className="flex-col sm:flex-col gap-2 sm:gap-2">
            {onboardingMode ? (
              <Button className="w-full gap-1.5" onClick={() => onOpenChange(false)}>
                Continue onboarding
                <ArrowRight size={14} />
              </Button>
            ) : (
              <>
                <Link to={sellNowHref} className="w-full" onClick={() => onOpenChange(false)}>
                  <Button className="w-full gap-1.5">
                    {draftProductId ? 'Continue your draft' : 'Start selling now'}
                    <ArrowRight size={14} />
                  </Button>
                </Link>
                <Link to="/seller/category-requests" className="w-full" onClick={() => onOpenChange(false)}>
                  <Button variant="outline" className="w-full gap-1.5">
                    <ListChecks size={14} /> Track request status
                  </Button>
                </Link>
              </>
            )}
            <Button variant="ghost" className="w-full" onClick={() => onOpenChange(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  /* ──────────── Submit form view ──────────── */
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[440px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles size={18} className="text-primary" />
            Request a new category
          </DialogTitle>
          <DialogDescription>
            Tell us what you'd like to sell. We'll review and add it to the catalog.
            You can keep onboarding using the closest "Other" category in the meantime.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="cat-name">Category name</Label>
            <Input
              id="cat-name"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="e.g. Makhana"
              autoFocus
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="cat-group">Closest group (optional)</Label>
            <Select value={group} onValueChange={setGroup}>
              <SelectTrigger id="cat-group">
                <SelectValue placeholder="Pick the closest group" />
              </SelectTrigger>
              <SelectContent>
                {parentGroupInfos.map(g => (
                  <SelectItem key={g.value} value={g.value}>{g.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="cat-example">Example product (optional)</Label>
            <Textarea
              id="cat-example"
              value={example}
              onChange={e => setExample(e.target.value)}
              placeholder="A short description so we understand what you sell"
              rows={3}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={submitting || !name.trim()}>
            {submitting && <Loader2 size={14} className="mr-2 animate-spin" />}
            Submit request
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
