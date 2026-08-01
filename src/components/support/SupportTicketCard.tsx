// @ts-nocheck
import { Clock, AlertTriangle, CheckCircle2, ChevronRight, RefreshCcw, MessageCircle } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { cn } from '@/lib/utils';
import type { SupportTicket } from '@/hooks/useSupportTickets';

interface SupportTicketCardProps {
  ticket: SupportTicket & { kind?: 'ticket' | 'refund'; amount?: number | null; raw_status?: string };
  onClick?: () => void;
  viewRole?: 'buyer' | 'seller';
  kind?: 'ticket' | 'refund';
}

const STATUS_CONFIG: Record<string, { label: string; color: string; icon: any }> = {
  open: { label: 'Open', color: 'text-warning', icon: Clock },
  seller_pending: { label: 'Awaiting seller', color: 'text-warning', icon: Clock },
  auto_resolved: { label: 'Auto-resolved', color: 'text-emerald-500', icon: CheckCircle2 },
  resolved: { label: 'Resolved', color: 'text-emerald-500', icon: CheckCircle2 },
  closed: { label: 'Closed', color: 'text-muted-foreground', icon: CheckCircle2 },
};

const ISSUE_LABELS: Record<string, string> = {
  late_delivery: 'Late delivery',
  missing_item: 'Missing item',
  wrong_item: 'Wrong item',
  payment_issue: 'Payment issue',
  cancel_request: 'Cancel request',
  quality_issue: 'Quality issue',
  refund_request: 'Refund request',
  other: 'Other issue',
};

export function SupportTicketCard({ ticket, onClick, viewRole = 'buyer', kind }: SupportTicketCardProps) {
  const itemKind = kind || ticket.kind || 'ticket';
  const statusCfg = STATUS_CONFIG[ticket.status] || STATUS_CONFIG.open;
  const StatusIcon = statusCfg.icon;
  const isOverdue = ticket.sla_breached;
  const KindIcon = itemKind === 'refund' ? RefreshCcw : MessageCircle;

  return (
    <button
      onClick={onClick}
      className="w-full flex items-center gap-3 p-3.5 bg-card border border-border rounded-xl text-left transition-colors hover:bg-muted/50"
    >
      <div className={cn(
        'w-9 h-9 rounded-lg flex items-center justify-center shrink-0',
        isOverdue ? 'bg-destructive/10' : itemKind === 'refund' ? 'bg-primary/10' : 'bg-muted'
      )}>
        {isOverdue ? (
          <AlertTriangle size={18} className="text-destructive" />
        ) : itemKind === 'refund' ? (
          <KindIcon size={18} className="text-primary" />
        ) : (
          <StatusIcon size={18} className={statusCfg.color} />
        )}
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <p className="text-sm font-semibold truncate">
            {ISSUE_LABELS[ticket.issue_type] || ticket.issue_type?.replace(/_/g, ' ')}
          </p>
          <span className={cn(
            'text-[10px] px-1.5 py-0.5 rounded-full font-medium shrink-0',
            itemKind === 'refund' ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'
          )}>
            {itemKind === 'refund' ? 'Refund' : 'Ticket'}
          </span>
          {isOverdue && (
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-destructive/10 text-destructive font-medium shrink-0">
              SLA breached
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 mt-0.5">
          <span className={cn('text-[11px] font-medium', statusCfg.color)}>
            {statusCfg.label}
          </span>
          <span className="text-[10px] text-muted-foreground">
            · {formatDistanceToNow(new Date(ticket.created_at), { addSuffix: true })}
          </span>
        </div>
      </div>

      <ChevronRight size={14} className="text-muted-foreground shrink-0" />
    </button>
  );
}
