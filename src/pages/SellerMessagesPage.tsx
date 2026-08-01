// @ts-nocheck
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AppLayout } from '@/components/layout/AppLayout';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Skeleton } from '@/components/ui/skeleton';
import { MessageCircle, ArrowLeft, ChevronRight } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { motion } from 'framer-motion';
import { staggerContainer, cardEntrance } from '@/lib/motion-variants';

interface ConversationRow {
  order_id: string;
  buyer_id: string;
  buyer_name: string | null;
  last_message: string;
  last_at: string;
  unread_count: number;
}

/**
 * Seller Inbox — lists every order the seller has chat traffic on,
 * sorted by latest activity, with unread badges.
 */
export default function SellerMessagesPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [rows, setRows] = useState<ConversationRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;

    async function load() {
      setLoading(true);
      // Fetch every chat message addressed to or from this seller, then aggregate per order client-side.
      const { data: msgs } = await supabase
        .from('chat_messages')
        .select('id, order_id, sender_id, receiver_id, message_text, created_at, read_status')
        .or(`receiver_id.eq.${user.id},sender_id.eq.${user.id}`)
        .order('created_at', { ascending: false })
        .limit(500);

      if (!msgs || msgs.length === 0) {
        if (!cancelled) { setRows([]); setLoading(false); }
        return;
      }

      const byOrder = new Map<string, ConversationRow>();
      for (const m of msgs) {
        const otherId = m.sender_id === user.id ? m.receiver_id : m.sender_id;
        const existing = byOrder.get(m.order_id);
        if (!existing) {
          byOrder.set(m.order_id, {
            order_id: m.order_id,
            buyer_id: otherId,
            buyer_name: null,
            last_message: m.message_text,
            last_at: m.created_at,
            unread_count: m.receiver_id === user.id && !m.read_status ? 1 : 0,
          });
        } else if (m.receiver_id === user.id && !m.read_status) {
          existing.unread_count += 1;
        }
      }

      // Resolve names
      const otherIds = Array.from(new Set(Array.from(byOrder.values()).map(r => r.buyer_id))).filter(Boolean);
      if (otherIds.length > 0) {
        const { data: profiles } = await supabase
          .from('profiles')
          .select('id, name')
          .in('id', otherIds);
        const nameById = new Map((profiles || []).map((p: any) => [p.id, p.name]));
        for (const row of byOrder.values()) {
          row.buyer_name = nameById.get(row.buyer_id) || 'Customer';
        }
      }

      const result = Array.from(byOrder.values()).sort((a, b) => b.last_at.localeCompare(a.last_at));
      if (!cancelled) { setRows(result); setLoading(false); }
    }

    load();

    // Realtime: refresh on any new chat row involving us
    const channel = supabase
      .channel(`seller-inbox-${user.id}`)
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'chat_messages',
        filter: `receiver_id=eq.${user.id}`,
      }, () => load())
      .on('postgres_changes', {
        event: 'UPDATE', schema: 'public', table: 'chat_messages',
        filter: `receiver_id=eq.${user.id}`,
      }, () => load())
      .subscribe();

    return () => { cancelled = true; supabase.removeChannel(channel); };
  }, [user?.id]);

  return (
    <AppLayout showHeader={false}>
      <div className="px-4 py-3">
        <div className="flex items-center gap-3 mb-4">
          <button onClick={() => navigate(-1)} className="w-9 h-9 rounded-full bg-muted flex items-center justify-center" aria-label="Back">
            <ArrowLeft size={18} />
          </button>
          <div>
            <h1 className="text-lg font-bold">Messages</h1>
            <p className="text-xs text-muted-foreground">Conversations with your customers</p>
          </div>
        </div>

        {loading ? (
          <div className="space-y-2">
            {[0, 1, 2].map(i => <Skeleton key={i} className="h-16 w-full rounded-xl" />)}
          </div>
        ) : rows.length === 0 ? (
          <div className="text-center py-16">
            <div className="mx-auto w-16 h-16 rounded-full bg-muted/50 flex items-center justify-center mb-3">
              <MessageCircle size={28} className="text-muted-foreground" />
            </div>
            <p className="text-sm font-semibold">No messages yet</p>
            <p className="text-xs text-muted-foreground mt-1">When customers reach out, you'll see them here.</p>
          </div>
        ) : (
          <motion.div
            className="space-y-2"
            variants={staggerContainer}
            initial="hidden"
            animate="show"
          >
            {rows.map((row) => (
              <motion.div key={row.order_id} variants={cardEntrance}>
                <Link
                  to={`/orders/${row.order_id}?chat=1`}
                  className="flex items-center gap-3 px-3 py-3 bg-card border border-border rounded-xl shadow-sm hover:bg-accent/5 transition-colors"
                >
                  <div className="relative w-11 h-11 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                    <MessageCircle size={20} className="text-primary" />
                    {row.unread_count > 0 && (
                      <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-destructive text-destructive-foreground text-[10px] font-bold flex items-center justify-center">
                        {row.unread_count > 9 ? '9+' : row.unread_count}
                      </span>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline justify-between gap-2">
                      <p className="text-sm font-semibold truncate">{row.buyer_name || 'Customer'}</p>
                      <span className="text-[10px] text-muted-foreground shrink-0">
                        {formatDistanceToNow(new Date(row.last_at), { addSuffix: true })}
                      </span>
                    </div>
                    <p className={`text-xs truncate mt-0.5 ${row.unread_count > 0 ? 'text-foreground font-medium' : 'text-muted-foreground'}`}>
                      {row.last_message}
                    </p>
                    <p className="text-[10px] text-muted-foreground/70 mt-0.5 font-mono">
                      Order #{row.order_id.slice(0, 8)}
                    </p>
                  </div>
                  <ChevronRight size={16} className="text-muted-foreground shrink-0" />
                </Link>
              </motion.div>
            ))}
          </motion.div>
        )}
      </div>
    </AppLayout>
  );
}
