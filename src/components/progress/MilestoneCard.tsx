// @ts-nocheck
import { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { ThumbsUp, AlertTriangle, Image as ImageIcon } from 'lucide-react';
import { format } from 'date-fns';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

interface Milestone {
  id: string;
  title: string;
  description: string | null;
  stage: string;
  photos: string[];
  completion_percentage: number;
  posted_by: string;
  created_at: string;
  reactions?: { thumbsup: number; concern: number; user_reaction?: string | null };
}

interface MilestoneCardProps {
  milestone: Milestone;
  onReactionChange: () => void;
}

const STAGE_CONFIG: Record<string, { label: string; color: string }> = {
  foundation: { label: 'Foundation', color: 'bg-warning/15 text-warning' },
  structure: { label: 'Structure', color: 'bg-info/15 text-info' },
  mep: { label: 'MEP Works', color: 'bg-primary/15 text-primary' },
  finishing: { label: 'Finishing', color: 'bg-accent/15 text-accent' },
  handover: { label: 'Handover', color: 'bg-success/15 text-success' },
  completed: { label: 'Completed', color: 'bg-success/15 text-success' },
};

export function MilestoneCard({ milestone, onReactionChange }: MilestoneCardProps) {
  const { user } = useAuth();
  const [isReacting, setIsReacting] = useState(false);
  const [showPhotos, setShowPhotos] = useState(false);

  const stageInfo = STAGE_CONFIG[milestone.stage] || { label: milestone.stage, color: 'bg-muted text-muted-foreground' };

  const handleReaction = async (type: 'thumbsup' | 'concern') => {
    if (!user || isReacting) return;
    setIsReacting(true);

    try {
      if (milestone.reactions?.user_reaction === type) {
        // Remove reaction
        await supabase
          .from('milestone_reactions')
          .delete()
          .eq('milestone_id', milestone.id)
          .eq('user_id', user.id);
      } else {
        // Upsert reaction
        await supabase
          .from('milestone_reactions')
          .upsert(
            { milestone_id: milestone.id, user_id: user.id, reaction_type: type },
            { onConflict: 'milestone_id,user_id' }
          );
      }
      onReactionChange();
    } catch (error: any) {
      toast.error('Failed to react');
    } finally {
      setIsReacting(false);
    }
  };

  return (
    <Card>
      <CardContent className="p-4 space-y-3">
        <div className="flex items-start justify-between">
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-1">
              <Badge variant="outline" className={cn('text-[10px] font-medium border-0', stageInfo.color)}>
                {stageInfo.label}
              </Badge>
              <span className="text-xs text-muted-foreground font-medium">{milestone.completion_percentage}%</span>
            </div>
            <h4 className="font-semibold text-sm">{milestone.title}</h4>
          </div>
          <span className="text-[10px] text-muted-foreground whitespace-nowrap ml-2">
            {format(new Date(milestone.created_at), 'dd MMM yyyy')}
          </span>
        </div>

        {/* Progress bar */}
        <div className="h-2 w-full rounded-full bg-secondary overflow-hidden">
          <div
            className="h-full bg-primary rounded-full transition-all"
            style={{ width: `${milestone.completion_percentage}%` }}
          />
        </div>

        {milestone.description && (
          <p className="text-xs text-muted-foreground">{milestone.description}</p>
        )}

        {/* Photos */}
        {milestone.photos && milestone.photos.length > 0 && (
          <div>
            <button
              onClick={() => setShowPhotos(!showPhotos)}
              className="flex items-center gap-1 text-xs text-primary font-medium"
            >
              <ImageIcon size={12} />
              {milestone.photos.length} photo{milestone.photos.length > 1 ? 's' : ''}
            </button>
            {showPhotos && (
              <div className="grid grid-cols-3 gap-2 mt-2">
                {milestone.photos.map((url, i) => (
                  <img
                    key={i}
                    src={url}
                    alt={`Milestone photo ${i + 1}`}
                    className="w-full aspect-square object-cover rounded-lg border border-border"
                  />
                ))}
              </div>
            )}
          </div>
        )}

        {/* Reactions */}
        <div className="flex items-center gap-2 pt-1">
          <Button
            variant="ghost"
            size="sm"
            className={cn(
              'h-7 text-xs gap-1',
              milestone.reactions?.user_reaction === 'thumbsup' && 'text-primary bg-primary/10'
            )}
            onClick={() => handleReaction('thumbsup')}
            disabled={isReacting}
          >
            <ThumbsUp size={12} />
            {milestone.reactions?.thumbsup || 0}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className={cn(
              'h-7 text-xs gap-1',
              milestone.reactions?.user_reaction === 'concern' && 'text-warning bg-warning/10'
            )}
            onClick={() => handleReaction('concern')}
            disabled={isReacting}
          >
            <AlertTriangle size={12} />
            {milestone.reactions?.concern || 0}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
