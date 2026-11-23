// @ts-nocheck
import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { formatDistanceToNow } from 'date-fns';
import { MessageCircle, Search } from 'lucide-react';
import { AppLayout } from '@/components/layout/AppLayout';
import { BackButton } from '@/components/navigation/BackButton';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { FeatureGate } from '@/components/ui/FeatureGate';
import { cn } from '@/lib/utils';
import {
  useConversationActions,
  useConversationsInbox,
  type ConversationInboxRow,
} from '@/hooks/useConversations';
import { toast } from 'sonner';

type Tab = 'all' | 'requests' | 'active';

function initials(name: string | null | undefined) {
  const parts = (name || 'N').trim().split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0]?.toUpperCase() || '').join('') || 'N';
}

function ConversationRow({
  row,
  onAccept,
  onDecline,
}: {
  row: ConversationInboxRow;
  onAccept: (id: string) => void;
  onDecline: (id: string) => void;
}) {
  const isIncomingRequest = row.is_request && !row.am_requester;

  return (
    <div className="rounded-xl border border-border bg-card px-3 py-3 space-y-2">
      <Link to={`/messages/${row.conversation_id}`} className="flex items-start gap-3 min-w-0">
        <div className="w-11 h-11 rounded-full bg-primary/10 text-primary flex items-center justify-center font-semibold shrink-0">
          {initials(row.other_name)}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="font-semibold text-sm truncate">{row.other_name || 'Neighbour'}</p>
            {row.unread_count > 0 && (
              <Badge className="h-5 min-w-5 px-1.5 text-[10px]">{row.unread_count}</Badge>
            )}
            {row.is_request && (
              <Badge variant="secondary" className="text-[10px]">
                {row.am_requester ? 'Sent' : 'Request'}
              </Badge>
            )}
          </div>
          <p className="text-xs text-muted-foreground truncate">
            {[row.other_block, row.other_flat].filter(Boolean).join('-') || 'Society neighbour'}
          </p>
          <p className="text-sm text-foreground/90 truncate mt-0.5">
            {row.last_message_preview || 'No messages yet'}
          </p>
          <div className="flex items-center gap-2 mt-1 flex-wrap">
            {row.last_message_at && (
              <span className="text-[10px] text-muted-foreground">
                {formatDistanceToNow(new Date(row.last_message_at), { addSuffix: true })}
              </span>
            )}
            {row.context_post_title && (
              <Badge variant="outline" className="text-[10px] max-w-[160px] truncate">
                {row.context_post_category || 'Post'}: {row.context_post_title}
              </Badge>
            )}
          </div>
        </div>
      </Link>

      {isIncomingRequest && (
        <div className="flex gap-2 pl-14">
          <Button size="sm" className="flex-1" onClick={() => onAccept(row.conversation_id)}>
            Accept
          </Button>
          <Button size="sm" variant="outline" className="flex-1" onClick={() => onDecline(row.conversation_id)}>
            Decline
          </Button>
        </div>
      )}
    </div>
  );
}

export default function MessagesPage() {
  const navigate = useNavigate();
  const { data: rows = [], isLoading, isError, refetch } = useConversationsInbox();
  const { respondRequest } = useConversationActions();
  const [tab, setTab] = useState<Tab>('all');
  const [q, setQ] = useState('');

  const filtered = useMemo(() => {
    let list = rows;
    if (tab === 'requests') list = list.filter((r) => r.is_request);
    if (tab === 'active') list = list.filter((r) => r.status === 'active');
    const needle = q.trim().toLowerCase();
    if (needle) {
      list = list.filter(
        (r) =>
          (r.other_name || '').toLowerCase().includes(needle)
          || (r.last_message_preview || '').toLowerCase().includes(needle)
          || (r.context_post_title || '').toLowerCase().includes(needle),
      );
    }
    return list;
  }, [rows, tab, q]);

  const requestCount = rows.filter((r) => r.is_request && !r.am_requester).length;
  const unreadCount = rows.reduce((sum, r) => sum + Number(r.unread_count || 0), 0);
  const activeCount = rows.filter((r) => r.status === 'active').length;

  const handleAccept = async (id: string) => {
    try {
      await respondRequest.mutateAsync({ conversationId: id, accept: true });
      toast.success('Request accepted');
      navigate(`/messages/${id}`);
    } catch (e: any) {
      toast.error(e?.message || 'Could not accept');
    }
  };

  const handleDecline = async (id: string) => {
    try {
      await respondRequest.mutateAsync({ conversationId: id, accept: false });
      toast.success('Request declined');
      refetch();
    } catch (e: any) {
      toast.error(e?.message || 'Could not decline');
    }
  };

  return (
    <FeatureGate feature="conversations">
      <AppLayout>
        <div className="px-4 pt-3 pb-24 space-y-4">
          <div className="flex items-center gap-2">
            <BackButton fallback="/profile" />
            <div className="min-w-0">
              <h1 className="text-lg font-bold leading-tight">Messages</h1>
              <p className="text-xs text-muted-foreground">Your community conversations</p>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-2">
            <div className="rounded-xl bg-muted/50 px-3 py-2 text-center">
              <p className="text-lg font-bold">{unreadCount}</p>
              <p className="text-[10px] text-muted-foreground">Unread</p>
            </div>
            <div className="rounded-xl bg-muted/50 px-3 py-2 text-center">
              <p className="text-lg font-bold">{requestCount}</p>
              <p className="text-[10px] text-muted-foreground">Requests</p>
            </div>
            <div className="rounded-xl bg-muted/50 px-3 py-2 text-center">
              <p className="text-lg font-bold">{activeCount}</p>
              <p className="text-[10px] text-muted-foreground">Active</p>
            </div>
          </div>

          <div className="relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search conversations..."
              className="pl-9"
            />
          </div>

          <div className="flex gap-2 overflow-x-auto pb-1">
            {(
              [
                ['all', 'All'],
                ['requests', 'Requests'],
                ['active', 'Active'],
              ] as const
            ).map(([key, label]) => (
              <Button
                key={key}
                size="sm"
                variant={tab === key ? 'default' : 'outline'}
                className={cn('shrink-0 rounded-full', tab === key && 'shadow-sm')}
                onClick={() => setTab(key)}
              >
                {label}
              </Button>
            ))}
          </div>

          {isLoading && (
            <div className="space-y-2">
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-20 w-full rounded-xl" />
              ))}
            </div>
          )}

          {isError && (
            <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-sm">
              Could not load messages.
              <Button size="sm" variant="outline" className="ml-2" onClick={() => refetch()}>
                Retry
              </Button>
            </div>
          )}

          {!isLoading && !isError && filtered.length === 0 && (
            <div className="text-center py-16 text-muted-foreground space-y-2">
              <MessageCircle className="mx-auto opacity-50" size={36} />
              <p className="text-sm font-medium text-foreground">No conversations yet</p>
              <p className="text-xs max-w-xs mx-auto">
                Open a Smart Groups post and tap Message author to start a private chat with a neighbour.
              </p>
              <Button asChild size="sm" className="mt-2">
                <Link to="/community">Go to Smart Groups</Link>
              </Button>
            </div>
          )}

          <div className="space-y-2">
            {filtered.map((row) => (
              <ConversationRow
                key={row.conversation_id}
                row={row}
                onAccept={handleAccept}
                onDecline={handleDecline}
              />
            ))}
          </div>
        </div>
      </AppLayout>
    </FeatureGate>
  );
}
