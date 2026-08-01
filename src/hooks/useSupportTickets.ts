// @ts-nocheck
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useEffect } from 'react';
import { toast } from 'sonner';

export interface SupportTicket {
  id: string;
  order_id: string;
  buyer_id: string;
  seller_id: string;
  society_id: string | null;
  issue_type: string;
  issue_subtype: string | null;
  description: string;
  evidence_urls: string[];
  status: string;
  resolution_type: string | null;
  resolution_note: string | null;
  sla_deadline: string | null;
  sla_breached: boolean;
  resolved_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface SupportTicketMessage {
  id: string;
  ticket_id: string;
  sender_id: string;
  sender_type: string;
  message_text: string;
  action_type: string | null;
  metadata: any;
  created_at: string;
}

export interface ResolutionResult {
  resolved: boolean;
  resolution_type: string | null;
  resolution_note: string | null;
  order_status: string;
  seller_id: string;
  buyer_id: string;
  society_id: string | null;
  error?: string;
}

// Evaluate resolution rules BEFORE ticket creation
export function useEvaluateResolution() {
  return useMutation({
    mutationFn: async ({ orderId, issueType, issueSubtype }: { orderId: string; issueType: string; issueSubtype?: string }) => {
      const { data, error } = await supabase.rpc('fn_evaluate_support_resolution', {
        p_order_id: orderId,
        p_issue_type: issueType,
        p_issue_subtype: issueSubtype || null,
      });
      if (error) throw error;
      return data as ResolutionResult;
    },
  });
}

// Create ticket via SECURITY DEFINER RPC (resolves seller_profiles.id -> profiles.id server-side,
// inserts the ticket, seeds the first message, and enqueues the seller notification atomically).
export function useCreateTicket() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (ticket: {
      order_id: string;
      buyer_id: string;
      seller_id: string; // NOTE: pass orders.seller_id (a seller_profiles.id); RPC translates it
      society_id?: string | null;
      issue_type: string;
      issue_subtype?: string | null;
      description: string;
      evidence_urls?: string[];
    }) => {
      const { data, error } = await supabase.rpc('fn_create_support_ticket', {
        p_order_id: ticket.order_id,
        p_issue_type: ticket.issue_type,
        p_issue_subtype: ticket.issue_subtype ?? null,
        p_description: ticket.description,
        p_evidence_urls: ticket.evidence_urls ?? [],
      });

      if (error) {
        const msg = error.message || 'support_ticket_failed';
        throw new Error(msg);
      }

      return data as unknown as SupportTicket;
    },
    onSuccess: () => {
      supabase.functions.invoke('process-notification-queue').catch(() => {});
      queryClient.invalidateQueries({ queryKey: ['support-tickets'] });
      queryClient.invalidateQueries({ queryKey: ['support-items'] });
    },
  });
}

// Buyer's tickets
export function useMyTickets() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['support-tickets', 'buyer', user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('support_tickets')
        .select('*')
        .eq('buyer_id', user!.id)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data as SupportTicket[];
    },
    enabled: !!user?.id,
  });
}

// Seller's tickets — IMPORTANT: support_tickets.seller_id stores profiles.id (the seller's user_id),
// NOT seller_profiles.id. Always pass sellerProfile.user_id here.
export function useSellerTickets(sellerUserId?: string) {
  return useQuery({
    queryKey: ['support-tickets', 'seller', sellerUserId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('support_tickets')
        .select('*')
        .eq('seller_id', sellerUserId!)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data as SupportTicket[];
    },
    enabled: !!sellerUserId,
  });
}

