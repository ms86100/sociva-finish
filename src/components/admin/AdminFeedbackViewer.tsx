// @ts-nocheck
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Skeleton } from '@/components/ui/skeleton';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { format } from 'date-fns';

const EMOJIS = ['😞', '😐', '🙂', '😊', '🤩'];

const ratingColors: Record<number, string> = {
  1: 'bg-destructive/10 text-destructive',
  2: 'bg-warning/10 text-warning',
  3: 'bg-muted text-muted-foreground',
  4: 'bg-success/10 text-success',
  5: 'bg-success/10 text-success',
};

interface FeedbackRow {
  id: string;
  user_id: string;
  rating: number;
  message: string | null;
  page_context: string | null;
  created_at: string;
  profile?: { name: string; flat_number: string; block: string } | null;
}

export default function AdminFeedbackViewer() {
  const { data: feedback = [], isLoading } = useQuery({
    queryKey: ['admin-user-feedback'],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('user_feedback')
        .select('*, profile:profiles!user_feedback_user_id_fkey(name, flat_number, block)')
        .order('created_at', { ascending: false })
        .limit(100);
      if (error) throw error;
      return (data || []) as FeedbackRow[];
    },
  });

  const avgRating = feedback.length
    ? (feedback.reduce((sum, f) => sum + f.rating, 0) / feedback.length).toFixed(1)
    : '—';

  if (isLoading) {
    return (
      <div className="p-4 space-y-3">
        {[1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-20 w-full rounded-xl" />
        ))}
      </div>
    );
  }

  if (feedback.length === 0) {
    return (
      <div className="p-8 text-center text-muted-foreground">
        <p className="font-medium">No feedback yet</p>
        <p className="text-sm mt-1">User feedback will appear here once submitted.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Summary strip */}
      <div className="flex items-center gap-4 px-1">
        <div className="text-sm text-muted-foreground">
          <span className="font-semibold text-foreground text-lg">{feedback.length}</span> responses
        </div>
        <div className="text-sm text-muted-foreground">
          Avg rating: <span className="font-semibold text-foreground">{avgRating}</span> / 5
        </div>
        <div className="flex gap-1 ml-auto">
          {[1, 2, 3, 4, 5].map((r) => {
            const count = feedback.filter((f) => f.rating === r).length;
            return (
              <Badge key={r} variant="secondary" className="text-xs tabular-nums gap-1">
                {EMOJIS[r - 1]} {count}
              </Badge>
            );
          })}
        </div>
      </div>

      {/* Feedback list */}
      <div className="space-y-2">
        {feedback.map((f) => (
          <Card key={f.id} className="border-border/50">
            <CardContent className="p-3 flex gap-3 items-start">
              <span className="text-2xl shrink-0">{EMOJIS[f.rating - 1]}</span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-medium text-foreground">
                    {(f as any).profile?.name || 'Anonymous'}
                  </span>
                  {(f as any).profile?.flat_number && (
                    <span className="text-xs text-muted-foreground">
                      {(f as any).profile.block}-{(f as any).profile.flat_number}
                    </span>
                  )}
                  <Badge variant="outline" className={`text-[10px] px-1.5 ${ratingColors[f.rating]}`}>
                    {f.rating}/5
                  </Badge>
                  <span className="text-[10px] text-muted-foreground ml-auto shrink-0">
                    {format(new Date(f.created_at), 'dd MMM yyyy, hh:mm a')}
                  </span>
                </div>
                {f.message && (
                  <p className="text-sm text-muted-foreground mt-1">{f.message}</p>
                )}
                {f.page_context && (
                  <span className="text-[10px] text-muted-foreground/60 mt-0.5 block">
                    from: {f.page_context}
                  </span>
                )}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
