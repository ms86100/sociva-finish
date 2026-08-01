// @ts-nocheck
import { useState, useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { AppLayout } from '@/components/layout/AppLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { toast } from 'sonner';
import { useNavigate } from 'react-router-dom';
import { jobRequestSchema, validateForm } from '@/lib/validation-schemas';
import { useCurrency } from '@/hooks/useCurrency';
import { friendlyError } from '@/lib/utils';
import { FeatureGate } from '@/components/ui/FeatureGate';
import { Building, Globe, MapPin, Loader2 } from 'lucide-react';
import { useSystemSettingsRaw } from '@/hooks/useSystemSettingsRaw';


// Job types loaded dynamically from DB worker categories

export default function CreateJobRequestPage() {
  const { profile, effectiveSocietyId } = useAuth();
  const { currencySymbol } = useCurrency();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { getSetting } = useSystemSettingsRaw(['worker_broadcast_radius_options', 'worker_broadcast_default_radius', 'worker_urgency_options']);

  // Dynamic job types from DB
  const { data: jobTypes = [] } = useQuery({
    queryKey: ['worker-job-types', effectiveSocietyId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('society_worker_categories')
        .select('name')
        .eq('society_id', effectiveSocietyId!)
        .eq('is_active', true)
        .order('display_order');
      if (error || !data) return [];
      return data.map((c: any) => ({ value: c.name.toLowerCase(), label: c.name }));
    },
    enabled: !!effectiveSocietyId,
    staleTime: 10 * 60 * 1000,
  });

  const [jobType, setJobType] = useState('');
  const [description, setDescription] = useState('');
  const [price, setPrice] = useState('');
  const [durationHours, setDurationHours] = useState('1');
  const [startTime, setStartTime] = useState('');
  const [locationDetails, setLocationDetails] = useState('');
  const [urgency, setUrgency] = useState('');
  const [visibilityScope, setVisibilityScope] = useState<'society' | 'nearby'>('society');
  const [targetSocietyIds, setTargetSocietyIds] = useState<string[]>([]);
  const [selectedRadius, setSelectedRadius] = useState<number | null>(null);

  // Load radius options from system_settings
  const radiusOptions: number[] = useMemo(() => {
    try {
      const raw = getSetting('worker_broadcast_radius_options');
      return raw ? JSON.parse(raw) : [];
    } catch { return []; }
  }, [getSetting]);

  // Load urgency options from system_settings
  const urgencyOptions: { value: string; label: string }[] = useMemo(() => {
    try {
      const raw = getSetting('worker_urgency_options');
      return raw ? JSON.parse(raw) : [];
    } catch { return []; }
  }, [getSetting]);

  const defaultRadius = parseInt(getSetting('worker_broadcast_default_radius') || '0', 10);

  // Initialize selectedRadius from default
  const effectiveRadius = selectedRadius ?? (defaultRadius > 0 ? defaultRadius : (radiusOptions[0] || 0));

  // Fetch nearby societies when "nearby" is selected, using dynamic radius
  const { data: nearbySocieties = [], isLoading: loadingNearby } = useQuery({
    queryKey: ['nearby-societies', effectiveSocietyId, effectiveRadius],
    queryFn: async () => {
      if (!effectiveSocietyId || effectiveRadius <= 0) return [];
      const { data, error } = await supabase.rpc('get_nearby_societies', {
        _society_id: effectiveSocietyId,
        _radius_km: effectiveRadius,
      });
      if (error) {
        console.error('Error fetching nearby societies:', error);
        return [];
      }
      return (data || []) as { id: string; name: string; distance_km: number }[];
    },
    enabled: !!effectiveSocietyId && visibilityScope === 'nearby' && effectiveRadius > 0,
    staleTime: 5 * 60 * 1000,
  });

  const toggleSociety = (id: string) => {
    setTargetSocietyIds(prev =>
      prev.includes(id) ? prev.filter(s => s !== id) : [...prev, id]
    );
  };

  const createJob = useMutation({
    mutationFn: async () => {
      if (!profile?.id || !profile?.society_id) throw new Error('Not authenticated');

      const validation = validateForm(jobRequestSchema, {
        job_type: jobType,
        description: description || '',
        price: price ? parseFloat(price) : null,
        duration_hours: parseInt(durationHours) || 1,
        urgency,
        visibility_scope: visibilityScope,
        target_society_ids: visibilityScope === 'nearby' ? targetSocietyIds : [],
      });

      if (!validation.success) {
        const firstError = Object.values((validation as { success: false; errors: Record<string, string> }).errors)[0] as string;
        throw new Error(firstError);
      }

      const { error } = await supabase.from('worker_job_requests').insert({
        society_id: profile.society_id,
        resident_id: profile.id,
        job_type: validation.data.job_type,
        description: validation.data.description || null,
        price: validation.data.price || null,
        duration_hours: validation.data.duration_hours,
        start_time: startTime ? new Date(startTime).toISOString() : null,
        location_details: locationDetails || null,
        urgency: validation.data.urgency,
        visibility_scope: validation.data.visibility_scope,
        target_society_ids: validation.data.target_society_ids,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('Job request posted! Workers will be notified.');
      queryClient.invalidateQueries({ queryKey: ['resident-job-requests'] });
      navigate('/worker-hire');
    },
    onError: (error: Error) => toast.error(friendlyError(error)),
  });

  return (
    <AppLayout headerTitle="Post a Job">
      <FeatureGate feature="worker_marketplace">
      <div className="p-4 pb-24">
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">What help do you need?</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label>Job Type *</Label>
              <Select value={jobType} onValueChange={setJobType}>
                <SelectTrigger><SelectValue placeholder="Select type..." /></SelectTrigger>
                <SelectContent>
                  {jobTypes.length > 0 ? (
                    jobTypes.map((t: any) => (
                      <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                    ))
                  ) : (
                    <SelectItem value="__none" disabled>No job types configured</SelectItem>
                  )}
                </SelectContent>
              </Select>
              {jobTypes.length === 0 && (
                <p className="text-xs text-destructive mt-1">⚠️ No job categories configured. Contact admin.</p>
              )}
            </div>

            <div>
              <Label>Description</Label>
              <Textarea
                placeholder="Describe what you need..."
                value={description}
                onChange={e => setDescription(e.target.value)}
                rows={3}
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Budget ({currencySymbol})</Label>
                <Input
                  type="number"
                  placeholder="e.g. 500"
                  value={price}
                  onChange={e => setPrice(e.target.value)}
                />
              </div>
              <div>
                <Label>Duration (hours)</Label>
                <Input
                  type="number"
                  min="1"
                  value={durationHours}
                  onChange={e => setDurationHours(e.target.value)}
                />
              </div>
            </div>

            <div>
              <Label>Start Time</Label>
              <Input
                type="datetime-local"
                value={startTime}
                onChange={e => setStartTime(e.target.value)}
              />
            </div>

            <div>
              <Label>Location Details</Label>
              <Input
                placeholder="e.g. Block A, 3rd floor"
                value={locationDetails}
                onChange={e => setLocationDetails(e.target.value)}
              />
            </div>

            <div>
              <Label>Urgency</Label>
              <Select value={urgency} onValueChange={setUrgency}>
                <SelectTrigger><SelectValue placeholder="Select urgency" /></SelectTrigger>
                <SelectContent>
                  {urgencyOptions.length > 0 ? (
                    urgencyOptions.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                    ))
                  ) : (
                    <SelectItem value="__none" disabled>No options configured</SelectItem>
                  )}
                </SelectContent>
              </Select>
              {urgencyOptions.length === 0 && (
                <p className="text-xs text-destructive mt-1">⚠️ Urgency options not configured. Contact admin.</p>
              )}
            </div>

            {/* Visibility Scope Selection */}
            <div>
              <Label className="mb-2 block">Job Visibility</Label>
              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => { setVisibilityScope('society'); setTargetSocietyIds([]); }}
                  className={`flex flex-col items-center gap-2 p-4 rounded-xl border-2 transition-colors min-h-[80px] ${
                    visibilityScope === 'society'
                      ? 'border-primary bg-primary/5'
                      : 'border-border bg-card'
                  }`}
                >
                  <Building size={24} className={visibilityScope === 'society' ? 'text-primary' : 'text-muted-foreground'} />
                  <span className="text-xs font-medium text-center">Within My Society</span>
                </button>
                <button
                  type="button"
                  onClick={() => setVisibilityScope('nearby')}
                  className={`flex flex-col items-center gap-2 p-4 rounded-xl border-2 transition-colors min-h-[80px] ${
                    visibilityScope === 'nearby'
                      ? 'border-primary bg-primary/5'
                      : 'border-border bg-card'
                  }`}
                >
                  <Globe size={24} className={visibilityScope === 'nearby' ? 'text-primary' : 'text-muted-foreground'} />
                  <span className="text-xs font-medium text-center">Expand to Nearby</span>
                </button>
              </div>
            </div>

            {/* Radius Selector + Nearby Society Multi-Select */}
            {visibilityScope === 'nearby' && (
              <div className="border rounded-xl p-3 bg-muted/30 space-y-3">
                {/* Radius selector */}
                {radiusOptions.length > 0 ? (
                  <div>
                    <Label className="mb-1.5 block text-sm">Broadcast Range</Label>
                    <div className="flex gap-2">
                      {radiusOptions.map((r: number) => (
                        <button
                          key={r}
                          type="button"
                          onClick={() => { setSelectedRadius(r); setTargetSocietyIds([]); }}
                          className={`px-4 py-2 rounded-lg text-sm font-medium border transition-colors min-h-[40px] tabular-nums ${
                            effectiveRadius === r
                              ? 'border-primary bg-primary text-primary-foreground'
                              : 'border-border bg-card text-foreground hover:bg-accent'
                          }`}
                        >
                          {r} km
                        </button>
                      ))}
                    </div>
                  </div>
                ) : (
                  <p className="text-sm text-destructive">Broadcast radius not configured. Contact admin.</p>
                )}

                {/* Society list */}
                <div>
                  <Label className="mb-2 block text-sm">Select societies to broadcast to:</Label>
                  {loadingNearby ? (
                    <div className="flex items-center justify-center py-4">
                      <Loader2 size={20} className="animate-spin text-muted-foreground" />
                      <span className="text-sm text-muted-foreground ml-2">Finding societies within {effectiveRadius} km...</span>
                    </div>
                  ) : nearbySocieties.length === 0 ? (
                    <p className="text-sm text-muted-foreground py-3 text-center">
                      No societies found within {effectiveRadius} km
                    </p>
                  ) : (
                    <div className="space-y-2">
                      {nearbySocieties.map((society: any) => (
                        <label
                          key={society.id}
                          className="flex items-center gap-3 p-2.5 rounded-lg border bg-card cursor-pointer hover:bg-accent/50 transition-colors"
                        >
                          <Checkbox
                            checked={targetSocietyIds.includes(society.id)}
                            onCheckedChange={() => toggleSociety(society.id)}
                          />
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium truncate">{society.name}</p>
                            <p className="text-[10px] text-muted-foreground flex items-center gap-1">
                              <MapPin size={10} /> {society.distance_km < 1 ? `${Math.round(society.distance_km * 1000)} m away` : `${Math.round(society.distance_km * 10) / 10} km away`}
                            </p>
                          </div>
                        </label>
                      ))}
                      {targetSocietyIds.length === 0 && (
                        <p className="text-xs text-destructive mt-1">Select at least one society</p>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )}

            <Button
              className="w-full"
              size="lg"
              onClick={() => createJob.mutate()}
              disabled={createJob.isPending || !jobType || !urgency || (visibilityScope === 'nearby' && targetSocietyIds.length === 0)}
            >
              {createJob.isPending ? 'Posting...' : 'Post Job Request'}
            </Button>
          </CardContent>
        </Card>
      </div>
      </FeatureGate>
    </AppLayout>
  );
}
