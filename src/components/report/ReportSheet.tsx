// @ts-nocheck
import { useRef, useState } from 'react';
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerDescription } from '@/components/ui/drawer';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Loader2, Flag } from 'lucide-react';
import { notify } from '@/lib/notify';
import { showFeedback } from '@/components/FeedbackPopupProvider';
import { getDrawerKeyboardStyle, useKeepDrawerFieldVisible } from '@/hooks/useChatViewport';

interface ReportSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  targetType: 'product' | 'seller' | 'post' | 'user';
  targetId: string;
  targetName?: string;
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

export function ReportSheet({ open, onOpenChange, targetType, targetId, targetName }: ReportSheetProps) {
  const { user } = useAuth();
  const [reportType, setReportType] = useState('');
  const [description, setDescription] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const { viewportHeight, keyboardInset, isKeyboardOpen } = useKeepDrawerFieldVisible(open);

  const handleSubmit = async () => {
    if (!user) {
      notify.block('Sign in to submit a report');
      return;
    }
    if (!reportType || !ALLOWED_REPORT_TYPES.includes(reportType as (typeof ALLOWED_REPORT_TYPES)[number])) {
      notify.block('Please select a reason');
      return;
    }

    setIsSubmitting(true);
    try {
      const insertData: Record<string, any> = {
        reporter_id: user.id,
        report_type: reportType,
        description: description || null,
      };

      if (targetType === 'seller') {
        insertData.reported_seller_id = targetId;
      } else if (targetType === 'product') {
        insertData.reported_product_id = targetId;
      } else if (targetType === 'post') {
        insertData.reported_post_id = targetId;
      } else if (targetType === 'user') {
        insertData.reported_user_id = targetId;
      }

      const { error } = await supabase.from('reports').insert(insertData as any);
      if (error) throw error;

      showFeedback({
        title: 'Report submitted. Our team will review it shortly.',
        variant: 'success',
      });
      onOpenChange(false);
      setReportType('');
      setDescription('');
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
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Drawer open={open} onOpenChange={onOpenChange} repositionInputs={false}>
      <DrawerContent
        data-drawer-scroll
        className="z-[70] max-h-[min(92dvh,100%)] overflow-y-auto"
        overlayClassName="z-[70]"
        style={getDrawerKeyboardStyle({ viewportHeight, keyboardInset, isKeyboardOpen })}
      >
        <DrawerHeader className="text-left pb-4 px-4">
          <DrawerTitle className="flex items-center gap-2">
            <Flag size={18} className="text-destructive" />
            Report {targetType === 'post' ? 'Post' : targetType === 'product' ? 'Product' : targetType === 'user' ? 'User' : 'Seller'}
          </DrawerTitle>
          <DrawerDescription>
            {targetName && <span>Reporting: {targetName}</span>}
          </DrawerDescription>
        </DrawerHeader>

        <div className="space-y-4 px-4 pb-6">
          <div className="space-y-2">
            <Label>Reason *</Label>
            <Select value={reportType} onValueChange={setReportType}>
              <SelectTrigger>
                <SelectValue placeholder="Select a reason" />
              </SelectTrigger>
              <SelectContent className="z-[80]">
                {REPORT_TYPES.map(({ value, label }) => (
                  <SelectItem key={value} value={value}>{label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
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
      </DrawerContent>
    </Drawer>
  );
}
