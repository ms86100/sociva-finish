// @ts-nocheck
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Clock, AlertTriangle, CheckCircle2, Wrench } from 'lucide-react';
import { format, differenceInHours } from 'date-fns';
import { cn } from '@/lib/utils';

interface SnagTicket {
  id: string;
  flat_number: string;
  category: string;
  description: string;
  photo_urls: string[];
  status: string;
  sla_deadline: string;
  assigned_to_name: string | null;
  acknowledged_at: string | null;
  fixed_at: string | null;
  verified_at: string | null;
  created_at: string;
}

const STATUS_CONFIG: Record<string, { label: string; color: string; icon: any }> = {
  reported: { label: 'Reported', color: 'bg-warning/15 text-warning', icon: AlertTriangle },
  acknowledged: { label: 'Acknowledged', color: 'bg-info/15 text-info', icon: Clock },
  contractor_assigned: { label: 'Assigned', color: 'bg-primary/15 text-primary', icon: Wrench },
  in_progress: { label: 'In Progress', color: 'bg-info/10 text-info', icon: Wrench },
  fixed: { label: 'Fixed', color: 'bg-success/10 text-success', icon: CheckCircle2 },
  verified: { label: 'Verified', color: 'bg-success/15 text-success', icon: CheckCircle2 },
  closed: { label: 'Closed', color: 'bg-muted text-muted-foreground', icon: CheckCircle2 },
};

const CATEGORY_LABELS: Record<string, string> = {
  plumbing: 'Plumbing', electrical: 'Electrical', civil: 'Civil', painting: 'Painting',
  carpentry: 'Carpentry', lift: 'Lift', common_area: 'Common Area', other: 'Other',
};

export function SnagTicketCard({ ticket, onClick }: { ticket: SnagTicket; onClick: () => void }) {
  const status = STATUS_CONFIG[ticket.status] || STATUS_CONFIG.reported;
  const StatusIcon = status.icon;
  const hoursLeft = differenceInHours(new Date(ticket.sla_deadline), new Date());
  const slaBreached = hoursLeft < 0 && !['fixed', 'verified', 'closed'].includes(ticket.status);

  return (
    <Card className="cursor-pointer hover:shadow-md transition-shadow" onClick={onClick}>
      <CardContent className="p-3 space-y-2">
        <div className="flex items-start justify-between">
          <div className="flex-1">
            <div className="flex items-center gap-1.5 mb-1">
              <Badge variant="outline" className={cn('text-[9px] h-4 border-0', status.color)}>
                <StatusIcon size={8} className="mr-0.5" />
                {status.label}
              </Badge>
              <Badge variant="outline" className="text-[9px] h-4">
                {CATEGORY_LABELS[ticket.category] || ticket.category}
              </Badge>
            </div>
            <p className="text-sm font-medium line-clamp-2">{ticket.description}</p>
            <p className="text-[10px] text-muted-foreground mt-1">
              Flat {ticket.flat_number} · {format(new Date(ticket.created_at), 'dd MMM yyyy')}
            </p>
          </div>
          {ticket.photo_urls.length > 0 && (
            <img
              src={ticket.photo_urls[0]}
              alt="Snag"
              className="w-12 h-12 rounded-md object-cover ml-2 shrink-0"
            />
          )}
        </div>

        {slaBreached && (
          <div className="flex items-center gap-1 text-[10px] text-destructive font-medium">
            <Clock size={10} />
            SLA breached by {Math.abs(hoursLeft)}h
          </div>
        )}
        {!slaBreached && !['fixed', 'verified', 'closed'].includes(ticket.status) && (
          <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
            <Clock size={10} />
            {hoursLeft}h remaining
          </div>
        )}
      </CardContent>
    </Card>
  );
}
