// @ts-nocheck
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

export interface ConversationAttachment {
  id: string;
  storage_path: string;
  content_type: string;
  public_url?: string;
}

export interface ConversationMessage {
  id: string;
  conversation_id: string;
  sender_id: string;
  body: string;
  created_at: string;
  edited_at: string | null;
  deleted_at: string | null;
  attachments?: ConversationAttachment[];
}

function publicUrlForPath(path: string) {
  const { data } = supabase.storage.from('app-images').getPublicUrl(path);
  return data.publicUrl;
}

export function useConversationThread(conversationId: string | undefined) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const queryKey = useMemo(
    () => ['conversation-thread', conversationId] as const,
    [conversationId],
  );

  const metaQuery = useQuery({
    queryKey: ['conversation-meta', conversationId],
    enabled: !!conversationId && !!user,
    queryFn: async () => {
      const { data: conv, error } = await supabase
        .from('conversations')
        .select('id, status, context_post_id, created_by, last_message_preview, last_message_at')
        .eq('id', conversationId!)
        .single();
      if (error) throw error;

      const { data: members } = await supabase
        .from('conversation_members')
        .select('user_id, last_read_at')
        .eq('conversation_id', conversationId!);

      const otherId = (members || []).map((m) => m.user_id).find((id) => id !== user!.id) || null;
      let other: { id: string; name: string | null; block: string | null; flat_number: string | null } | null = null;
      if (otherId) {
        const { data: profile } = await supabase
          .from('profiles')
          .select('id, name, block, flat_number')
          .eq('id', otherId)
          .maybeSingle();
        other = profile;
      }

      let contextPost: { id: string; title: string | null; category: string | null } | null = null;
      if (conv.context_post_id) {
        const { data: post } = await supabase
          .from('bulletin_posts')
          .select('id, title, category')
          .eq('id', conv.context_post_id)
          .maybeSingle();
        contextPost = post;
      }

      return { conv, members: members || [], other, contextPost };
    },
  });

  const messagesQuery = useQuery({
    queryKey,
    enabled: !!conversationId && !!user,
    queryFn: async () => {
      const { data: rows, error } = await supabase
        .from('conversation_messages')
        .select('id, conversation_id, sender_id, body, created_at, edited_at, deleted_at')
        .eq('conversation_id', conversationId!)
        .order('created_at', { ascending: true })
        .limit(200);
      if (error) throw error;

      const ids = (rows || []).map((r) => r.id);
      let attachmentsByMessage: Record<string, ConversationAttachment[]> = {};
      if (ids.length > 0) {
        const { data: atts } = await supabase
          .from('conversation_message_attachments')
          .select('id, message_id, storage_path, content_type')
          .in('message_id', ids);
        for (const a of atts || []) {
          const list = attachmentsByMessage[a.message_id] || [];
          list.push({
            id: a.id,
            storage_path: a.storage_path,
            content_type: a.content_type,
            public_url: publicUrlForPath(a.storage_path),
          });
          attachmentsByMessage[a.message_id] = list;
        }
      }

      return (rows || []).map((r) => ({
        ...r,
        attachments: attachmentsByMessage[r.id] || [],
      })) as ConversationMessage[];
    },
  });

  useEffect(() => {
    if (!conversationId) return;
    const channel = supabase
      .channel(`conversation-${conversationId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'conversation_messages',
          filter: `conversation_id=eq.${conversationId}`,
        },
        () => {
          qc.invalidateQueries({ queryKey });
          qc.invalidateQueries({ queryKey: ['conversations-inbox', user?.id] });
          qc.invalidateQueries({ queryKey: ['conversations-unread', user?.id] });
        },
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          qc.invalidateQueries({ queryKey });
        }
      });
    return () => {
      supabase.removeChannel(channel);
    };
  }, [conversationId, qc, queryKey, user?.id]);

  useEffect(() => {
    if (!conversationId || !user) return;
    supabase.rpc('conversations_mark_read', { _conversation_id: conversationId }).then(() => {
      qc.invalidateQueries({ queryKey: ['conversations-unread', user.id] });
      qc.invalidateQueries({ queryKey: ['conversations-inbox', user.id] });
    });
  }, [conversationId, user?.id, messagesQuery.dataUpdatedAt, qc]);

  const sendMessage = useMutation({
    mutationFn: async (args: {
      body: string;
      files?: File[];
      idempotencyKey?: string;
    }) => {
      if (!conversationId || !user) throw new Error('Not ready');
      const paths: string[] = [];
      const types: string[] = [];
      const files = args.files || [];
      for (const file of files.slice(0, 4)) {
        if (!file.type.startsWith('image/')) {
          throw new Error('Only images are allowed');
        }
        const ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
        const path = `${user.id}/conversations/${conversationId}/${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`;
        const { error: upErr } = await supabase.storage.from('app-images').upload(path, file, {
          contentType: file.type,
          upsert: false,
        });
        if (upErr) throw upErr;
        paths.push(path);
        types.push(file.type || 'image/jpeg');
      }

      const { data, error } = await supabase.rpc('conversations_send_message', {
        _conversation_id: conversationId,
        _body: args.body || '',
        _idempotency_key: args.idempotencyKey || crypto.randomUUID(),
        _attachment_paths: paths.length ? paths : null,
        _attachment_types: types.length ? types : null,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey });
      qc.invalidateQueries({ queryKey: ['conversations-inbox', user?.id] });
      qc.invalidateQueries({ queryKey: ['conversation-meta', conversationId] });
    },
  });

  const editMessage = useMutation({
    mutationFn: async ({ messageId, body }: { messageId: string; body: string }) => {
      const { data, error } = await supabase.rpc('conversations_edit_message', {
        _message_id: messageId,
        _body: body,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey }),
  });

  const deleteMessage = useMutation({
    mutationFn: async (messageId: string) => {
      const { data, error } = await supabase.rpc('conversations_delete_message', {
        _message_id: messageId,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey }),
  });

  return {
    meta: metaQuery.data,
    metaLoading: metaQuery.isLoading,
    messages: messagesQuery.data || [],
    isLoading: messagesQuery.isLoading,
    sendMessage,
    editMessage,
    deleteMessage,
    refetch: () => {
      messagesQuery.refetch();
      metaQuery.refetch();
    },
  };
}

export function useConversationComposerFiles() {
  const [files, setFiles] = useState<File[]>([]);
  const addFiles = useCallback((incoming: FileList | File[] | null) => {
    if (!incoming) return;
    const list = Array.from(incoming).filter((f) => f.type.startsWith('image/'));
    setFiles((prev) => [...prev, ...list].slice(0, 4));
  }, []);
  const removeFile = useCallback((index: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  }, []);
  const clearFiles = useCallback(() => setFiles([]), []);
  return { files, addFiles, removeFile, clearFiles, setFiles };
}
