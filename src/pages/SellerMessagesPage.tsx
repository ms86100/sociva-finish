// @ts-nocheck
import { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { AppLayout } from '@/components/layout/AppLayout';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Skeleton } from '@/components/ui/skeleton';
import { BackButton } from '@/components/navigation/BackButton';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { MessageCircle, ChevronRight, Phone, User } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { motion } from 'framer-motion';
import { staggerContainer, cardEntrance } from '@/lib/motion-variants';
import { SellerContactChatSheet } from '@/components/seller/SellerContactChatSheet';

interface ConversationRow {
  order_id: string;
  buyer_id: string;
  buyer_name: string | null;
  last_message: string;
  last_at: string;
  unread_count: number;
}

interface ContactLeadRow {
  id: string;
  buyer_id: string;
  buyer_name: string | null;
  product_id: string | null;
  product_name: string | null;
  interaction_type: 'call' | 'message';
  order_id: string | null;
  conversation_id: string | null;
  status: string;
  created_at: string;
}

export default function SellerMessagesPage() {
  const { user, sellerProfiles = [] } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get('tab');
  const tab = tabParam === 'orders' ? 'orders' : 'contacts';

  const sellerIds = useMemo(
    () => sellerProfiles.map((s) => s.id).filter(Boolean) as string[],
    [sellerProfiles],
  );

  const [orderRows, setOrderRows] = useState<ConversationRow[]>([]);
  const [contactRows, setContactRows] = useState<ContactLeadRow[]>([]);
  const [loadingOrders, setLoadingOrders] = useState(true);
  const [loadingContacts, setLoadingContacts] = useState(true);
  const [chatOpen, setChatOpen] = useState(false);
  const [activeLead, setActiveLead] = useState<ContactLeadRow | null>(null);
  const didAutoTabRef = useRef(false);

  const setTab = (next: string) => {
    didAutoTabRef.current = true;
    setSearchParams(next === 'orders' ? { tab: 'orders' } : { tab: 'contacts' }, { replace: true });
  };

  const loadOrders = useCallback(async () => {
    if (!user) return;
    setLoadingOrders(true);
    const { data: msgs } = await supabase
      .from('chat_messages')
      .select('id, order_id, sender_id, receiver_id, message_text, created_at, read_status')
      .or(`receiver_id.eq.${user.id},sender_id.eq.${user.id}`)
      .order('created_at', { ascending: false })
      .limit(500);

    if (!msgs || msgs.length === 0) {
      setOrderRows([]);
      setLoadingOrders(false);
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

    const otherIds = Array.from(new Set(Array.from(byOrder.values()).map((r) => r.buyer_id))).filter(Boolean);
    if (otherIds.length > 0) {
      const { data: profiles } = await supabase.from('profiles').select('id, name').in('id', otherIds);
      const nameById = new Map((profiles || []).map((p: any) => [p.id, p.name]));
      for (const row of byOrder.values()) {
        row.buyer_name = nameById.get(row.buyer_id) || 'Customer';
      }
    }

    setOrderRows(Array.from(byOrder.values()).sort((a, b) => b.last_at.localeCompare(a.last_at)));
    setLoadingOrders(false);
  }, [user]);

  const loadContacts = useCallback(async () => {
    if (!user || sellerIds.length === 0) {
      setContactRows([]);
      setLoadingContacts(false);
      return;
    }
    setLoadingContacts(true);

    const { data, error } = await supabase
      .from('seller_contact_interactions')
      .select('id, buyer_id, product_id, interaction_type, order_id, conversation_id, status, created_at')
      .in('seller_id', sellerIds)
      .order('created_at', { ascending: false })
      .limit(100);

    if (error || !data) {
      console.warn('[SellerMessages] contact leads query failed:', error?.message);
      setContactRows([]);
      setLoadingContacts(false);
      return;
    }

    const buyerIds = Array.from(new Set(data.map((r: any) => r.buyer_id))).filter(Boolean);
    const productIds = Array.from(new Set(data.map((r: any) => r.product_id))).filter(Boolean);
    const [{ data: profiles }, { data: products }] = await Promise.all([
      buyerIds.length
        ? supabase.from('profiles').select('id, name').in('id', buyerIds)
        : Promise.resolve({ data: [] as { id: string; name: string | null }[] }),
      productIds.length
        ? supabase.from('products').select('id, name').in('id', productIds)
        : Promise.resolve({ data: [] as { id: string; name: string | null }[] }),
    ]);
    const nameById = new Map((profiles || []).map((p: any) => [p.id, p.name]));
    const productNameById = new Map((products || []).map((p: any) => [p.id, p.name]));

    const rows: ContactLeadRow[] = data.map((r: any) => ({
      id: r.id,
      buyer_id: r.buyer_id,
      buyer_name: nameById.get(r.buyer_id) || 'Customer',
      product_id: r.product_id,
      product_name: (r.product_id && productNameById.get(r.product_id)) || null,
      interaction_type: r.interaction_type,
      order_id: r.order_id,
      conversation_id: r.conversation_id,
      status: r.status,
      created_at: r.created_at,
    }));

    setContactRows(rows);
    setLoadingContacts(false);
  }, [user, sellerIds]);

  useEffect(() => {
    if (!user) return;
    loadOrders();
    loadContacts();

    const channel = supabase
      .channel(`seller-inbox-${user.id}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'chat_messages', filter: `receiver_id=eq.${user.id}` }, () => loadOrders())
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'chat_messages', filter: `receiver_id=eq.${user.id}` }, () => loadOrders())
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'seller_contact_interactions' }, () => loadContacts())
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [user?.id, loadOrders, loadContacts]);

  // If Contact leads are empty but order chats exist, land on Order messages so the inbox
  // never looks falsely empty when buyers already messaged via enquiry/order threads.
  useEffect(() => {
    if (loadingContacts || loadingOrders) return;
    if (didAutoTabRef.current || tabParam) return;
    if (contactRows.length === 0 && orderRows.length > 0) {
      didAutoTabRef.current = true;
      setSearchParams({ tab: 'orders' }, { replace: true });
    }
  }, [loadingContacts, loadingOrders, contactRows.length, orderRows.length, tabParam, setSearchParams]);

  useEffect(() => {
    const conv = searchParams.get('conv');
    const lead = searchParams.get('lead');
    if (!conv && !lead) return;
    const row = contactRows.find((r) => (conv && r.conversation_id === conv) || (lead && r.id === lead));
    if (row) {
      void openContactLead(row);
    }
  }, [contactRows, searchParams]);

  const openContactLead = async (lead: ContactLeadRow) => {
    setActiveLead(lead);
    if (lead.status === 'new') {
      await supabase.rpc('mark_contact_interaction_status', {
        p_interaction_id: lead.id,
        p_status: 'viewed',
      });
      setContactRows((rows) => rows.map((r) => (r.id === lead.id ? { ...r, status: 'viewed' } : r)));
    }
    if (lead.interaction_type === 'message' && lead.product_id) {
      setChatOpen(true);
    }
  };

  const newContactCount = contactRows.filter((r) => r.status === 'new').length;
  const orderUnread = orderRows.reduce((sum, r) => sum + r.unread_count, 0);

  return (
    <AppLayout showHeader={false}>
      <div className="px-4 py-3">
        <div className="flex items-center gap-3 mb-4">
          <BackButton fallback="/seller" />
          <div>
            <h1 className="text-lg font-bold">Messages</h1>
            <p className="text-xs text-muted-foreground">Contact leads & order chats</p>
          </div>
        </div>

        <Tabs value={tab} onValueChange={setTab} className="w-full">
          <TabsList className="w-full h-9 rounded-xl bg-muted/60 p-0.5 mb-3">
            <TabsTrigger value="contacts" className="flex-1 text-xs rounded-lg font-semibold gap-1.5">
              Contact leads
              {newContactCount > 0 && (
                <Badge variant="destructive" className="h-4 min-w-4 px-1 text-[9px] rounded-full">{newContactCount}</Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="orders" className="flex-1 text-xs rounded-lg font-semibold gap-1.5">
              Order messages
              {orderUnread > 0 && (
                <Badge variant="destructive" className="h-4 min-w-4 px-1 text-[9px] rounded-full">{orderUnread > 9 ? '9+' : orderUnread}</Badge>
              )}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="contacts" className="mt-0">
            {loadingContacts ? (
              <div className="space-y-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-16 w-full rounded-xl" />)}</div>
            ) : contactRows.length === 0 ? (
              <EmptyState
                title="No contact leads yet"
                subtitle={
                  orderRows.length > 0
                    ? 'Call/message leads from Contact buttons appear here. Buyer chats on orders are under the Order messages tab.'
                    : "When buyers call or message about your listings, they'll appear here."
                }
              />
            ) : (
              <motion.div className="space-y-2" variants={staggerContainer} initial="hidden" animate="show">
                {contactRows.map((row) => (
                  <motion.div key={row.id} variants={cardEntrance}>
                    <button
                      type="button"
                      onClick={() => openContactLead(row)}
                      className="w-full flex items-center gap-3 px-3 py-3 bg-card border border-border rounded-xl shadow-sm hover:bg-accent/5 transition-colors text-left"
                    >
                      <div className="relative w-11 h-11 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                        {row.interaction_type === 'call' ? <Phone size={18} className="text-primary" /> : <MessageCircle size={18} className="text-primary" />}
                        {row.status === 'new' && <span className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-destructive" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-baseline justify-between gap-2">
                          <p className="text-sm font-semibold truncate">{row.buyer_name}</p>
                          <span className="text-[10px] text-muted-foreground shrink-0">
                            {formatDistanceToNow(new Date(row.created_at), { addSuffix: true })}
                          </span>
                        </div>
                        <p className="text-xs text-muted-foreground truncate mt-0.5">
                          {row.interaction_type === 'call' ? 'Called' : 'Messaged'} about {row.product_name || 'your listing'}
                        </p>
                        <div className="flex items-center gap-2 mt-1">
                          <Badge variant="outline" className="text-[9px] h-4 capitalize">{row.status}</Badge>
                          {row.order_id && <span className="text-[10px] text-muted-foreground font-mono">#{row.order_id.slice(0, 8)}</span>}
                        </div>
                      </div>
                      <ChevronRight size={16} className="text-muted-foreground shrink-0" />
                    </button>
                  </motion.div>
                ))}
              </motion.div>
            )}
          </TabsContent>

          <TabsContent value="orders" className="mt-0">
            {loadingOrders ? (
              <div className="space-y-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-16 w-full rounded-xl" />)}</div>
            ) : orderRows.length === 0 ? (
              <EmptyState title="No order messages yet" subtitle="Order chat threads will show up here." />
            ) : (
              <motion.div className="space-y-2" variants={staggerContainer} initial="hidden" animate="show">
                {orderRows.map((row) => (
                  <motion.div key={row.order_id} variants={cardEntrance}>
                    <Link
                      to={`/orders/${row.order_id}?chat=1`}
                      className="flex items-center gap-3 px-3 py-3 bg-card border border-border rounded-xl shadow-sm hover:bg-accent/5 transition-colors"
                    >
                      <div className="relative w-11 h-11 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                        <User size={20} className="text-primary" />
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
                      </div>
                      <ChevronRight size={16} className="text-muted-foreground shrink-0" />
                    </Link>
                  </motion.div>
                ))}
              </motion.div>
            )}
          </TabsContent>
        </Tabs>

        {activeLead?.order_id && (
          <div className="mt-4">
            <Button variant="outline" className="w-full" asChild>
              <Link to={`/orders/${activeLead.order_id}`}>View enquiry order</Link>
            </Button>
          </div>
        )}
      </div>

      {activeLead && activeLead.product_id && activeSellerId && user && (
        <SellerContactChatSheet
          open={chatOpen}
          onOpenChange={setChatOpen}
          buyerId={activeLead.buyer_id}
          sellerProfileId={activeSellerId}
          sellerUserId={user.id}
          productId={activeLead.product_id}
          productName={activeLead.product_name || 'Listing'}
          buyerName={activeLead.buyer_name || 'Customer'}
          conversationId={activeLead.conversation_id}
        />
      )}
    </AppLayout>
  );
}

function EmptyState({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="text-center py-16">
      <div className="mx-auto w-16 h-16 rounded-full bg-muted/50 flex items-center justify-center mb-3">
        <MessageCircle size={28} className="text-muted-foreground" />
      </div>
      <p className="text-sm font-semibold">{title}</p>
      <p className="text-xs text-muted-foreground mt-1">{subtitle}</p>
    </div>
  );
}
