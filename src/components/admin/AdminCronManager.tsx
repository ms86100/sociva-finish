// @ts-nocheck
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Clock, Play, Pause, Settings2, History, Loader2, RefreshCw, Timer, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';

interface CronJob {
  jobid: number;
  jobname: string;
  schedule: string;
  command: string;
  active: boolean;
}

interface CronRun {
  runid: number;
  job_id: number;
  status: string;
  return_message: string;
  start_time: string;
  end_time: string;
}

// Human-readable cron descriptions
function describeCron(schedule: string): string {
  const parts = schedule.trim().split(/\s+/);
  if (parts.length !== 5) return schedule;
  const [min, hour, dom, mon, dow] = parts;

  if (min === '*' && hour === '*' && dom === '*' && mon === '*' && dow === '*') return 'Every minute';
  if (min.startsWith('*/') && hour === '*') return `Every ${min.slice(2)} minutes`;
  if (hour.startsWith('*/') && min === '0') return `Every ${hour.slice(2)} hours`;
  if (min !== '*' && hour !== '*' && dom === '*') return `Daily at ${hour.padStart(2, '0')}:${min.padStart(2, '0')}`;
  return schedule;
}

// Extract function name from command
function extractFunctionName(command: string): string {
  const match = command.match(/functions\/v1\/([a-z0-9-]+)/i);
  return match?.[1] || 'unknown';
}

const PRESET_SCHEDULES = [
  { label: 'Every minute', value: '* * * * *' },
  { label: 'Every 5 min', value: '*/5 * * * *' },
  { label: 'Every 10 min', value: '*/10 * * * *' },
  { label: 'Every 30 min', value: '*/30 * * * *' },
  { label: 'Hourly', value: '0 * * * *' },
  { label: 'Every 6h', value: '0 */6 * * *' },
  { label: 'Every 12h', value: '0 */12 * * *' },
  { label: 'Daily 2 AM', value: '0 2 * * *' },
];

