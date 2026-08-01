// @ts-nocheck
import { useState, useEffect, useCallback, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

interface Message {
  id: string;
  conversation_id: string;
  sender_id: string;
  message_text: string;
  is_read: boolean;
  created_at: string;
}

const CHAT_NOTIF_THROTTLE_MS = 60_000; // 1 minute

export function useSellerChat(buyerId: string | undefined, sellerId: string | undefined, productId: string | undefined) {
  const qc = useQueryClient();
  const [conversationId, setConversationId] = useState<string | null>(null);
  // Track last notification time per recipient to throttle
  const lastNotifRef = useRef<Record<string, number>>({});

  // Bug 14 fix: Use upsert to prevent TOCTOU race on conversation creation
  const getOrCreate = useCallback(async () => {
    if (!buyerId || !sellerId || !productId) return null;

    // Try to find existing first (fast path)
    const { data: existing } = await supabase
      .from('seller_conversations')
      .select('id')
      .eq('buyer_id', buyerId)
      .eq('seller_id', sellerId)
      .eq('product_id', productId)
      .maybeSingle();

    if (existing) {
      setConversationId(existing.id);
      return existing.id;
    }

    // Use upsert with onConflict to handle race condition
    const { data: created, error } = await supabase
      .from('seller_conversations')
      .upsert(
        { buyer_id: buyerId, seller_id: sellerId, product_id: productId },
        { onConflict: 'buyer_id,seller_id,product_id', ignoreDuplicates: false }
      )
      .select('id')
      .single();

    if (error) {
      // If upsert fails (e.g., no unique constraint), fallback to select
      const { data: fallback } = await supabase
        .from('seller_conversations')
        .select('id')
        .eq('buyer_id', buyerId)
        .eq('seller_id', sellerId)
        .eq('product_id', productId)
        .single();
      if (fallback) {
        setConversationId(fallback.id);
        return fallback.id;
      }
      throw error;
    }
    setConversationId(created.id);
    return created.id;
  }, [buyerId, sellerId, productId]);

  // Messages query
  const { data: messages = [], isLoading } = useQuery<Message[]>({
    queryKey: ['seller-chat', conversationId],
    enabled: !!conversationId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('seller_conversation_messages')
        .select('id, conversation_id, sender_id, content, created_at, message_type, metadata')
        .eq('conversation_id', conversationId!)
        .order('created_at', { ascending: true });
      if (error) throw error;
      return (data ?? []) as Message[];
    },
  });

  // Realtime subscription — subscribe FIRST, then refetch on SUBSCRIBED to avoid race.
  useEffect(() => {
    if (!conversationId) return;
    const channel = supabase
      .channel(`chat-${conversationId}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'seller_conversation_messages',
        filter: `conversation_id=eq.${conversationId}`,
      }, () => {
        qc.invalidateQueries({ queryKey: ['seller-chat', conversationId] });
      })
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'seller_conversation_messages',
        filter: `conversation_id=eq.${conversationId}`,
      }, () => {
        qc.invalidateQueries({ queryKey: ['seller-chat', conversationId] });
      })
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          qc.invalidateQueries({ queryKey: ['seller-chat', conversationId] });
        }
      });

    return () => { supabase.removeChannel(channel); };
  }, [conversationId, qc]);

  // Send message — optimistic insert into the cache so it renders instantly.
  const sendMutation = useMutation({
    mutationFn: async ({ text, senderId }: { text: string; senderId: string }) => {
      let cid = conversationId;
      if (!cid) cid = await getOrCreate();
      if (!cid) throw new Error('Could not create conversation');
      if (conversationId !== cid) setConversationId(cid);

      // Optimistic placeholder
      const tempId = `tmp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const optimistic: any = {
        id: tempId,
        conversation_id: cid,
        sender_id: senderId,
        message_text: text,
        content: text,
        created_at: new Date().toISOString(),
        is_read: false,
        _optimistic: true,
      };
      qc.setQueryData<Message[]>(['seller-chat', cid], (old = []) => [...old, optimistic]);

      const { data: inserted, error } = await supabase
        .from('seller_conversation_messages')
        .insert({ conversation_id: cid, sender_id: senderId, message_text: text })
        .select('id, conversation_id, sender_id, content, created_at, message_type, metadata')
        .single();
      if (error) {
        // Rollback optimistic
        qc.setQueryData<Message[]>(['seller-chat', cid], (old = []) => old.filter((m) => m.id !== tempId));
        throw error;
      }
      // Replace optimistic with real row
      qc.setQueryData<Message[]>(['seller-chat', cid], (old = []) =>
        old.map((m) => (m.id === tempId ? (inserted as any) : m)),
      );

      // Determine recipient for notification
      const recipientId = senderId === buyerId ? sellerId : buyerId;
      if (recipientId) {
        const now = Date.now();
        const lastSent = lastNotifRef.current[recipientId] || 0;

        // Only send notification if throttle window has passed
        if (now - lastSent >= CHAT_NOTIF_THROTTLE_MS) {
          lastNotifRef.current[recipientId] = now;
          await supabase.from('notification_queue').insert({
            user_id: recipientId,
            type: 'chat',
            title: '💬 New message',
            body: text.slice(0, 100),
            reference_path: `/orders`,
            payload: { type: 'seller_chat', conversationId: cid },
          });
          supabase.functions.invoke('process-notification-queue').catch(() => {});
        }
      }

      return cid;
    },
    onSuccess: (cid) => {
      qc.invalidateQueries({ queryKey: ['seller-chat', cid] });
    },
  });

  return {
    conversationId,
    messages,
    isLoading,
    getOrCreate,
    sendMessage: sendMutation.mutateAsync,
    isSending: sendMutation.isPending,
  };
}
