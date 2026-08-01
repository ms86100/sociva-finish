// @ts-nocheck
import { useState, useCallback, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { AppLayout } from '@/components/layout/AppLayout';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Skeleton } from '@/components/ui/skeleton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { FeatureGate } from '@/components/ui/FeatureGate';
import { WorkerRegistrationSheet } from '@/components/workforce/WorkerRegistrationSheet';
import { WorkerCategoryManager } from '@/components/workforce/WorkerCategoryManager';
import { WorkerCard } from '@/components/workforce/WorkerCard';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useAuth } from '@/contexts/AuthContext';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { logAudit } from '@/lib/audit';
import { UserPlus, Users, Shield, AlertTriangle, Settings } from 'lucide-react';
import { ModuleSearchBar } from '@/components/search/ModuleSearchBar';

export default function WorkforceManagementPage() {
  const { user, profile, effectiveSocietyId, isSocietyAdmin, isAdmin, isBuilderMember } = useAuth();
  const queryClient = useQueryClient();
  const [isRegisterOpen, setIsRegisterOpen] = useState(false);
  const [activeTab, setActiveTab] = useState('active');
  const [filterType, setFilterType] = useState<string>('all');
  const [confirmAction, setConfirmAction] = useState<{ workerId: string; workerName: string; action: 'suspended' | 'blacklisted' } | null>(null);

  const { data: categories = [] } = useQuery({
    queryKey: ['worker-categories', effectiveSocietyId],
    queryFn: async () => {
      if (!effectiveSocietyId) return [];
      const { data } = await supabase
        .from('society_worker_categories')
        .select('*')
        .eq('society_id', effectiveSocietyId)
        .eq('is_active', true)
        .order('display_order');
      return data || [];
    },
    enabled: !!effectiveSocietyId,
  });

  const statusFilter = activeTab === 'active' ? 'active' :
    activeTab === 'suspended' ? 'suspended' :
    activeTab === 'blacklisted' ? 'blacklisted' : null;

  const { data: workers = [], isLoading } = useQuery({
    queryKey: ['workforce', effectiveSocietyId, statusFilter, filterType],
    queryFn: async () => {
      if (!effectiveSocietyId) return [];
      let query = supabase
        .from('society_workers')
        .select('*')
        .eq('society_id', effectiveSocietyId);

      if (statusFilter) query = query.eq('status', statusFilter);
      if (filterType !== 'all') query = query.eq('worker_type', filterType);

      const { data } = await query.order('created_at', { ascending: false });
      return data || [];
    },
    enabled: !!effectiveSocietyId,
  });

  const { data: flatAssignments = [] } = useQuery({
    queryKey: ['flat-assignments', effectiveSocietyId],
    queryFn: async () => {
      if (!effectiveSocietyId) return [];
      const { data } = await supabase
        .from('worker_flat_assignments')
        .select('*')
        .eq('society_id', effectiveSocietyId)
        .eq('is_active', true);
      return data || [];
    },
    enabled: !!effectiveSocietyId,
  });

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['workforce'] });
    queryClient.invalidateQueries({ queryKey: ['flat-assignments'] });
  };

  const updateWorkerStatus = async (workerId: string, status: string, reason?: string) => {
    const update: any = { status, updated_at: new Date().toISOString() };
    if (reason) update.suspension_reason = reason;
    if (status === 'active') { update.suspension_reason = null; update.deactivated_at = null; }

    if (!effectiveSocietyId) return;
    const { error } = await supabase.from('society_workers').update(update).eq('id', workerId).eq('society_id', effectiveSocietyId);
    if (!error) {
      toast.success(`Worker ${status}`);
      await logAudit(`worker_${status}`, 'society_worker', workerId, effectiveSocietyId!, { status });
      refresh();
    }
  };

  const workerTypes = [...new Set(workers.map(w => w.worker_type))];
  const activeCount = workers.filter(w => w.status === 'active').length;
  const suspendedCount = workers.filter(w => w.status === 'suspended').length;
  const blacklistedCount = workers.filter(w => w.status === 'blacklisted').length;

  const canManage = isSocietyAdmin || isAdmin || isBuilderMember;

  return (
    <AppLayout headerTitle="Workforce" showLocation={false}>
      <FeatureGate feature={["workforce_management", "domestic_help"]}>
        <div className="p-4 space-y-4 pb-24">
          <ModuleSearchBar context="workforce" value="" onChange={() => {}} />
          {/* Summary Stats */}
          <div className="grid grid-cols-3 gap-3">
            <Card><CardContent className="p-3 text-center">
              <Users className="mx-auto text-primary mb-1" size={18} />
              <p className="text-lg font-bold">{activeCount}</p>
              <p className="text-[10px] text-muted-foreground">Active</p>
            </CardContent></Card>
            <Card><CardContent className="p-3 text-center">
              <AlertTriangle className="mx-auto text-warning mb-1" size={18} />
              <p className="text-lg font-bold">{suspendedCount}</p>
              <p className="text-[10px] text-muted-foreground">Suspended</p>
            </CardContent></Card>
            <Card><CardContent className="p-3 text-center">
              <Shield className="mx-auto text-destructive mb-1" size={18} />
              <p className="text-lg font-bold">{blacklistedCount}</p>
              <p className="text-[10px] text-muted-foreground">Blacklisted</p>
            </CardContent></Card>
          </div>

          {/* Actions */}
          {canManage && (
            <div className="flex gap-2">
              <Button onClick={() => setIsRegisterOpen(true)} className="flex-1">
                <UserPlus size={16} className="mr-1" /> Register Worker
              </Button>
            </div>
          )}

          {/* Filter */}
          {workerTypes.length > 1 && (
            <Select value={filterType} onValueChange={setFilterType}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Filter by type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Types</SelectItem>
                {workerTypes.map(t => (
                  <SelectItem key={t} value={t} className="capitalize">{t}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}

          {/* Tabs */}
          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList className="w-full grid grid-cols-4">
              <TabsTrigger value="active" className="text-xs">Active</TabsTrigger>
              <TabsTrigger value="suspended" className="text-xs">Suspended</TabsTrigger>
              <TabsTrigger value="blacklisted" className="text-xs">Blacklisted</TabsTrigger>
              {canManage && <TabsTrigger value="categories" className="text-xs">Categories</TabsTrigger>}
            </TabsList>

            <TabsContent value="categories" className="mt-3">
              {canManage && <WorkerCategoryManager />}
            </TabsContent>

            {['active', 'suspended', 'blacklisted'].map(tab => (
              <TabsContent key={tab} value={tab} className="mt-3 space-y-3">
                {isLoading ? (
                  Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-24 w-full rounded-xl" />)
                ) : workers.length === 0 ? (
                  <div className="text-center py-12 text-muted-foreground">
                    <Users className="mx-auto mb-3" size={32} />
                    <p className="text-sm">No {tab} workers</p>
                    <p className="text-xs mt-1">Register and manage domestic workers, security, and maintenance staff for your community.</p>
                  </div>
                ) : (
                  workers.map(worker => (
                    <WorkerCard
                      key={worker.id}
                      worker={worker}
                      flatAssignments={flatAssignments.filter(fa => fa.worker_id === worker.id)}
                      showActions={canManage}
                      onSuspend={() => setConfirmAction({ workerId: worker.id, workerName: worker.worker_type + ' worker', action: 'suspended' })}
                      onBlacklist={() => setConfirmAction({ workerId: worker.id, workerName: worker.worker_type + ' worker', action: 'blacklisted' })}
                      onReactivate={() => updateWorkerStatus(worker.id, 'active')}
                    />
                  ))
                )}
              </TabsContent>
            ))}
          </Tabs>

          <WorkerRegistrationSheet
            open={isRegisterOpen}
            onOpenChange={setIsRegisterOpen}
            onSuccess={refresh}
            categories={categories.map(c => ({ id: c.id, name: c.name, entry_type: c.entry_type }))}
          />

          {/* Confirmation dialog for suspend/blacklist */}
          <AlertDialog open={!!confirmAction} onOpenChange={(open) => !open && setConfirmAction(null)}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>
                  {confirmAction?.action === 'suspended' ? 'Suspend' : 'Blacklist'} "{confirmAction?.workerName}"?
                </AlertDialogTitle>
                <AlertDialogDescription>
                  {confirmAction?.action === 'suspended'
                    ? 'This worker will be temporarily suspended and won\'t be able to enter the premises until reactivated.'
                    : 'This worker will be blacklisted and permanently blocked from entry. This action can be reversed by an admin.'}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  className={confirmAction?.action === 'blacklisted' ? 'bg-destructive text-destructive-foreground hover:bg-destructive/90' : ''}
                  onClick={() => {
                    if (confirmAction) {
                      updateWorkerStatus(confirmAction.workerId, confirmAction.action, 'Admin action');
                      setConfirmAction(null);
                    }
                  }}
                >
                  {confirmAction?.action === 'suspended' ? 'Suspend' : 'Blacklist'}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </FeatureGate>
    </AppLayout>
  );
}
