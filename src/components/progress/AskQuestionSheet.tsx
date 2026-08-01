// @ts-nocheck
import { useState } from 'react';
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerTrigger } from '@/components/ui/drawer';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent } from '@/components/ui/card';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Plus, Loader2, AlertCircle } from 'lucide-react';
import { toast } from 'sonner';
import { friendlyError } from '@/lib/utils';

interface AskQuestionSheetProps {
  onAsked: () => void;
  existingQuestions: string[];
}

export function AskQuestionSheet({ onAsked, existingQuestions }: AskQuestionSheetProps) {
  const { user, profile, viewAsSocietyId } = useAuth();
  const [open, setOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [questionText, setQuestionText] = useState('');
  const [category, setCategory] = useState('general');

  const similarQuestions = questionText.length > 10
    ? existingQuestions.filter((eq) => {
        const words = questionText.toLowerCase().split(/\s+/).filter(w => w.length > 3);
        const matches = words.filter(w => eq.toLowerCase().includes(w));
        return matches.length >= 2;
      }).slice(0, 3)
    : [];

  const handleSubmit = async () => {
    if (!user || !profile?.society_id || !questionText.trim()) return;
    setIsSubmitting(true);

    try {
      const { error } = await supabase.from('project_questions').insert({
        society_id: profile.society_id,
        asked_by: user.id,
        category,
        question_text: questionText.trim(),
      });
      if (error) throw error;

      toast.success('Question posted');
      setQuestionText(''); setCategory('general');
      setOpen(false);
      onAsked();
    } catch (error: any) {
      toast.error(friendlyError(error));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Drawer open={open} onOpenChange={setOpen}>
      <DrawerTrigger asChild>
        <Button size="sm" variant="outline" className="gap-1 h-7 text-xs">
          <Plus size={12} /> Ask
        </Button>
      </DrawerTrigger>
      <DrawerContent className="max-h-[85vh] overflow-y-auto">
        <DrawerHeader><DrawerTitle>Ask a Question</DrawerTitle></DrawerHeader>
        <div className="space-y-4 px-4 pb-6">
          <div>
            <label className="text-sm font-medium">Category</label>
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="construction">Construction</SelectItem>
                <SelectItem value="timeline">Timeline</SelectItem>
                <SelectItem value="payment">Payment</SelectItem>
                <SelectItem value="legal">Legal</SelectItem>
                <SelectItem value="amenities">Amenities</SelectItem>
                <SelectItem value="general">General</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-sm font-medium">Your Question *</label>
            <Textarea
              value={questionText}
              onChange={(e) => setQuestionText(e.target.value)}
              placeholder="What would you like to know?"
              rows={3}
            />
          </div>

          {similarQuestions.length > 0 && (
            <Card className="border-warning/30">
              <CardContent className="p-3 space-y-1.5">
                <div className="flex items-center gap-1 text-warning text-xs font-medium">
                  <AlertCircle size={12} />
                  Similar questions already asked:
                </div>
                {similarQuestions.map((q, i) => (
                  <p key={i} className="text-[10px] text-muted-foreground line-clamp-1">• {q}</p>
                ))}
              </CardContent>
            </Card>
          )}

          <Button onClick={handleSubmit} disabled={isSubmitting || !questionText.trim() || !!viewAsSocietyId} className="w-full">
            {isSubmitting && <Loader2 className="animate-spin mr-2" size={16} />}
            Post Question
          </Button>
          {viewAsSocietyId && (
            <p className="text-xs text-muted-foreground text-center">You are viewing another society. Switch back to create content.</p>
          )}
        </div>
      </DrawerContent>
    </Drawer>
  );
}
