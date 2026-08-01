// @ts-nocheck
import { useState, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useWorkerRole } from '@/hooks/useWorkerRole';
import { AppLayout } from '@/components/layout/AppLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Briefcase, Clock, MapPin, IndianRupee, Zap, Check, AlertCircle, Volume2, VolumeX, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { friendlyError } from '@/lib/utils';
import { FeatureGate } from '@/components/ui/FeatureGate';
import { useCurrency } from '@/hooks/useCurrency';

// Job type labels fetched dynamically from worker categories or used as structural display-only labels
function useJobTypeLabels() {
  const { data: labels = {} } = useQuery({
    queryKey: ['worker-job-type-labels'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('society_worker_categories')
        .select('name')
        .eq('is_active', true);
      if (error || !data) return {};
      const map: Record<string, string> = {};
      data.forEach((c: any) => { map[c.name.toLowerCase()] = c.name; });
      return map;
    },
    staleTime: 10 * 60 * 1000,
  });
  return labels;
}

// Fetch bcp47 voice tags dynamically from DB
function useLangVoiceMap() {
  const { data: langMap = {} } = useQuery({
    queryKey: ['lang-voice-map'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('supported_languages')
        .select('code, bcp47_tag')
        .eq('is_active', true);
      if (error || !data) return {};
      const map: Record<string, string> = {};
      data.forEach((l: any) => { map[l.code] = l.bcp47_tag; });
      return map;
    },
    staleTime: 10 * 60 * 1000,
  });
  return langMap;
}

