// @ts-nocheck
import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { ActivityItem } from './ActivityItem';
import { Activity, ChevronRight } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';

export function ActivityFeed() {
  const { effectiveSocietyId } = useAuth();
  const [activities, setActivities] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!effectiveSocietyId) return;
    fetchActivities();

    // Realtime subscription
    const channel = supabase
      .channel('society-activity-feed')
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'society_activity',
        filter: `society_id=eq.${effectiveSocietyId}`,
      }, (payload) => {
        setActivities(prev => [payload.new as any, ...prev].slice(0, 5));
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [effectiveSocietyId]);

  const fetchActivities = async () => {
    if (!effectiveSocietyId) return;
    const { data } = await supabase
      .from('society_activity')
      .select('*, tower:project_towers!society_activity_tower_id_fkey(name)')
      .eq('society_id', effectiveSocietyId)
      .order('created_at', { ascending: false })
      .limit(5);
    setActivities(data || []);
    setIsLoading(false);
  };

  if (isLoading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map(i => <Skeleton key={i} className="h-14 w-full rounded-lg" />)}
      </div>
    );
  }

  if (activities.length === 0) {
    return (
      <div className="text-center py-6 text-muted-foreground">
        <Activity className="mx-auto mb-2" size={24} />
        <p className="text-sm">No recent activity in your society</p>
      </div>
    );
  }

  return (
    <div>
      <div className="divide-y divide-border">
        {activities.map(a => <ActivityItem key={a.id} activity={a} />)}
      </div>
      <Link to="/society" className="flex items-center justify-center gap-1 text-sm text-primary font-medium mt-2 py-2">
        View all activity <ChevronRight size={14} />
      </Link>
    </div>
  );
}
