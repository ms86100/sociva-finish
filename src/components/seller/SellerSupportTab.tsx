// @ts-nocheck
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSellerSupportItems, type UnifiedSupportItem } from '@/hooks/useSupportTickets';
import { SupportTicketCard } from '@/components/support/SupportTicketCard';
import { SupportTicketDetail } from '@/components/support/SupportTicketDetail';
import type { SupportTicket } from '@/hooks/useSupportTickets';
import { Loader2, ShieldCheck, AlertTriangle } from 'lucide-react';

interface SellerSupportTabProps {
  /** seller's profiles.id (user_id) — used for support_tickets */
  sellerUserId?: string;
  /** seller_profiles.id — used for refund_requests joined through orders */
  sellerProfileId?: string;
  /** @deprecated legacy prop — kept for backward compatibility, treated as sellerProfileId */
  sellerId?: string;
}

const ACTIVE = ['open', 'seller_pending'];
const RESOLVED = ['resolved', 'auto_resolved', 'closed'];

export function SellerSupportTab({ sellerUserId, sellerProfileId, sellerId }: SellerSupportTabProps) {
  const navigate = useNavigate();
  const { data: items = [], isLoading } = useSellerSupportItems({
    sellerUserId,
    sellerProfileId: sellerProfileId ?? sellerId,
  });
  const [selectedTicket, setSelectedTicket] = useState<SupportTicket | null>(null);
  const [filter, setFilter] = useState<'active' | 'resolved'>('active');

  const filtered = items.filter(i =>
    filter === 'active' ? ACTIVE.includes(i.status) : RESOLVED.includes(i.status)
  );

  const activeCount = items.filter(i => ACTIVE.includes(i.status)).length;
  const breachedCount = items.filter(i => i.sla_breached && ACTIVE.includes(i.status)).length;

  const handleTap = (item: UnifiedSupportItem) => {
    if (item.kind === 'ticket' && item.ticket) {
      setSelectedTicket(item.ticket);
    } else {
      navigate(`/orders/${item.order_id}`);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="animate-spin text-muted-foreground" size={24} />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Stats */}
      <div className="flex gap-3">
        <div className="flex-1 bg-card border border-border rounded-xl p-3 text-center">
          <p className="text-lg font-bold">{activeCount}</p>
          <p className="text-[11px] text-muted-foreground">Active items</p>
        </div>
        {breachedCount > 0 && (
          <div className="flex-1 bg-destructive/5 border border-destructive/20 rounded-xl p-3 text-center">
            <div className="flex items-center justify-center gap-1">
              <AlertTriangle size={14} className="text-destructive" />
              <p className="text-lg font-bold text-destructive">{breachedCount}</p>
            </div>
            <p className="text-[11px] text-destructive/80">SLA breached</p>
          </div>
        )}
      </div>

      {/* Filter tabs */}
      <div className="flex gap-2">
        <button
          onClick={() => setFilter('active')}
          className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
            filter === 'active' ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'
          }`}
        >
          Active {activeCount > 0 && `(${activeCount})`}
        </button>
        <button
          onClick={() => setFilter('resolved')}
          className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
            filter === 'resolved' ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'
          }`}
        >
          Resolved
        </button>
      </div>

      {/* List */}
      {filtered.length === 0 ? (
        <div className="text-center py-12">
          <ShieldCheck className="mx-auto text-muted-foreground mb-2" size={32} />
          <p className="text-sm text-muted-foreground">
            {filter === 'active' ? 'No active support items' : 'No resolved items yet'}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((item) => (
            <SupportTicketCard
              key={item.id}
              ticket={item as any}
              kind={item.kind}
              viewRole="seller"
              onClick={() => handleTap(item)}
            />
          ))}
        </div>
      )}

      <SupportTicketDetail
        ticket={selectedTicket}
        open={!!selectedTicket}
        onOpenChange={(open) => { if (!open) setSelectedTicket(null); }}
        viewRole="seller"
      />
    </div>
  );
}