export default function WorkerJobsPage() {
  const { profile, effectiveSocietyId } = useAuth();
  const { isWorker, workerProfile } = useWorkerRole();
  const { formatPrice } = useCurrency();
  const queryClient = useQueryClient();
  const [acceptingId, setAcceptingId] = useState<string | null>(null);
  const [speakingJobId, setSpeakingJobId] = useState<string | null>(null);
  const [loadingTtsId, setLoadingTtsId] = useState<string | null>(null);
  const langVoiceMap = useLangVoiceMap();
  const jobTypeLabels = useJobTypeLabels();

  // Fetch open jobs — RLS handles cross-society visibility
  const { data: openJobs = [], isLoading } = useQuery({
    queryKey: ['worker-open-jobs', effectiveSocietyId],
    queryFn: async () => {
      if (!effectiveSocietyId) return [];
      const { data, error } = await supabase
        .from('worker_job_requests')
        .select('*, resident:profiles!worker_job_requests_resident_id_fkey(name, flat_number, block), society:societies!worker_job_requests_society_id_fkey(name)')
        .eq('status', 'open')
        .order('created_at', { ascending: false })
        .limit(50);
      if (error) throw error;
      return data || [];
    },
    enabled: !!effectiveSocietyId && isWorker,
  });

  // Realtime subscription — no society filter, RLS handles it
  useQuery({
    queryKey: ['worker-jobs-realtime', effectiveSocietyId],
    queryFn: () => {
      if (!effectiveSocietyId) return null;
      const channel = supabase
        .channel('worker-jobs')
        .on('postgres_changes', {
          event: '*',
          schema: 'public',
          table: 'worker_job_requests',
        }, () => {
          queryClient.invalidateQueries({ queryKey: ['worker-open-jobs'] });
          queryClient.invalidateQueries({ queryKey: ['worker-my-jobs'] });
        })
        .subscribe();
      return () => { supabase.removeChannel(channel); };
    },
    enabled: !!effectiveSocietyId && isWorker,
    staleTime: Infinity,
  });

  const acceptJob = useMutation({
    mutationFn: async (jobId: string) => {
      if (!profile?.id) throw new Error('Not logged in');
      const { data, error } = await supabase.rpc('accept_worker_job', {
        _job_id: jobId,
        _worker_id: profile.id,
      });
      if (error) throw error;
      const result = data as any;
      if (!result.success) throw new Error(result.error);
      return result;
    },
    onSuccess: () => {
      toast.success('Job accepted! The resident will be notified.');
      queryClient.invalidateQueries({ queryKey: ['worker-open-jobs'] });
      queryClient.invalidateQueries({ queryKey: ['worker-my-jobs'] });
      setAcceptingId(null);
    },
    onError: (error: Error) => {
      toast.error(friendlyError(error));
      setAcceptingId(null);
    },
  });

  const handleListen = useCallback(async (job: any) => {
    // If already speaking this job, stop it
    if (speakingJobId === job.id) {
      window.speechSynthesis.cancel();
      setSpeakingJobId(null);
      return;
    }

    // Stop any other speech
    window.speechSynthesis.cancel();
    setSpeakingJobId(null);
    setLoadingTtsId(job.id);

    try {
      const langCode = (workerProfile as any)?.preferred_language;
      if (!langCode) {
        toast.error('No language set on your worker profile');
        setLoadingTtsId(null);
        return;
      }
      const societyName = (job.society as any)?.name || '';

      const { data, error } = await supabase.functions.invoke('generate-job-voice-summary', {
        body: {
          job: {
            id: job.id,
            job_type: job.job_type,
            location_details: job.location_details,
            duration_hours: job.duration_hours,
            price: job.price,
            start_time: job.start_time,
            urgency: job.urgency,
          },
          language: langCode,
          society_name: societyName,
        },
      });

      if (error) throw error;
      const summary = data?.summary;
      if (!summary) throw new Error('No summary generated');

      // Use browser SpeechSynthesis with DB-driven voice tag
      const utterance = new SpeechSynthesisUtterance(summary);
      const voiceTag = langVoiceMap[langCode];
      if (!voiceTag) {
        toast.error('Voice not available for this language');
        setLoadingTtsId(null);
        return;
      }
      utterance.lang = voiceTag;
      utterance.rate = 0.9;

      // Try to find a matching voice
      const voices = window.speechSynthesis.getVoices();
      const matchedVoice = voices.find(v => v.lang.startsWith(voiceTag.split('-')[0]));
      if (matchedVoice) utterance.voice = matchedVoice;

      utterance.onend = () => setSpeakingJobId(null);
      utterance.onerror = () => setSpeakingJobId(null);

      setSpeakingJobId(job.id);
      setLoadingTtsId(null);
      window.speechSynthesis.speak(utterance);
    } catch (err) {
      console.error('TTS error:', err);
      toast.error('Could not generate voice summary');
      setLoadingTtsId(null);
    }
  }, [speakingJobId, workerProfile, langVoiceMap]);

  if (!isWorker) {
    return (
      <AppLayout headerTitle="Jobs">
        <div className="flex flex-col items-center justify-center min-h-[60vh] p-6 text-center">
          <AlertCircle className="text-muted-foreground mb-4" size={48} />
          <h2 className="text-lg font-semibold">Worker Access Only</h2>
          <p className="text-sm text-muted-foreground mt-1">You need to be registered as a worker to access this page.</p>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout headerTitle="Available Jobs">
      <FeatureGate feature="worker_marketplace">
      <div className="p-4 space-y-4 pb-24">
        <div className="flex items-center gap-2 mb-2">
          <Badge variant="secondary" className="text-xs">
            {workerProfile?.worker_type ? jobTypeLabels[workerProfile.worker_type] || workerProfile.worker_type : 'Worker'}
          </Badge>
          <Badge variant={workerProfile?.is_available ? 'default' : 'outline'} className="text-xs">
            {workerProfile?.is_available ? '🟢 Available' : '🔴 Unavailable'}
          </Badge>
        </div>

        {isLoading ? (
          <div className="space-y-3">
            {[1, 2, 3].map(i => <Skeleton key={i} className="h-40 w-full rounded-xl" />)}
          </div>
        ) : openJobs.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">
            <Briefcase size={40} className="mx-auto mb-3 opacity-50" />
            <p>No open jobs right now</p>
            <p className="text-xs mt-1">New jobs will appear here in real-time</p>
          </div>
        ) : (
          openJobs.map((job: any) => {
            const isOwnSociety = job.society_id === effectiveSocietyId;
            const societyName = (job.society as any)?.name || 'Unknown';
            return (
              <Card key={job.id} className="border-border">
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base">
                      {jobTypeLabels[job.job_type] || job.job_type}
                    </CardTitle>
                    <div className="flex items-center gap-1.5">
                      {job.urgency === 'urgent' && (
                        <Badge variant="destructive" className="text-xs">
                          <Zap size={12} className="mr-1" /> Urgent
                        </Badge>
                      )}
                      <Badge
                        variant={isOwnSociety ? 'default' : 'secondary'}
                        className={`text-[10px] ${isOwnSociety ? 'bg-success text-success-foreground hover:bg-success/90' : 'bg-info text-info-foreground hover:bg-info/90'}`}
                      >
                        {isOwnSociety ? 'Your Society' : societyName}
                      </Badge>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-2">
                  {job.description && (
                    <p className="text-sm text-muted-foreground">{job.description}</p>
                  )}
                  <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
                    {job.price && (
                      <span className="flex items-center gap-1 tabular-nums">
                        <IndianRupee size={12} /> {formatPrice(job.price)}
                      </span>
                    )}
                    {job.duration_hours && (
                      <span className="flex items-center gap-1">
                        <Clock size={12} /> {job.duration_hours}h
                      </span>
                    )}
                    {job.start_time && (
                      <span className="flex items-center gap-1">
                        <Clock size={12} /> {format(new Date(job.start_time), 'dd MMM, h:mm a')}
                      </span>
                    )}
                    {job.location_details && (
                      <span className="flex items-center gap-1">
                        <MapPin size={12} /> {job.location_details}
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    📍 {(job.resident as any)?.block}-{(job.resident as any)?.flat_number}
                  </div>
                  <div className="flex gap-2 mt-2">
                    <Button
                      variant="outline"
                      size="sm"
                      className="flex-shrink-0"
                      disabled={loadingTtsId === job.id}
                      onClick={() => handleListen(job)}
                    >
                      {loadingTtsId === job.id ? (
                        <Loader2 size={16} className="animate-spin" />
                      ) : speakingJobId === job.id ? (
                        <><VolumeX size={16} className="mr-1" /> Stop</>
                      ) : (
                        <><Volume2 size={16} className="mr-1" /> Listen</>
                      )}
                    </Button>
                    <Button
                      className="flex-1"
                      size="sm"
                      disabled={acceptingId === job.id || acceptJob.isPending}
                      onClick={() => {
                        setAcceptingId(job.id);
                        acceptJob.mutate(job.id);
                      }}
                    >
                      <Check size={16} className="mr-1" />
                      {acceptingId === job.id ? 'Accepting...' : 'Accept Job'}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })
        )}
      </div>
      </FeatureGate>
    </AppLayout>
  );
}
