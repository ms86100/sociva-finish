// @ts-nocheck
import { cn } from '@/lib/utils';

interface CampaignPhonePreviewProps {
  title: string;
  body: string;
  className?: string;
}

export function CampaignPhonePreview({ title, body, className }: CampaignPhonePreviewProps) {
  return (
    <div className={cn('rounded-2xl border border-border/60 bg-muted/30 p-3', className)}>
      <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-2">Phone preview</p>
      <div className="mx-auto max-w-[280px] rounded-[1.25rem] bg-background border border-border shadow-sm overflow-hidden">
        <div className="px-3 py-2 bg-muted/50 border-b border-border/40 flex items-center gap-2">
          <div className="h-7 w-7 rounded-lg bg-primary/15 flex items-center justify-center text-xs font-bold text-primary">S</div>
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-semibold text-foreground">Sociva</p>
            <p className="text-[10px] text-muted-foreground">now</p>
          </div>
        </div>
        <div className="px-3 py-3 space-y-1">
          <p className="text-sm font-bold text-foreground leading-snug break-words">
            {title.trim() || 'Notification title'}
          </p>
          <p className="text-xs text-muted-foreground leading-relaxed break-words whitespace-pre-wrap">
            {body.trim() || 'Notification body will appear here.'}
          </p>
        </div>
      </div>
    </div>
  );
}
