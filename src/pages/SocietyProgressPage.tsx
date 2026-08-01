// @ts-nocheck
import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { AppLayout } from '@/components/layout/AppLayout';
import { FeatureGate } from '@/components/ui/FeatureGate';
import { Card, CardContent } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuth } from '@/contexts/AuthContext';
import { ProgressTimeline } from '@/components/progress/ProgressTimeline';
import { MilestoneCard } from '@/components/progress/MilestoneCard';
import { AddMilestoneSheet } from '@/components/progress/AddMilestoneSheet';
import { TowerSelector } from '@/components/progress/TowerSelector';
import { TowerProgressCard } from '@/components/progress/TowerProgressCard';
import { DocumentVaultTab } from '@/components/progress/DocumentVaultTab';
import { ProjectQATab } from '@/components/progress/ProjectQATab';
import { HardHat, Construction } from 'lucide-react';

interface Tower {
  id: string;
  name: string;
  total_floors: number;
  expected_completion: string | null;
  revised_completion: string | null;
  delay_reason: string | null;
  delay_category: string | null;
  current_stage: string;
  current_percentage: number;
}

interface Milestone {
  id: string;
  title: string;
  description: string | null;
  stage: string;
  photos: string[];
  completion_percentage: number;
  posted_by: string;
  created_at: string;
  tower_id: string | null;
  reactions?: { thumbsup: number; concern: number; user_reaction?: string | null };
}

