// @ts-nocheck
import { Link } from 'react-router-dom';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import {
  ISSUE_ASK_COMMITTEE_MIN,
  ISSUE_TRAIL,
  ISSUE_VOTE_THRESHOLD,
  getConvertedSnagId,
  getSnagStatus,
  isMeterCategory,
  snagDeepLink,
  trailIndexForStatus,
} from '@/lib/community-issue';
import { Bug, Megaphone } from 'lucide-react';

interface IssueMeterProps {
  post: {
    id: string;
    category: string;
    vote_count: number;
    structured?: any;
    author_id?: string;
  };
  compact?: boolean;
  canConvert?: boolean;
  canAskCommittee?: boolean;
  askingCommittee?: boolean;
  onAskCommittee?: () => void;
  onConvert?: () => void;
  converting?: boolean;
  /** Stop card click when interacting */
  stopPropagation?: boolean;
}

export function IssueMeter({
  post,
  compact = false,
  canConvert = false,
  canAskCommittee = false,
  askingCommittee = false,
  onAskCommittee,
  onConvert,
  converting = false,
  stopPropagation = false,
}: IssueMeterProps) {
  const snagId = getConvertedSnagId(post.structured);
  const snagStatus = getSnagStatus(post.structured);
  const meterOk = isMeterCategory(post.category);
  const votes = post.vote_count || 0;

  if (!meterOk && !snagId && post.category !== 'find_help') return null;

  const stop = (e: React.MouseEvent) => {
    if (stopPropagation) e.stopPropagation();
  };

  if (snagId) {
    const idx = trailIndexForStatus(snagStatus || 'reported');
    return (
      <div className={cn('space-y-1.5', compact ? 'pt-1' : 'rounded-lg border border-primary/20 bg-primary/5 p-2.5')} onClick={stop}>
        <div className="flex items-center justify-between gap-2">
          <p className="text-[11px] font-medium text-foreground flex items-center gap-1">
            <Bug size={12} className="text-primary" />
            Issue opened
          </p>
          <Link
            to={snagDeepLink(snagId)}
            className="text-[10px] text-primary font-medium"
            onClick={stop}
          >
            View issue
          </Link>
        </div>
        <div className="flex flex-wrap gap-1">
          {ISSUE_TRAIL.map((step, i) => (
            <Badge
              key={step.key}
              variant="outline"
              className={cn(
                'text-[9px]',
                i <= idx ? 'bg-primary/10 text-primary border-primary/30' : 'text-muted-foreground',
              )}
            >
              {step.label}
            </Badge>
          ))}
        </div>
      </div>
    );
  }

  const actionRow = !compact && (canAskCommittee || canConvert) ? (
    <div className="flex flex-wrap gap-1.5 pt-0.5">
      {canAskCommittee && onAskCommittee && (
        <Button
          size="sm"
          variant="outline"
          className="h-7 text-[11px] gap-1"
          disabled={askingCommittee}
          onClick={(e) => {
            stop(e);
            onAskCommittee();
          }}
        >
          <Megaphone size={12} />
          Ask committee
        </Button>
      )}
      {canConvert && onConvert && (
        <Button
          size="sm"
          variant="outline"
          className="h-7 text-[11px] gap-1"
          disabled={converting}
          onClick={(e) => {
            stop(e);
            onConvert();
          }}
        >
          <Bug size={12} />
          Convert to issue
        </Button>
      )}
    </div>
  ) : null;

  // find_help: manual convert only (no vote meter)
  if (!meterOk) {
    if (!actionRow) return null;
    return (
      <div className="rounded-lg border border-border bg-muted/30 p-2.5 space-y-1.5" onClick={stop}>
        <p className="text-[11px] text-muted-foreground">
          Author or committee can open a tracked society issue from this post.
        </p>
        {actionRow}
      </div>
    );
  }

  const pct = Math.min(100, Math.round((votes / ISSUE_VOTE_THRESHOLD) * 100));
  const milestoneHint =
    votes >= ISSUE_ASK_COMMITTEE_MIN
      ? 'Neighbours are backing this - committee has been notified.'
      : null;

  return (
    <div
      className={cn('space-y-1.5', compact ? 'pt-1' : 'rounded-lg border border-border bg-muted/30 p-2.5')}
      onClick={stop}
    >
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] font-medium text-foreground">
          Community support: {votes}/{ISSUE_VOTE_THRESHOLD}
        </p>
        {votes >= ISSUE_VOTE_THRESHOLD ? (
          <Badge variant="secondary" className="text-[9px]">Auto-opens soon</Badge>
        ) : null}
      </div>
      <div className="h-1.5 rounded-full bg-muted overflow-hidden">
        <div
          className="h-full rounded-full bg-primary transition-all"
          style={{ width: `${pct}%` }}
        />
      </div>
      {milestoneHint && (
        <p className="text-[10px] text-muted-foreground">{milestoneHint}</p>
      )}
      {actionRow}
    </div>
  );
}
