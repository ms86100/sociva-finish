// @ts-nocheck
import { supabase } from '@/integrations/supabase/client';
import { AppLayout } from '@/components/layout/AppLayout';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuth } from '@/contexts/AuthContext';
import { useQuery } from '@tanstack/react-query';
import { User, Phone, Star, Clock, Users } from 'lucide-react';
import { FeatureGate } from '@/components/ui/FeatureGate';

export default function MyWorkersPage() {
  const { user, profile, effectiveSocietyId } = useAuth();

  const { data: assignments = [], isLoading } = useQuery({
    queryKey: ['my-workers', effectiveSocietyId, profile?.flat_number],
    queryFn: async () => {
      if (!effectiveSocietyId || !profile?.flat_number) return [];
      const { data } = await (supabase
        .from('worker_flat_assignments')
        .select(`
          *,
          worker:society_workers!worker_flat_assignments_worker_id_fkey(
            id, worker_type, emergency_contact_phone, photo_url, rating, total_ratings, total_jobs,
            status, allowed_shift_start, allowed_shift_end, active_days, skills
          )
        `) as any)
        .eq('society_id', effectiveSocietyId)
        .eq('flat_number', profile.flat_number)
        .eq('is_active', true);
      return data || [];
    },
    enabled: !!effectiveSocietyId && !!profile?.flat_number,
  });

  const workerCount = assignments.length;

  return (
    <AppLayout headerTitle="My Workers" showLocation={false}>
      <FeatureGate feature={["workforce_management", "domestic_help"]}>
      <div className="p-4 space-y-4">
        {/* Summary Card */}
        <Card className="bg-primary/5 border-primary/20">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center">
              <Users size={20} className="text-primary" />
            </div>
            <div>
              <p className="text-2xl font-bold tabular-nums">{isLoading ? '—' : workerCount}</p>
              <p className="text-xs text-muted-foreground">
                {workerCount === 1 ? 'worker' : 'workers'} assigned to your flat
              </p>
            </div>
          </CardContent>
        </Card>

        {isLoading ? (
          Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-24 w-full rounded-xl" />)
        ) : assignments.length === 0 ? (
          <div className="text-center py-16 text-muted-foreground">
            <Users className="mx-auto mb-3" size={32} />
            <p className="text-sm">No workers assigned to your flat</p>
            <p className="text-xs mt-1">Workers registered by your society admin will appear here</p>
          </div>
        ) : (
          <div className="space-y-3">
            {assignments.map((assignment: any) => {
              const worker = assignment.worker;
              if (!worker) return null;
              const workerName = worker.skills?.name || worker.worker_type;
              return (
                <Card key={assignment.id}>
                  <CardContent className="p-4 flex items-start gap-3">
                    {worker.photo_url ? (
                      <img src={worker.photo_url} alt="" className="w-14 h-14 rounded-full object-cover" />
                    ) : (
                      <div className="w-14 h-14 rounded-full bg-muted flex items-center justify-center">
                        <User size={24} className="text-muted-foreground" />
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="font-semibold capitalize">{workerName}</p>
                        <Badge
                          variant={worker.status === 'active' ? 'default' : 'destructive'}
                          className="text-[10px]"
                        >
                          {worker.status}
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground capitalize">{worker.worker_type}</p>
                      {worker.emergency_contact_phone && (
                        <div className="flex items-center gap-1 mt-1">
                          <Phone size={12} className="text-muted-foreground" />
                          <a href={`tel:${worker.emergency_contact_phone}`} className="text-xs text-primary">{worker.emergency_contact_phone}</a>
                        </div>
                      )}
                      <div className="flex items-center gap-3 mt-1.5">
                        {worker.rating > 0 && (
                          <div className="flex items-center gap-0.5">
                            <Star size={12} className="text-warning fill-warning" />
                            <span className="text-xs">{worker.rating} ({worker.total_ratings})</span>
                          </div>
                        )}
                        {worker.total_jobs > 0 && (
                          <span className="text-xs text-muted-foreground">{worker.total_jobs} jobs</span>
                        )}
                      </div>
                      {(worker.allowed_shift_start || worker.active_days) && (
                        <div className="flex items-center gap-1 mt-1">
                          <Clock size={10} className="text-muted-foreground" />
                          <span className="text-[10px] text-muted-foreground">
                            {worker.allowed_shift_start && worker.allowed_shift_end
                              ? `${worker.allowed_shift_start} - ${worker.allowed_shift_end}`
                              : ''}
                            {worker.active_days?.length > 0 ? ` · ${worker.active_days.join(', ')}` : ''}
                          </span>
                        </div>
                      )}
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>
      </FeatureGate>
    </AppLayout>
  );
}