export default function SocietyProgressPage() {
  const { user, isAdmin, isSocietyAdmin, isBuilderMember, effectiveSocietyId, effectiveSociety } = useAuth();
  const canManageProgress = isAdmin || isSocietyAdmin || isBuilderMember;
  const [milestones, setMilestones] = useState<Milestone[]>([]);
  const [towers, setTowers] = useState<Tower[]>([]);
  const [selectedTowerId, setSelectedTowerId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const fetchTowers = async () => {
    if (!effectiveSocietyId) return;
    const { data } = await supabase
      .from('project_towers')
      .select('*')
      .eq('society_id', effectiveSocietyId)
      .order('name');
    setTowers((data as any) || []);
  };

  const fetchMilestones = async () => {
    if (!effectiveSocietyId) return;

    let query = supabase
      .from('construction_milestones')
      .select('*')
      .eq('society_id', effectiveSocietyId)
      .order('created_at', { ascending: false });

    if (selectedTowerId) {
      query = query.eq('tower_id', selectedTowerId);
    }

    const { data, error } = await query;

    if (error) {
      console.error('Error fetching milestones:', error);
      setIsLoading(false);
      return;
    }

    const milestoneIds = (data || []).map(m => m.id);
    let reactionsMap: Record<string, { thumbsup: number; concern: number; user_reaction?: string | null }> = {};

    if (milestoneIds.length > 0) {
      const { data: reactions } = await supabase
        .from('milestone_reactions')
        .select('milestone_id, user_id, reaction_type')
        .in('milestone_id', milestoneIds);

      for (const id of milestoneIds) {
        const mReactions = (reactions || []).filter(r => r.milestone_id === id);
        reactionsMap[id] = {
          thumbsup: mReactions.filter(r => r.reaction_type === 'thumbsup').length,
          concern: mReactions.filter(r => r.reaction_type === 'concern').length,
          user_reaction: mReactions.find(r => r.user_id === user?.id)?.reaction_type || null,
        };
      }
    }

    setMilestones(
      (data || []).map(m => ({
        ...m,
        photos: m.photos || [],
        reactions: reactionsMap[m.id] || { thumbsup: 0, concern: 0, user_reaction: null },
      }))
    );
    setIsLoading(false);
  };

  useEffect(() => { fetchTowers(); }, [effectiveSocietyId]);
  useEffect(() => { fetchMilestones(); }, [effectiveSocietyId, selectedTowerId]);

  // Compute progress - use tower data if available, otherwise milestones
  const overallPercentage = towers.length > 0
    ? Math.round(towers.reduce((sum, t) => sum + t.current_percentage, 0) / towers.length)
    : milestones.length > 0 ? Math.max(...milestones.map(m => m.completion_percentage)) : 0;

  const latestStage = selectedTowerId
    ? towers.find(t => t.id === selectedTowerId)?.current_stage || 'foundation'
    : towers.length > 0 ? towers[0].current_stage : (milestones.length > 0 ? milestones[0].stage : 'foundation');

  const isUnderConstruction = (effectiveSociety as any)?.is_under_construction;

  if (isLoading) {
    return (
      <AppLayout headerTitle="Construction Progress" showLocation={false}>
        <div className="p-4 space-y-4">
          <Skeleton className="h-24 w-full rounded-xl" />
          <Skeleton className="h-32 w-full rounded-xl" />
        </div>
      </AppLayout>
    );
  }

  if (!isUnderConstruction) {
    return (
      <AppLayout headerTitle="Construction Progress" showLocation={false}>
        <div className="p-4 flex flex-col items-center justify-center min-h-[50vh] text-center">
          <Construction className="text-muted-foreground mb-4" size={48} />
          <h2 className="text-lg font-semibold">Not Available</h2>
          <p className="text-sm text-muted-foreground mt-1">
            This feature is for under-construction societies. Your society is already delivered!
          </p>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout headerTitle="Construction Progress" showLocation={false}>
      <FeatureGate feature="construction_progress">
      <div className="p-4 space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <HardHat className="text-primary" size={20} />
            <h2 className="font-semibold text-sm">{effectiveSociety?.name}</h2>
          </div>
          <TowerSelector towers={towers} selectedTowerId={selectedTowerId} onSelect={setSelectedTowerId} />
        </div>

        <Tabs defaultValue="timeline">
          <TabsList className="w-full grid grid-cols-3">
            <TabsTrigger value="timeline" className="text-xs">Timeline</TabsTrigger>
            <TabsTrigger value="documents" className="text-xs">Documents</TabsTrigger>
            <TabsTrigger value="qa" className="text-xs">Q&A</TabsTrigger>
          </TabsList>

          <TabsContent value="timeline" className="space-y-4 mt-3">
            {/* Progress Overview */}
            <Card>
              <CardContent className="p-4">
                <ProgressTimeline currentStage={latestStage} overallPercentage={overallPercentage} />
              </CardContent>
            </Card>

            {/* Tower Cards */}
            {towers.length > 0 && !selectedTowerId && (
              <div className="space-y-2">
                <h3 className="text-sm font-semibold text-muted-foreground">Towers ({towers.length})</h3>
                {towers.map(t => <TowerProgressCard key={t.id} tower={t} />)}
              </div>
            )}

            {selectedTowerId && towers.find(t => t.id === selectedTowerId) && (
              <TowerProgressCard tower={towers.find(t => t.id === selectedTowerId)!} />
            )}

            {/* Milestones */}
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-muted-foreground">
                Updates ({milestones.length})
              </h3>
              {canManageProgress && <AddMilestoneSheet onAdded={fetchMilestones} towers={towers} />}
            </div>

            {milestones.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                <HardHat className="mx-auto mb-3" size={32} />
                <p className="text-sm">No milestone updates yet</p>
                {canManageProgress && <p className="text-xs mt-1">Tap "Add Milestone" to post the first update</p>}
              </div>
            ) : (
              <div className="space-y-3">
                {milestones.map(milestone => (
                  <MilestoneCard key={milestone.id} milestone={milestone} onReactionChange={fetchMilestones} />
                ))}
              </div>
            )}
          </TabsContent>

          <TabsContent value="documents" className="mt-3">
            <DocumentVaultTab />
          </TabsContent>

          <TabsContent value="qa" className="mt-3">
            <ProjectQATab />
          </TabsContent>
        </Tabs>
      </div>
      </FeatureGate>
    </AppLayout>
  );
}
