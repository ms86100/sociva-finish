// @ts-nocheck
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

export interface ConversationInboxRow {
  conversation_id: string;
  status: 'pending' | 'active' | 'declined' | string;
  other_user_id: string;
  other_name: string | null;
  other_block: string | null;
  other_flat: string | null;
  last_message_at: string | null;
  last_message_preview: string | null;
  unread_count: number;
  context_post_id: string | null;
  context_post_title: string | null;
  context_post_category: string | null;
  is_request: boolean;
  am_requester: boolean;
}

export function useConversationsInbox(enabled = true) {
  const { user } = useAuth();
  const qc = useQueryClient();

  const query = useQuery({
    queryKey: ['conversations-inbox', user?.id],
    enabled: !!user && enabled,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('conversations_inbox', {
        _limit: 50,
        _offset: 0,
      });
      if (error) throw error;
      return (data || []) as ConversationInboxRow[];
    },
    staleTime: 15_000,
  });

  useEffect(() => {
    if (!user?.id || !enabled) return;
    const channel = supabase
      .channel(`conversations-inbox-${user.id}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'conversation_messages' },
        () => {
          qc.invalidateQueries({ queryKey: ['conversations-inbox', user.id] });
          qc.invalidateQueries({ queryKey: ['conversations-unread', user.id] });
        },
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'conversations' },
        () => {
          qc.invalidateQueries({ queryKey: ['conversations-inbox', user.id] });
          qc.invalidateQueries({ queryKey: ['conversations-unread', user.id] });
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [user?.id, enabled, qc]);

  return query;
}

export function useConversationsUnreadCount(enabled = true) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['conversations-unread', user?.id],
    enabled: !!user && enabled,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('conversations_unread_count');
      if (error) throw error;
      return Number(data || 0);
    },
    staleTime: 20_000,
    refetchInterval: 60_000,
  });
}

export function useConversationActions() {
  const qc = useQueryClient();
  const { user } = useAuth();

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['conversations-inbox', user?.id] });
    qc.invalidateQueries({ queryKey: ['conversations-unread', user?.id] });
  };

  const openOrRequest = useMutation({
    mutationFn: async (args: {
      targetUserId: string;
      firstMessage?: string;
      contextPostId?: string | null;
      idempotencyKey?: string;
    }) => {
      const { data, error } = await supabase.rpc('conversations_open_or_request', {
        _target_user_id: args.targetUserId,
        _first_message: args.firstMessage || '',
        _context_post_id: args.contextPostId || null,
        _idempotency_key: args.idempotencyKey || null,
      });
      if (error) throw error;
      return data as {
        conversation_id: string;
        status: string;
        message_id: string | null;
        is_new: boolean;
      };
    },
    onSuccess: invalidate,
  });

  const respondRequest = useMutation({
    mutationFn: async ({ conversationId, accept }: { conversationId: string; accept: boolean }) => {
      const { data, error } = await supabase.rpc('conversations_respond_request', {
        _conversation_id: conversationId,
        _accept: accept,
      });
      if (error) throw error;
      return data as { conversation_id: string; status: string };
    },
    onSuccess: (_data, vars) => {
      invalidate();
      qc.invalidateQueries({ queryKey: ['conversation-thread', vars.conversationId] });
    },
  });

  const blockUser = useMutation({
    mutationFn: async (blockedId: string) => {
      const { error } = await supabase.rpc('conversations_block_user', {
        _blocked_id: blockedId,
      });
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  return { openOrRequest, respondRequest, blockUser };
}
