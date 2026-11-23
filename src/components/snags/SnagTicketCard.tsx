// @ts-nocheck
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Clock, AlertTriangle, CheckCircle2, Wrench, MessageSquare } from 'lucide-react';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';

interface SnagTicket {
  id: string;
  unit_number?: string | null;
  flat_number?: string | null;
  category: string;
  description: string;
  title?: string | null;
  image_urls?: string[] | null;
  photo_urls?: string[] | null;
  status: string;
  created_at: string;
  source_post_id?: string | null;
}

const STATUS_CONFIG: Record<string, { label: string; color: string; icon: any }> = {
  reported: { label: 'Opened', color: 'bg-warning/15 text-warning', icon: AlertTriangle },
  acknowledged: { label: 'In review', color: 'bg-info/15 text-info', icon: Clock },
  in_progress: { label: 'Being fixed', color: 'bg-info/10 text-info', icon: Wrench },
  resolved: { label: 'Resolved', color: 'bg-success/10 text-success', icon: CheckCircle2 },
  closed: { label: 'Closed', color: 'bg-muted text-muted-foreground', icon: CheckCircle2 },
};

const CATEGORY_LABELS: Record<string, string> = {
  plumbing: 'Plumbing', electrical: 'Electrical', civil: 'Civil', painting: 'Painting',
  carpentry: 'Carpentry', lift: 'Lift', common_area: 'Common Area', other: 'Other',
};

export function SnagTicketCard({ ticket, onClick }: { ticket: SnagTicket; onClick: () => void }) {
  const status = STATUS_CONFIG[ticket.status] || STATUS_CONFIG.reported;
  const StatusIcon = status.icon;
  const unit = ticket.unit_number || ticket.flat_number || 'Unknown';
  const photos = ticket.image_urls || ticket.photo_urls || [];

  return (
    <Card className="cursor-pointer hover:shadow-md transition-shadow" onClick={onClick}>
      <CardContent className="p-3 space-y-2">
        <div className="flex items-start justify-between">
          <div className="flex-1">
            <div className="flex items-center gap-1.5 mb-1 flex-wrap">
              <Badge variant="outline" className={cn('text-[9px] h-4 border-0', status.color)}>
                <StatusIcon size={8} className="mr-0.5" />
                {status.label}
              </Badge>
              <Badge variant="outline" className="text-[9px] h-4">
                {CATEGORY_LABELS[ticket.category] || ticket.category}
              </Badge>
              {ticket.source_post_id && (
                <Badge variant="secondary" className="text-[9px] h-4 gap-0.5">
                  <MessageSquare size={8} /> Community
                </Badge>
              )}
            </div>
            <p className="text-sm font-medium line-clamp-2">{ticket.title || ticket.description}</p>
            <p className="text-[10px] text-muted-foreground mt-1">
              Unit {unit} · {format(new Date(ticket.created_at), 'dd MMM yyyy')}
            </p>
          </div>
          {photos.length > 0 && (
            <img
              src={photos[0]}
              alt="Issue"
              className="w-12 h-12 rounded-md object-cover ml-2 shrink-0"
            />
          )}
        </div>
      </CardContent>
    </Card>
  );
}