// Realtime: invalidate seller support queries the moment a new ticket is inserted for this seller.
export function useSellerSupportRealtime(sellerUserId?: string) {
  const queryClient = useQueryClient();
  useEffect(() => {
    if (!sellerUserId) return;
    const channel = supabase
      .channel(`seller-support-${sellerUserId}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'support_tickets',
        filter: `seller_id=eq.${sellerUserId}`,
      }, () => {
        queryClient.invalidateQueries({ queryKey: ['support-tickets', 'seller', sellerUserId] });
        queryClient.invalidateQueries({ queryKey: ['support-items', 'seller'] });
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [sellerUserId, queryClient]);
}

// Unified support items: support_tickets + refund_requests for a seller
export interface UnifiedSupportItem {
  kind: 'ticket' | 'refund';
  id: string;
  source_id: string; // ticket id or refund id
  order_id: string;
  status: string; // unified: open | seller_pending | resolved | auto_resolved | closed
  raw_status: string;
  issue_type: string;
  description: string;
  created_at: string;
  resolved_at: string | null;
  sla_deadline: string | null;
  sla_breached: boolean;
  amount?: number | null;
  ticket?: SupportTicket;
}

const REFUND_STATUS_MAP: Record<string, string> = {
  requested: 'seller_pending',
  pending: 'seller_pending',
  under_review: 'seller_pending',
  processing: 'seller_pending',
  approved: 'resolved',
  auto_approved: 'resolved',
  processed: 'resolved',
  settled: 'resolved',
  rejected: 'closed',
  cancelled: 'closed',
};

// Unified seller support items.
// - support_tickets are keyed off the seller's profiles.id (user_id)
// - refund_requests are joined through orders.seller_id which IS seller_profiles.id
// Pass both ids explicitly so we never confuse the two domains again.
export function useSellerSupportItems(args: { sellerUserId?: string; sellerProfileId?: string } | string | undefined) {
  // Backward-compat shim: a bare string was the old seller_profiles.id arg.
  const sellerUserId = typeof args === 'object' ? args?.sellerUserId : undefined;
  const sellerProfileId = typeof args === 'object' ? args?.sellerProfileId : (typeof args === 'string' ? args : undefined);

  return useQuery({
    queryKey: ['support-items', 'seller', sellerUserId, sellerProfileId],
    queryFn: async () => {
      const [ticketsRes, refundsRes] = await Promise.all([
        sellerUserId
          ? supabase
              .from('support_tickets')
              .select('*')
              .eq('seller_id', sellerUserId)
              .order('created_at', { ascending: false })
          : Promise.resolve({ data: [], error: null } as any),
        sellerProfileId
          ? supabase
              .from('refund_requests')
              .select('id, order_id, status, category, reason, amount, created_at, updated_at, orders!inner(seller_id)')
              .eq('orders.seller_id', sellerProfileId)
              .order('created_at', { ascending: false })
          : Promise.resolve({ data: [], error: null } as any),
      ]);

      if (ticketsRes.error) throw ticketsRes.error;
      if (refundsRes.error) throw refundsRes.error;

      const ticketItems: UnifiedSupportItem[] = (ticketsRes.data || []).map((t: any) => ({
        kind: 'ticket',
        id: `ticket-${t.id}`,
        source_id: t.id,
        order_id: t.order_id,
        status: t.status,
        raw_status: t.status,
        issue_type: t.issue_type,
        description: t.description,
        created_at: t.created_at,
        resolved_at: t.resolved_at,
        sla_deadline: t.sla_deadline,
        sla_breached: t.sla_breached,
        ticket: t as SupportTicket,
      }));

      const refundItems: UnifiedSupportItem[] = (refundsRes.data || []).map((r: any) => ({
        kind: 'refund',
        id: `refund-${r.id}`,
        source_id: r.id,
        order_id: r.order_id,
        status: REFUND_STATUS_MAP[r.status] || 'seller_pending',
        raw_status: r.status,
        issue_type: r.category || 'refund_request',
        description: r.reason || 'Refund request',
        created_at: r.created_at,
        resolved_at: ['approved', 'auto_approved', 'processed', 'settled', 'rejected', 'cancelled'].includes(r.status) ? r.updated_at : null,
        sla_deadline: null,
        sla_breached: false,
        amount: r.amount,
      }));

      return [...ticketItems, ...refundItems].sort(
        (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      );
    },
    enabled: !!(sellerUserId || sellerProfileId),
    staleTime: 30_000,
  });
}

// Ticket for a specific order
export function useOrderTickets(orderId?: string) {
  return useQuery({
    queryKey: ['support-tickets', 'order', orderId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('support_tickets')
        .select('*')
        .eq('order_id', orderId!)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data as SupportTicket[];
    },
    enabled: !!orderId,
  });
}

// Ticket messages with realtime
export function useTicketMessages(ticketId?: string) {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!ticketId) return;
    const channel = supabase
      .channel(`ticket-messages-${ticketId}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'support_ticket_messages',
        filter: `ticket_id=eq.${ticketId}`,
      }, () => {
        queryClient.invalidateQueries({ queryKey: ['ticket-messages', ticketId] });
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [ticketId]);

  return useQuery({
    queryKey: ['ticket-messages', ticketId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('support_ticket_messages')
        .select('*')
        .eq('ticket_id', ticketId!)
        .order('created_at', { ascending: true });
      if (error) throw error;
      return data as SupportTicketMessage[];
    },
    enabled: !!ticketId,
  });
}

// Send message in a ticket
export function useSendTicketMessage() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (msg: {
      ticket_id: string;
      sender_id: string;
      sender_type: string;
      message_text: string;
      action_type?: string;
    }) => {
      const { data, error } = await supabase
        .from('support_ticket_messages')
        .insert(msg)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: (_, vars) => {
      queryClient.invalidateQueries({ queryKey: ['ticket-messages', vars.ticket_id] });
    },
  });
}

// Seller resolve/reject ticket
export function useResolveTicket() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ ticketId, action, note }: { ticketId: string; action: 'accept' | 'reject'; note?: string }) => {
      const updates = action === 'accept'
        ? { status: 'resolved', resolution_type: 'manual', resolution_note: note || 'Resolved by seller', resolved_at: new Date().toISOString() }
        : { status: 'open', resolution_note: note || 'Seller requested more info' };

      const { error } = await supabase
        .from('support_tickets')
        .update(updates)
        .eq('id', ticketId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['support-tickets'] });
      toast.success('Ticket updated');
    },
  });
}

// Upload evidence image
export async function uploadEvidence(userId: string, file: File): Promise<string> {
  const ext = file.name.split('.').pop() || 'jpg';
  const path = `${userId}/${Date.now()}.${ext}`;
  const { error } = await supabase.storage
    .from('support-evidence')
    .upload(path, file, { contentType: file.type, upsert: false });
  if (error) throw error;
  const { data } = supabase.storage.from('support-evidence').getPublicUrl(path);
  return data.publicUrl;
}
