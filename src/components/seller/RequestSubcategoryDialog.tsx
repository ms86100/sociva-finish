// @ts-nocheck
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Loader2, Sparkles, CheckCircle2, Clock, ListChecks } from 'lucide-react';
import { notify } from '@/lib/notify';

interface RequestSubcategoryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialName: string;
  parentCategoryConfigId: string;
  parentCategoryName: string;
  parentCategorySlug: string;
  parentGroupSlug: string | null;
}

export function RequestSubcategoryDialog({
  open, onOpenChange, initialName,
  parentCategoryConfigId, parentCategoryName, parentCategorySlug, parentGroupSlug,
}: RequestSubcategoryDialogProps) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [name, setName] = useState(initialName);
  const [example, setExample] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submittedName, setSubmittedName] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      if (!submittedName) setName(initialName);
    } else {
      setSubmittedName(null);
      setExample('');
    }
  }, [open, initialName]);

  const handleSubmit = async () => {
    if (!user) { notify.block('Please sign in'); return; }
    if (!name.trim()) { toast.error('Enter the subcategory you want to sell'); return; }

    setSubmitting(true);
    try {
      const { error } = await supabase.from('category_requests').insert({
        requested_by: user.id,
        requested_name: name.trim(),
        example_product: example.trim() || null,
        request_kind: 'subcategory',
        parent_category_config_id: parentCategoryConfigId,
        parent_category_slug: parentCategorySlug,
        parent_group_slug: parentGroupSlug,
      });
      if (error) throw error;
      qc.invalidateQueries({ queryKey: ['seller', 'category-requests'] });
      setSubmittedName(name.trim());
    } catch (err: any) {
      const msg = `${err?.message ?? ''}`;
      let friendly = msg;
      if (msg.includes('category_request_limit_pending')) friendly = 'You already have 5 pending requests. Please wait for review.';
      else if (msg.includes('category_request_limit_daily')) friendly = 'Daily request limit reached. Try again tomorrow.';
      else if (msg.includes('category_requests_pending_unique') || msg.includes('duplicate key')) friendly = "You already requested this — it's pending review.";
      toast.error('Could not submit request', { description: friendly });
    } finally {
      setSubmitting(false);
    }
  };

  if (submittedName) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-[460px]">
          <DialogHeader>
            <div className="w-14 h-14 mx-auto mb-3 rounded-full bg-emerald-500/15 flex items-center justify-center">
              <CheckCircle2 className="text-emerald-600" size={28} />
            </div>
            <DialogTitle className="text-center">Request received</DialogTitle>
            <DialogDescription className="text-center">
              We're reviewing <strong className="text-foreground">"{submittedName}"</strong> as a new subcategory
              under <strong className="text-foreground">{parentCategoryName}</strong>. You'll be notified the moment
              it's live — usually within 24 hours.
            </DialogDescription>
          </DialogHeader>

          <div className="rounded-lg bg-muted/40 p-3 flex items-start gap-2 text-xs">
            <Clock size={14} className="text-muted-foreground mt-0.5 shrink-0" />
            <p className="text-muted-foreground">
              You can keep going with the closest existing pick under {parentCategoryName} — we'll move your listing
              automatically once your subcategory is approved.
            </p>
          </div>

          <DialogFooter className="flex-col sm:flex-col gap-2 sm:gap-2">
            <Link to="/seller/category-requests" className="w-full" onClick={() => onOpenChange(false)}>
              <Button variant="outline" className="w-full gap-1.5">
                <ListChecks size={14} /> Track request status
              </Button>
            </Link>
            <Button className="w-full" onClick={() => onOpenChange(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[440px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles size={18} className="text-primary" />
            Request a new subcategory
          </DialogTitle>
          <DialogDescription>
            Tell us what you'd like to sell under <strong className="text-foreground">{parentCategoryName}</strong>.
            We'll review and add it.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="sub-name">Subcategory name</Label>
            <Input
              id="sub-name"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="e.g. Makhana"
              autoFocus
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="sub-example">Example product (optional)</Label>
            <Textarea
              id="sub-example"
              value={example}
              onChange={e => setExample(e.target.value)}
              placeholder="A short description so we understand what you sell"
              rows={3}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={submitting}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={submitting || !name.trim()}>
            {submitting && <Loader2 size={14} className="mr-2 animate-spin" />}
            Submit request
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
