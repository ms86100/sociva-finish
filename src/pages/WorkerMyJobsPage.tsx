// @ts-nocheck
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useWorkerRole } from '@/hooks/useWorkerRole';
import { AppLayout } from '@/components/layout/AppLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { CheckCircle, Clock, XCircle, AlertCircle } from 'lucide-react';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { friendlyError } from '@/lib/utils';
import { FeatureGate } from '@/components/ui/FeatureGate';
import { useCurrency } from '@/hooks/useCurrency';

const STATUS_CONFIG: Record<string, { label: string; color: string }> = {
  accepted: { label: 'Active', color: 'bg-info/20 text-info' },
  completed: { label: 'Completed', color: 'bg-success/20 text-success' },
  cancelled: { label: 'Cancelled', color: 'bg-destructive/20 text-destructive' },
};

export default function WorkerMyJobsPage() {
  const { profile } = useAuth();
  const { isWorker } = useWorkerRole();
  const { formatPrice } = useCurrency();
  const queryClient = useQueryClient();

  const { data: myJobs = [], isLoading } = useQuery({
    queryKey: ['worker-my-jobs', profile?.id],
    queryFn: async () => {
      if (!profile?.id) return [];
      const { data, error } = await supabase
        .from('worker_job_requests')
        .select('*, resident:profiles!worker_job_requests_resident_id_fkey(name, flat_number, block)')
        .eq('accepted_by', profile.id)
        .order('created_at', { ascending: false })
        .limit(50);
      if (error) throw error;
      return data || [];
    },
    enabled: !!profile?.id && isWorker,
  });

  const completeJob = useMutation({
    mutationFn: async (jobId: string) => {
      if (!profile?.id) throw new Error('Not logged in');
      const { data, error } = await supabase.rpc('complete_worker_job', {
        _job_id: jobId,
        _worker_id: profile.id,
      });
      if (error) throw error;
      const result = data as any;
      if (!result.success) throw new Error(result.error);
      return result;
    },
    onSuccess: () => {
      toast.success('Job marked as completed!');
      queryClient.invalidateQueries({ queryKey: ['worker-my-jobs'] });
    },
    onError: (error: Error) => toast.error(friendlyError(error)),
  });

  if (!isWorker) {
    return (
      <AppLayout headerTitle="My Jobs">
        <div className="flex flex-col items-center justify-center min-h-[60vh] p-6 text-center">
          <AlertCircle className="text-muted-foreground mb-4" size={48} />
          <h2 className="text-lg font-semibold">Worker Access Only</h2>
        </div>
      </AppLayout>
    );
  }

  const activeJobs = myJobs.filter((j: any) => j.status === 'accepted');
  const completedJobs = myJobs.filter((j: any) => j.status === 'completed');

  return (
    <AppLayout headerTitle="My Jobs">
      <FeatureGate feature="worker_marketplace">
      <div className="p-4 pb-24">
        <Tabs defaultValue="active">
          <TabsList className="w-full">
            <TabsTrigger value="active" className="flex-1 min-h-[40px]">Active ({activeJobs.length})</TabsTrigger>
            <TabsTrigger value="completed" className="flex-1 min-h-[40px]">Completed ({completedJobs.length})</TabsTrigger>
          </TabsList>

          <TabsContent value="active" className="space-y-3 mt-3">
            {isLoading ? (
              [1, 2].map(i => <Skeleton key={i} className="h-32 w-full rounded-xl" />)
            ) : activeJobs.length === 0 ? (
              <p className="text-center py-8 text-muted-foreground text-sm">No active jobs</p>
            ) : (
              activeJobs.map((job: any) => (
                <Card key={job.id}>
                  <CardHeader className="pb-2">
                    <div className="flex justify-between items-center">
                      <CardTitle className="text-base">{job.job_type}</CardTitle>
                      <Badge className={STATUS_CONFIG.accepted.color}>{STATUS_CONFIG.accepted.label}</Badge>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    {job.description && <p className="text-sm text-muted-foreground">{job.description}</p>}
                    <p className="text-xs text-muted-foreground tabular-nums">
                      📍 {(job.resident as any)?.block}-{(job.resident as any)?.flat_number} • 
                      {job.start_time && ` ${format(new Date(job.start_time), 'dd MMM, h:mm a')}`}
                      {job.price && ` • ${formatPrice(job.price)}`}
                    </p>
                    <Button
                      size="sm"
                      className="w-full"
                      onClick={() => completeJob.mutate(job.id)}
                      disabled={completeJob.isPending}
                    >
                      <CheckCircle size={16} className="mr-1" /> Mark Complete
                    </Button>
                  </CardContent>
                </Card>
              ))
            )}
          </TabsContent>

          <TabsContent value="completed" className="space-y-3 mt-3">
            {completedJobs.length === 0 ? (
              <p className="text-center py-8 text-muted-foreground text-sm">No completed jobs yet</p>
            ) : (
              completedJobs.map((job: any) => (
                <Card key={job.id} className="opacity-80">
                  <CardContent className="pt-4">
                    <div className="flex justify-between items-center">
                      <span className="font-medium text-sm">{job.job_type}</span>
                      <Badge className={STATUS_CONFIG.completed.color}>{STATUS_CONFIG.completed.label}</Badge>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1 tabular-nums">
                      {job.completed_at && format(new Date(job.completed_at), 'dd MMM yyyy')}
                      {job.resident_rating && ` • ⭐ ${job.resident_rating}/5`}
                      {job.price && ` • ${formatPrice(job.price)}`}
                    </p>
                  </CardContent>
                </Card>
              ))
            )}
          </TabsContent>
        </Tabs>
      </div>
      </FeatureGate>
    </AppLayout>
  );
}
