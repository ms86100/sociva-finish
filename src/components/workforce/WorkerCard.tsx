// @ts-nocheck
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Star, Phone, Clock, AlertTriangle, Ban, Eye } from 'lucide-react';

interface WorkerCardProps {
  worker: any;
  flatAssignments?: any[];
  onViewDetails?: () => void;
  onSuspend?: () => void;
  onBlacklist?: () => void;
  onReactivate?: () => void;
  showActions?: boolean;
}

const STATUS_STYLES: Record<string, { label: string; className: string; icon: typeof AlertTriangle }> = {
  active: { label: 'Active', className: 'bg-success/15 text-success', icon: Eye },
  suspended: { label: 'Suspended', className: 'bg-warning/15 text-warning', icon: AlertTriangle },
  blacklisted: { label: 'Blacklisted', className: 'bg-destructive/15 text-destructive', icon: Ban },
  under_review: { label: 'Under Review', className: 'bg-info/15 text-info', icon: Eye },
};

export function WorkerCard({ worker, flatAssignments = [], onViewDetails, onSuspend, onBlacklist, onReactivate, showActions = false }: WorkerCardProps) {
  const statusConfig = STATUS_STYLES[worker.status] || STATUS_STYLES.active;
  const workerName = worker.skills?.name || worker.worker_type || 'Unknown';
  const workerPhone = worker.skills?.phone;

  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex gap-3">
          <Avatar className="h-14 w-14 rounded-lg">
            <AvatarImage src={worker.photo_url} className="object-cover" />
            <AvatarFallback className="rounded-lg bg-muted text-lg">
              {workerName.charAt(0).toUpperCase()}
            </AvatarFallback>
          </Avatar>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <p className="font-semibold text-sm truncate">{workerName}</p>
              <Badge variant="outline" className={`text-[10px] ${statusConfig.className}`}>
                {statusConfig.label}
              </Badge>
            </div>

            <p className="text-xs text-muted-foreground capitalize mt-0.5">{worker.worker_type}</p>

            <div className="flex items-center gap-3 mt-1">
              {worker.rating > 0 && (
                <span className="flex items-center gap-0.5 text-xs text-muted-foreground">
                  <Star size={10} className="text-warning fill-warning" />
                  {worker.rating} ({worker.total_ratings || 0})
                </span>
              )}
              {worker.allowed_shift_start && (
                <span className="flex items-center gap-0.5 text-xs text-muted-foreground">
                  <Clock size={10} />
                  {worker.allowed_shift_start?.slice(0, 5)} - {worker.allowed_shift_end?.slice(0, 5)}
                </span>
              )}
            </div>

            {flatAssignments.length > 0 && (
              <div className="flex gap-1 mt-1.5 flex-wrap">
                {flatAssignments.map(fa => (
                  <Badge key={fa.id} variant="secondary" className="text-[10px]">
                    Flat {fa.flat_number}
                  </Badge>
                ))}
              </div>
            )}

            {workerPhone && (
              <p className="text-[10px] text-muted-foreground flex items-center gap-1 mt-1">
                <Phone size={9} /> {workerPhone}
              </p>
            )}
          </div>
        </div>

        {showActions && (
          <div className="flex gap-2 mt-3 pt-3 border-t border-border">
            {onViewDetails && (
              <Button size="sm" variant="outline" className="flex-1 text-xs" onClick={onViewDetails}>
                Details
              </Button>
            )}
            {worker.status === 'active' && onSuspend && (
              <Button size="sm" variant="outline" className="text-xs text-warning" onClick={onSuspend}>
                Suspend
              </Button>
            )}
            {worker.status === 'active' && onBlacklist && (
              <Button size="sm" variant="outline" className="text-xs text-destructive" onClick={onBlacklist}>
                Blacklist
              </Button>
            )}
            {(worker.status === 'suspended' || worker.status === 'blacklisted') && onReactivate && (
              <Button size="sm" variant="outline" className="text-xs text-success" onClick={onReactivate}>
                Reactivate
              </Button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
