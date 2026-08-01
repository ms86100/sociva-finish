// @ts-nocheck
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Star, Clock, XCircle } from 'lucide-react';
import { useStatusLabels } from '@/hooks/useStatusLabels';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { friendlyError } from '@/lib/utils';
import { useCurrency } from '@/hooks/useCurrency';
import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';

// STATUS_COLORS now provided by useStatusLabels().getWorkerJobStatus

export function ResidentJobsList() {
  const { profile } = useAuth();
  const { getWorkerJobStatus } = useStatusLabels();
  const { formatPrice } = useCurrency();
  const queryClient = useQueryClient();

  const { data: jobs = [], isLoading } = useQuery({
    queryKey: ['resident-job-requests', profile?.id],
    queryFn: async () => {
      if (!profile?.id) return [];
      const { data, error } = await supabase
        .from('worker_job_requests')
        .select('*, worker:profiles!worker_job_requests_accepted_by_fkey(name)')
        .eq('resident_id', profile.id)
        .order('created_at', { ascending: false })
        .limit(50);
      if (error) throw error;
      return data || [];
    },
    enabled: !!profile?.id,
  });

  const cancelJob = useMutation({
    mutationFn: async (jobId: string) => {
      if (!profile?.id) throw new Error('Not logged in');
      const { error } = await supabase
        .from('worker_job_requests')
        .update({ status: 'cancelled', cancelled_at: new Date().toISOString() })
        .eq('id', jobId)
        .eq('resident_id', profile.id)
        .eq('status', 'open');
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('Job cancelled');
      queryClient.invalidateQueries({ queryKey: ['resident-job-requests'] });
    },
    onError: () => toast.error('Failed to cancel'),
  });

  if (isLoading) {
    return <div className="space-y-3">{[1, 2].map(i => <Skeleton key={i} className="h-28 w-full rounded-xl" />)}</div>;
  }

  if (jobs.length === 0) {
    return <p className="text-center py-8 text-muted-foreground text-sm">No job requests yet</p>;
  }

  return (
    <div className="space-y-3">
      {jobs.map((job: any) => (
        <Card key={job.id}>
          <CardContent className="pt-4 space-y-2">
            <div className="flex justify-between items-center">
              <span className="font-medium text-sm">{job.job_type}</span>
              <Badge className={getWorkerJobStatus(job.status).color}>{getWorkerJobStatus(job.status).label}</Badge>
            </div>
            {job.description && <p className="text-xs text-muted-foreground">{job.description}</p>}
            <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
              {job.price && <span>{formatPrice(job.price)}</span>}
              {job.duration_hours && <span>• {job.duration_hours}h</span>}
              {job.start_time && <span>• {format(new Date(job.start_time), 'dd MMM, h:mm a')}</span>}
            </div>
            {job.status === 'accepted' && (job.worker as any)?.name && (
              <p className="text-xs font-medium text-primary">Worker: {(job.worker as any).name}</p>
            )}

            <div className="flex gap-2">
              {job.status === 'open' && (
                <Button
                  size="sm"
                  variant="destructive"
                  className="flex-1"
                  onClick={() => cancelJob.mutate(job.id)}
                  disabled={cancelJob.isPending}
                >
                  <XCircle size={14} className="mr-1" /> Cancel
                </Button>
              )}
              {job.status === 'completed' && !job.resident_rating && (
                <RateWorkerDialog jobId={job.id} />
              )}
              {job.resident_rating && (
                <span className="text-xs text-muted-foreground flex items-center gap-1">
                  <Star size={12} className="fill-warning text-warning" /> {job.resident_rating}/5
                </span>
              )}
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function RateWorkerDialog({ jobId }: { jobId: string }) {
  const [rating, setRating] = useState('5');
  const [review, setReview] = useState('');
  const [open, setOpen] = useState(false);
  const queryClient = useQueryClient();

  const rateWorker = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc('rate_worker_job', {
        _job_id: jobId,
        _rating: parseInt(rating),
        _review: review || null,
      });
      if (error) throw error;
      const result = data as any;
      if (!result.success) throw new Error(result.error);
    },
    onSuccess: () => {
      toast.success('Rating submitted!');
      queryClient.invalidateQueries({ queryKey: ['resident-job-requests'] });
      setOpen(false);
    },
    onError: (error: Error) => toast.error(friendlyError(error)),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" className="flex-1">
          <Star size={14} className="mr-1" /> Rate Worker
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Rate Worker</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Rating (1-5)</Label>
            <Input type="number" min="1" max="5" value={rating} onChange={e => setRating(e.target.value)} />
          </div>
          <div>
            <Label>Review (optional)</Label>
            <Textarea value={review} onChange={e => setReview(e.target.value)} placeholder="How was the service?" />
          </div>
          <Button className="w-full" onClick={() => rateWorker.mutate()} disabled={rateWorker.isPending}>
            Submit Rating
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
