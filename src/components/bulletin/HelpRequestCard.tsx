// @ts-nocheck
import { formatDistanceToNow } from 'date-fns';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { Handshake, AlertCircle, HelpCircle, Gift, Clock, MessageCircle } from 'lucide-react';

const TAG_CONFIG: Record<string, { label: string; icon: React.ElementType; color: string; bg: string }> = {
  borrow: { label: 'Borrow', icon: Handshake, color: 'text-info', bg: 'bg-info/15' },
  emergency: { label: 'Emergency', icon: AlertCircle, color: 'text-destructive', bg: 'bg-destructive/15' },
  question: { label: 'Question', icon: HelpCircle, color: 'text-primary', bg: 'bg-primary/15' },
  offer: { label: 'Offer', icon: Gift, color: 'text-success', bg: 'bg-success/15' },
};

export interface HelpRequest {
  id: string;
  society_id: string;
  author_id: string;
  title: string;
  description: string | null;
  tag: string;
  status: string;
  expires_at: string;
  response_count: number;
  created_at: string;
  author?: { name: string; block: string; flat_number: string };
}

interface HelpRequestCardProps {
  request: HelpRequest;
  onOpen: (r: HelpRequest) => void;
}

export function HelpRequestCard({ request, onOpen }: HelpRequestCardProps) {
  const tagConfig = TAG_CONFIG[request.tag] || TAG_CONFIG.question;
  const TagIcon = tagConfig.icon;
  const isExpired = new Date(request.expires_at) < new Date();
  const isFulfilled = request.status === 'fulfilled';

  return (
    <button
      onClick={() => onOpen(request)}
      className={cn(
        'w-full text-left bg-card rounded-xl border border-border p-4 space-y-2 transition-all',
        (isExpired || isFulfilled) && 'opacity-60'
      )}
    >
      <div className="flex items-center justify-between">
        <Badge variant="outline" className={cn('text-[10px] gap-1', tagConfig.bg, tagConfig.color)}>
          <TagIcon size={10} />
          {tagConfig.label}
        </Badge>
        {isFulfilled ? (
          <Badge className="text-[10px] bg-secondary text-secondary-foreground">Fulfilled</Badge>
        ) : isExpired ? (
          <Badge variant="outline" className="text-[10px] text-muted-foreground">Expired</Badge>
        ) : (
          <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
            <Clock size={10} />
            {formatDistanceToNow(new Date(request.expires_at), { addSuffix: false })} left
          </span>
        )}
      </div>
      <h4 className="font-medium text-sm text-foreground">{request.title}</h4>
      {request.description && (
        <p className="text-xs text-muted-foreground line-clamp-2">{request.description}</p>
      )}
      <div className="flex items-center justify-between pt-1">
        <span className="text-[10px] text-muted-foreground">
          {request.author?.name} · {request.author?.block}-{request.author?.flat_number}
        </span>
        <span className="flex items-center gap-1 text-xs text-muted-foreground">
          <MessageCircle size={12} />
          {request.response_count}
        </span>
      </div>
    </button>
  );
}
