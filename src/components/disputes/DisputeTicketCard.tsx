// @ts-nocheck
import { Badge } from '@/components/ui/badge';
import { formatDistanceToNow } from 'date-fns';
import { Clock, AlertTriangle, CheckCircle2, Eye, ShieldAlert } from 'lucide-react';
import { cn } from '@/lib/utils';

interface Ticket {
  id: string;
  category: string;
  description: string;
  status: string;
  is_anonymous: boolean;
  sla_deadline: string;
  acknowledged_at: string | null;
  resolved_at: string | null;
  created_at: string;
  submitted_by?: string;
  submitter?: { name: string } | null;
}

const STATUS_CONFIG: Record<string, { label: string; color: string; icon: any }> = {
  submitted: { label: 'Submitted', color: 'bg-warning/10 text-warning', icon: Clock },
  acknowledged: { label: 'Acknowledged', color: 'bg-info/10 text-info', icon: Eye },
  under_review: { label: 'Under Review', color: 'bg-primary/10 text-primary', icon: ShieldAlert },
  resolved: { label: 'Resolved', color: 'bg-success/10 text-success', icon: CheckCircle2 },
  escalated: { label: 'Escalated', color: 'bg-destructive/10 text-destructive', icon: AlertTriangle },
  closed: { label: 'Closed', color: 'bg-muted text-muted-foreground', icon: CheckCircle2 },
};

const CATEGORY_LABELS: Record<string, string> = {
  noise: 'Noise',
  parking: 'Parking',
  pet: 'Pet',
  maintenance: 'Maintenance',
  other: 'Other',
};

interface Props {
  ticket: Ticket;
  onClick?: () => void;
  showSubmitter?: boolean;
}

export function DisputeTicketCard({ ticket, onClick, showSubmitter }: Props) {
  const config = STATUS_CONFIG[ticket.status] || STATUS_CONFIG.submitted;
  const StatusIcon = config.icon;
  const isOverdue = !ticket.acknowledged_at && new Date(ticket.sla_deadline) < new Date() && ticket.status === 'submitted';

  return (
    <button
      onClick={onClick}
      className="w-full text-left bg-card rounded-xl border border-border p-4 space-y-2 hover:shadow-sm transition-shadow"
    >
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="text-[10px]">
              {CATEGORY_LABELS[ticket.category] || ticket.category}
            </Badge>
            {isOverdue && (
              <Badge variant="destructive" className="text-[10px]">SLA Breached</Badge>
            )}
          </div>
          {showSubmitter && !ticket.is_anonymous && ticket.submitter && (
            <p className="text-xs text-muted-foreground mt-1">{ticket.submitter.name}</p>
          )}
          {showSubmitter && ticket.is_anonymous && (
            <p className="text-xs text-muted-foreground mt-1 italic">Anonymous</p>
          )}
        </div>
        <div className={cn('flex items-center gap-1 px-2 py-1 rounded-full text-[10px] font-medium', config.color)}>
          <StatusIcon size={10} />
          {config.label}
        </div>
      </div>
      <p className="text-sm line-clamp-2">{ticket.description}</p>
      <p className="text-[10px] text-muted-foreground">
        {formatDistanceToNow(new Date(ticket.created_at), { addSuffix: true })}
      </p>
    </button>
  );
}
