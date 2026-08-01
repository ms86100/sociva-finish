// @ts-nocheck
import { useState } from 'react';
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerDescription } from '@/components/ui/drawer';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import { Loader2, Flag } from 'lucide-react';
import { notify } from '@/lib/notify';

interface ReportSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  targetType: 'product' | 'seller' | 'post' | 'user';
  targetId: string;
  targetName?: string;
}

const REPORT_TYPES = [
  { value: 'inappropriate', label: 'Inappropriate content' },
  { value: 'misleading', label: 'Misleading or false information' },
  { value: 'spam', label: 'Spam or scam' },
  { value: 'offensive', label: 'Offensive or abusive' },
  { value: 'prohibited', label: 'Prohibited item or service' },
  { value: 'other', label: 'Other' },
];

export function ReportSheet({ open, onOpenChange, targetType, targetId, targetName }: ReportSheetProps) {
  const { user } = useAuth();
  const [reportType, setReportType] = useState('');
  const [description, setDescription] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async () => {
    if (!user || !reportType) {
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

      toast.success('Report submitted. Our team will review it shortly.');
      onOpenChange(false);
      setReportType('');
      setDescription('');
    } catch (error) {
      console.error('Error submitting report:', error);
      toast.error('Failed to submit report. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent>
        <DrawerHeader className="text-left pb-4">
          <DrawerTitle className="flex items-center gap-2">
            <Flag size={18} className="text-destructive" />
            Report {targetType === 'post' ? 'Post' : targetType === 'product' ? 'Product' : targetType === 'user' ? 'User' : 'Seller'}
          </DrawerTitle>
          <DrawerDescription>
            {targetName && <span>Reporting: {targetName}</span>}
          </DrawerDescription>
        </DrawerHeader>

        <div className="space-y-4 pb-4">
          <div className="space-y-2">
            <Label>Reason *</Label>
            <Select value={reportType} onValueChange={setReportType}>
              <SelectTrigger>
                <SelectValue placeholder="Select a reason" />
              </SelectTrigger>
              <SelectContent>
                {REPORT_TYPES.map(({ value, label }) => (
                  <SelectItem key={value} value={value}>{label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Additional details (optional)</Label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
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
