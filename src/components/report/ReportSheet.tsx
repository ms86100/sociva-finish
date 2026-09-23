// @ts-nocheck
import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerDescription } from '@/components/ui/drawer';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Loader2, Flag, Check } from 'lucide-react';
import { notify } from '@/lib/notify';
import { showFeedback } from '@/components/FeedbackPopupProvider';
import { getDrawerKeyboardStyle, useKeepDrawerFieldVisible } from '@/hooks/useChatViewport';
import { cn } from '@/lib/utils';

interface ReportSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  targetType: 'product' | 'seller' | 'post' | 'user';
  targetId: string;
  targetName?: string;
  /** Optional seller id when reporting a product — stored as secondary target. */
  sellerId?: string | null;
}

/** Must match public.reports report_type CHECK constraint. */
export const REPORT_TYPES = [
  { value: 'inappropriate', label: 'Inappropriate content' },
  { value: 'spam', label: 'Spam or scam' },
  { value: 'fraud', label: 'Suspected fraud' },
  { value: 'harassment', label: 'Harassment or abuse' },
  { value: 'other', label: 'Other' },
] as const;

export const ALLOWED_REPORT_TYPES = REPORT_TYPES.map((t) => t.value);

function reportReturnPath(targetType: ReportSheetProps['targetType'], targetId: string): string {
  if (targetType === 'product' && targetId) return `/product/${targetId}`;
  if (targetType === 'seller' && targetId) return `/seller/${targetId}`;
  return '/';
}

export function ReportSheet({
  open,
  onOpenChange,
  targetType,
  targetId,
  targetName,
  sellerId,
}: ReportSheetProps) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [reportType, setReportType] = useState('');
  const [description, setDescription] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const { viewportHeight, keyboardInset, isKeyboardOpen } = useKeepDrawerFieldVisible(open);

  const resetForm = () => {
    setReportType('');
    setDescription('');
  };

  const goSignIn = () => {
    const returnTo = reportReturnPath(targetType, targetId);
    onOpenChange(false);
    navigate('/auth', { state: { from: returnTo, returnTo } });
  };

  const handleSubmit = async () => {
    if (!user) {
      goSignIn();
      return;
    }
    if (!reportType || !ALLOWED_REPORT_TYPES.includes(reportType as (typeof ALLOWED_REPORT_TYPES)[number])) {
      notify.block('Please select a reason');
      return;
    }
    if (!targetId) {
      notify.block('Nothing to report');
      return;
    }

    setIsSubmitting(true);
    try {
      const insertData: Record<string, unknown> = {
        reporter_id: user.id,
        report_type: reportType,
        description: description.trim() || null,
        status: 'pending',
      };

      if (targetType === 'seller') {
        insertData.reported_seller_id = targetId;
      } else if (targetType === 'product') {
        insertData.reported_product_id = targetId;
        if (sellerId) insertData.reported_seller_id = sellerId;
      } else if (targetType === 'post') {
        insertData.reported_post_id = targetId;
      } else if (targetType === 'user') {
        insertData.reported_user_id = targetId;
      }

      const { error } = await supabase.from('reports').insert(insertData as never);
      if (error) throw error;

      onOpenChange(false);
      resetForm();
      // Close drawer first so feedback is not trapped under product sheet overlays
      window.setTimeout(() => {
        showFeedback({
          title: 'Report submitted',
          description: 'Our team will review it shortly.',
          variant: 'success',
        });
        notify.success('Report submitted');
      }, 180);
    } catch (error: any) {
      console.error('Error submitting report:', error);
      const message =
        typeof error?.message === 'string' && error.message.trim()
          ? error.message
          : 'Failed to submit report. Please try again.';
      showFeedback({
        title: 'Could not submit report',
        description: message,
        variant: 'warning',
      });
      notify.error(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Drawer open={open} onOpenChange={onOpenChange} repositionInputs={false}>
      <DrawerContent
        data-drawer-scroll
        className="z-[280] max-h-[min(92dvh,100%)] overflow-y-auto"
        overlayClassName="z-[280]"
        style={getDrawerKeyboardStyle({ viewportHeight, keyboardInset, isKeyboardOpen })}
      >
        <DrawerHeader className="text-left pb-4 px-4">
          <DrawerTitle className="flex items-center gap-2">
            <Flag size={18} className="text-destructive" />
            Report{' '}
            {targetType === 'post'
              ? 'Post'
              : targetType === 'product'
                ? 'Product'
                : targetType === 'user'
                  ? 'User'
                  : 'Seller'}
          </DrawerTitle>
          <DrawerDescription>
            {targetName && <span>Reporting: {targetName}</span>}
          </DrawerDescription>
        </DrawerHeader>

        {!user ? (
          <div className="space-y-4 px-4 pb-6">
            <p className="text-sm text-muted-foreground">
              Sign in so we can review your report and follow up if needed. Guests can still browse and share.
            </p>
            <div className="flex gap-3">
              <Button variant="outline" className="flex-1" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button className="flex-1" onClick={goSignIn}>
                Sign in to report
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-4 px-4 pb-6">
            <div className="space-y-2">
              <Label>Reason *</Label>
              <div className="grid gap-2" role="radiogroup" aria-label="Report reason">
                {REPORT_TYPES.map(({ value, label }) => {
                  const selected = reportType === value;
                  return (
                    <button
                      key={value}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      data-haptic="selection"
                      className={cn(
                        'flex items-center justify-between rounded-xl border px-3 py-3 text-left text-sm transition-colors',
                        selected
                          ? 'border-accent bg-accent/10 font-semibold'
                          : 'border-border bg-background',
                      )}
                      onClick={() => setReportType(value)}
                    >
                      <span>{label}</span>
                      {selected ? <Check size={16} className="text-accent shrink-0" /> : null}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="space-y-2">
              <Label>Additional details (optional)</Label>
              <Textarea
                ref={textareaRef}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                onFocus={() => {
                  requestAnimationFrame(() => {
                    setTimeout(() => {
                      textareaRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
                    }, 50);
                  });
                }}
                placeholder="Provide more context about your report..."
                rows={3}
              />
            </div>

            <div className="flex gap-3 pt-2">
              <Button variant="outline" className="flex-1" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button
                className="flex-1"
                onClick={handleSubmit}
                disabled={!reportType || isSubmitting}
              >
                {isSubmitting ? <Loader2 size={16} className="mr-2 animate-spin" /> : null}
                Submit Report
              </Button>
            </div>
          </div>
        )}
      </DrawerContent>
    </Drawer>
  );
}