export function AdminCronManager() {
  const queryClient = useQueryClient();
  const [editingJob, setEditingJob] = useState<CronJob | null>(null);
  const [customSchedule, setCustomSchedule] = useState('');
  const [viewingRuns, setViewingRuns] = useState<CronJob | null>(null);

  const { data: jobs = [], isLoading } = useQuery({
    queryKey: ['admin-cron-jobs'],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke('manage-cron-jobs', {
        body: { action: 'list' },
      });
      if (error) throw error;
      return (data?.jobs || []) as CronJob[];
    },
    staleTime: 2 * 60_000,
  });

  const { data: runs = [], isLoading: loadingRuns } = useQuery({
    queryKey: ['admin-cron-runs', viewingRuns?.jobid],
    queryFn: async () => {
      if (!viewingRuns) return [];
      const { data, error } = await supabase.functions.invoke('manage-cron-jobs', {
        body: { action: 'recent_runs', jobid: viewingRuns.jobid },
      });
      if (error) throw error;
      return (data?.runs || []) as CronRun[];
    },
    enabled: !!viewingRuns,
    staleTime: 60_000,
  });

  const toggleMutation = useMutation({
    mutationFn: async ({ jobid, active }: { jobid: number; active: boolean }) => {
      const { error } = await supabase.functions.invoke('manage-cron-jobs', {
        body: { action: 'toggle', jobid, active },
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-cron-jobs'] });
      toast.success('Job updated');
    },
    onError: (err: any) => toast.error(err.message || 'Failed to update'),
  });

  const scheduleMutation = useMutation({
    mutationFn: async ({ jobid, schedule }: { jobid: number; schedule: string }) => {
      const { error } = await supabase.functions.invoke('manage-cron-jobs', {
        body: { action: 'update_schedule', jobid, schedule },
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-cron-jobs'] });
      setEditingJob(null);
      toast.success('Schedule updated');
    },
    onError: (err: any) => toast.error(err.message || 'Failed to update schedule'),
  });

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Timer size={15} className="text-primary" />
          <h4 className="text-sm font-bold text-foreground">Scheduled Jobs</h4>
          <Badge variant="secondary" className="text-[10px] h-5 rounded-md">{jobs.length}</Badge>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="h-8 w-8 p-0 rounded-xl"
          onClick={() => queryClient.invalidateQueries({ queryKey: ['admin-cron-jobs'] })}
        >
          <RefreshCw size={14} className="text-muted-foreground" />
        </Button>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-8">
          <Loader2 size={20} className="animate-spin text-muted-foreground" />
        </div>
      ) : jobs.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-6">No cron jobs found</p>
      ) : (
        <div className="space-y-2">
          {jobs.map((job) => (
            <Card key={job.jobid} className="border-0 shadow-[var(--shadow-card)] rounded-2xl">
              <CardContent className="p-3.5">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-start gap-3 min-w-0 flex-1">
                    <div className={cn(
                      'w-9 h-9 rounded-xl flex items-center justify-center shrink-0',
                      job.active ? 'bg-emerald-500/10' : 'bg-muted'
                    )}>
                      {job.active ? <Play size={14} className="text-emerald-600" /> : <Pause size={14} className="text-muted-foreground" />}
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-bold truncate">{extractFunctionName(job.command)}</p>
                      <p className="text-[11px] text-muted-foreground font-medium truncate">{job.jobname}</p>
                      <div className="flex items-center gap-1.5 mt-1">
                        <Clock size={10} className="text-muted-foreground shrink-0" />
                        <span className="text-[11px] text-muted-foreground font-medium">{describeCron(job.schedule)}</span>
                        <Badge
                          variant={job.active ? 'default' : 'secondary'}
                          className="text-[9px] h-4 rounded-md ml-1"
                        >
                          {job.active ? 'Active' : 'Paused'}
                        </Badge>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 w-8 p-0 rounded-xl"
                      onClick={() => setViewingRuns(job)}
                    >
                      <History size={14} className="text-muted-foreground" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 w-8 p-0 rounded-xl"
                      onClick={() => {
                        setEditingJob(job);
                        setCustomSchedule(job.schedule);
                      }}
                    >
                      <Settings2 size={14} className="text-muted-foreground" />
                    </Button>
                    <Switch
                      checked={job.active}
                      onCheckedChange={(active) => toggleMutation.mutate({ jobid: job.jobid, active })}
                      disabled={toggleMutation.isPending}
                    />
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Edit Schedule Dialog */}
      <Dialog open={!!editingJob} onOpenChange={() => setEditingJob(null)}>
        <DialogContent className="rounded-2xl">
          <DialogHeader>
            <DialogTitle className="font-bold text-sm">
              Edit Schedule — {editingJob && extractFunctionName(editingJob.command)}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <p className="text-xs text-muted-foreground font-medium mb-2">Preset Schedules</p>
              <div className="grid grid-cols-2 gap-1.5">
                {PRESET_SCHEDULES.map((preset) => (
                  <Button
                    key={preset.value}
                    variant={customSchedule === preset.value ? 'default' : 'outline'}
                    size="sm"
                    className="h-8 text-xs rounded-xl font-medium"
                    onClick={() => setCustomSchedule(preset.value)}
                  >
                    {preset.label}
                  </Button>
                ))}
              </div>
            </div>
            <div>
              <p className="text-xs text-muted-foreground font-medium mb-1.5">Custom Cron Expression</p>
              <Input
                value={customSchedule}
                onChange={(e) => setCustomSchedule(e.target.value)}
                placeholder="* * * * *"
                className="rounded-xl font-mono text-sm"
              />
              <p className="text-[10px] text-muted-foreground mt-1">Format: minute hour day month weekday</p>
            </div>
            <Button
              className="w-full rounded-xl h-10 font-semibold"
              disabled={!customSchedule || scheduleMutation.isPending}
              onClick={() => editingJob && scheduleMutation.mutate({ jobid: editingJob.jobid, schedule: customSchedule })}
            >
              {scheduleMutation.isPending ? <Loader2 size={14} className="animate-spin mr-1.5" /> : null}
              Save Schedule
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Run History Dialog */}
      <Dialog open={!!viewingRuns} onOpenChange={() => setViewingRuns(null)}>
        <DialogContent className="rounded-2xl max-h-[80dvh]">
          <DialogHeader>
            <DialogTitle className="font-bold text-sm">
              Run History — {viewingRuns && extractFunctionName(viewingRuns.command)}
            </DialogTitle>
          </DialogHeader>
          <ScrollArea className="max-h-[60vh]">
            {loadingRuns ? (
              <div className="flex justify-center py-8">
                <Loader2 size={20} className="animate-spin text-muted-foreground" />
              </div>
            ) : runs.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-6">No recent runs</p>
            ) : (
              <div className="space-y-1.5">
                {runs.map((run) => (
                  <div
                    key={run.runid}
                    className={cn(
                      'p-2.5 rounded-xl text-xs',
                      run.status === 'succeeded' ? 'bg-emerald-500/5' : 'bg-destructive/5'
                    )}
                  >
                    <div className="flex items-center justify-between">
                      <Badge
                        variant={run.status === 'succeeded' ? 'default' : 'destructive'}
                        className="text-[9px] h-4 rounded-md"
                      >
                        {run.status}
                      </Badge>
                      <span className="text-[10px] text-muted-foreground">
                        {run.start_time ? format(new Date(run.start_time), 'MMM d, HH:mm:ss') : '—'}
                      </span>
                    </div>
                    {run.return_message && run.status !== 'succeeded' && (
                      <p className="text-[10px] text-muted-foreground mt-1 line-clamp-2">
                        {run.return_message}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </ScrollArea>
        </DialogContent>
      </Dialog>
    </div>
  );
}
