// @ts-nocheck
import { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { ChatMessage } from '@/types/database';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { ReportSheet } from '@/components/report/ReportSheet';
import { Send, MessageCircle, X, Check, CheckCheck, Flag } from 'lucide-react';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';
import { Json } from '@/integrations/supabase/types';
import { useChatViewport } from '@/hooks/useChatViewport';
import { setActiveChat, clearActiveChat, silenceChatBell } from '@/lib/activeChatRegistry';

interface OrderChatProps {
  orderId: string;
  otherUserId: string;
  otherUserName: string;
  isOpen: boolean;
  onClose: () => void;
  disabled?: boolean;
}

export function OrderChat({
  orderId,
  otherUserId,
  otherUserName,
  isOpen,
  onClose,
  disabled = false,
}: OrderChatProps) {
  const { user } = useAuth();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const [isSending, setIsSending] = useState(false);
  const lastSentRef = useRef<number>(0);
  const [reportOpen, setReportOpen] = useState(false);
  const { viewportHeight, viewportTop, keyboardInset } = useChatViewport(isOpen);
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (isOpen && orderId) {
      document.body.style.overflow = 'hidden';
      // Silence the seller bell + register this chat as active.
      setActiveChat(orderId);
      silenceChatBell(orderId);

      // Subscribe FIRST to avoid race where INSERT lands between fetch and subscribe.
      const channel = supabase
        .channel(`chat-${orderId}`)
        .on(
          'postgres_changes',
          {
            event: 'INSERT',
            schema: 'public',
            table: 'chat_messages',
            filter: `order_id=eq.${orderId}`,
          },
          (payload) => {
            const newMsg = payload.new as ChatMessage;
            setMessages((prev) => {
              // De-dup: ignore if already present (optimistic or fetched).
              if (prev.some((m) => m.id === newMsg.id)) return prev;
              // Replace optimistic placeholder with same text from same sender if present.
              const optimisticIdx = prev.findIndex(
                (m) => (m as any)._optimistic && m.sender_id === newMsg.sender_id && m.message_text === newMsg.message_text,
              );
              if (optimisticIdx !== -1) {
                const next = [...prev];
                next[optimisticIdx] = newMsg;
                return next;
              }
              return [...prev, newMsg];
            });
            if (newMsg.receiver_id === user?.id) {
              markMessagesAsRead();
            }
          },
        )
        .on(
          'postgres_changes',
          {
            event: 'UPDATE',
            schema: 'public',
            table: 'chat_messages',
            filter: `order_id=eq.${orderId}`,
          },
          (payload) => {
            const upd = payload.new as ChatMessage;
            setMessages((prev) => prev.map((m) => (m.id === upd.id ? { ...m, ...upd } : m)));
          },
        )
        .subscribe((status) => {
          if (status === 'SUBSCRIBED') {
            // Now safe to fetch — any INSERT after this moment will be delivered.
            fetchMessages();
            markMessagesAsRead();
          }
        });

      return () => {
        document.body.style.overflow = '';
        clearActiveChat(orderId);
        supabase.removeChannel(channel);
      };
    } else {
      document.body.style.overflow = '';
    }
  }, [isOpen, orderId]);

  const scrollToBottom = useCallback(() => {
    requestAnimationFrame(() => {
      if (scrollRef.current) {
        scrollRef.current.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
      }
    });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  const fetchMessages = async () => {
    const { data, error } = await supabase
      .from('chat_messages')
      .select('id, order_id, sender_id, receiver_id, message_text, created_at, read_at, read_status')
      .eq('order_id', orderId)
      .order('created_at', { ascending: true });

    if (!error && data) {
      setMessages(data);
    }
  };

  const markMessagesAsRead = async () => {
    if (!user) return;
    const now = new Date().toISOString();
    await supabase
      .from('chat_messages')
      .update({ read_status: true, read_at: now } as any)
      .eq('order_id', orderId)
      .eq('receiver_id', user.id)
      .eq('read_status', false);
  };

  const sendMessage = async () => {
    if (!newMessage.trim() || !user || isSending || disabled) return;
    const now = Date.now();
    if (now - lastSentRef.current < 1500) return; // 1.5s throttle
    lastSentRef.current = now;
    // Refresh active marker + immediately silence any pending bell for this chat.
    setActiveChat(orderId);
    silenceChatBell(orderId);

    const trimmed = newMessage.trim();
    // Optimistic placeholder so it shows immediately, no waiting for echo.
    const tempId = `tmp-${now}-${Math.random().toString(36).slice(2, 8)}`;
    const optimisticMsg: ChatMessage = {
      id: tempId,
      order_id: orderId,
      sender_id: user.id,
      receiver_id: otherUserId,
      message_text: trimmed,
      created_at: new Date().toISOString(),
      read_status: false,
      read_at: null,
      _optimistic: true,
    } as any;
    setMessages((prev) => [...prev, optimisticMsg]);
    setNewMessage('');
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }

    setIsSending(true);
    try {
      const { data: inserted, error } = await supabase
        .from('chat_messages')
        .insert({
          order_id: orderId,
          sender_id: user.id,
          receiver_id: otherUserId,
          message_text: trimmed,
        })
        .select('id, order_id, sender_id, receiver_id, message_text, created_at, read_at, read_status')
        .single();

      if (error) throw error;

      // Replace the optimistic placeholder with the real row immediately.
      if (inserted) {
        setMessages((prev) => {
          // If realtime echo already replaced it, do nothing.
          if (prev.some((m) => m.id === inserted.id)) {
            return prev.filter((m) => m.id !== tempId);
          }
          return prev.map((m) => (m.id === tempId ? (inserted as ChatMessage) : m));
        });
      }

      // Fallback safety net: if realtime hasn't reconciled in 5s, refetch.
      setTimeout(() => {
        setMessages((prev) => {
          if (prev.some((m) => (m as any)._optimistic)) {
            fetchMessages();
          }
          return prev;
        });
      }, 5000);

      // Enqueue a chat notification for the recipient, then process
      const { data: senderProfile } = await supabase
        .from('profiles')
        .select('name')
        .eq('id', user.id)
        .maybeSingle();
      const senderName = senderProfile?.name || user.user_metadata?.name || 'Someone';
      const preview = trimmed.length > 80 ? trimmed.slice(0, 77) + '...' : trimmed;
      await supabase.from('notification_queue').insert({
        user_id: otherUserId,
        title: `💬 New message from ${senderName}`,
        body: preview,
        type: 'chat',
        reference_path: `/orders/${orderId}?chat=1`,
        payload: { orderId, type: 'chat', senderId: user.id } as unknown as Json,
      });

      supabase.functions.invoke('process-notification-queue').catch(() => {});
    } catch (error) {
      console.error('Error sending message:', error);
      // Remove the optimistic message on failure and restore input.
      setMessages((prev) => prev.filter((m) => m.id !== tempId));
      setNewMessage(trimmed);
    } finally {
      setIsSending(false);
    }
  };

  // Auto-resize textarea
  const handleTextChange = (value: string) => {
    setNewMessage(value);
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 120)}px`;
    }
  };

  if (!isOpen) return null;

  const containerStyle: React.CSSProperties = {
    height: `${Math.max(viewportHeight, 320)}px`,
    top: viewportTop,
    paddingTop: 'env(safe-area-inset-top, 0px)',
    paddingBottom: keyboardInset ? `${keyboardInset}px` : undefined,
    pointerEvents: 'auto' as const,
  };

  return (
    <>
      {createPortal(
        <div className="fixed inset-x-0 z-[60] bg-background flex flex-col overflow-hidden" style={containerStyle}>
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b bg-card shrink-0">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                <MessageCircle className="text-primary" size={20} />
              </div>
              <div className="min-w-0">
                <p className="font-semibold truncate">{otherUserName}</p>
                <p className="text-xs text-muted-foreground">Order #{orderId.slice(0, 8)}</p>
              </div>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <Button variant="ghost" size="icon" onClick={() => setReportOpen(true)} className="text-muted-foreground" aria-label="Report user">
                <Flag size={16} />
              </Button>
              <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close chat">
                <X size={20} />
              </Button>
            </div>
          </div>

          {/* Messages */}
          <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto p-4 overscroll-contain">
            {messages.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <MessageCircle className="mx-auto mb-2" size={32} />
                <p className="text-sm">No messages yet</p>
                <p className="text-xs">Start a conversation about this order</p>
              </div>
            ) : (
              <div className="space-y-3">
                {messages.map((msg) => {
                  const isMine = msg.sender_id === user?.id;
                  return (
                    <div key={msg.id} className={cn('flex', isMine ? 'justify-end' : 'justify-start')}>
                      <div
                        className={cn(
                          'max-w-[80%] rounded-2xl px-4 py-2',
                          isMine ? 'bg-primary text-primary-foreground rounded-br-sm' : 'bg-muted rounded-bl-sm',
                        )}
                      >
                        <p className="text-sm">{msg.message_text}</p>
                        <div className={cn('flex items-center gap-1 mt-1', isMine ? 'justify-end' : 'justify-start')}>
                          <span className={cn('text-[10px]', isMine ? 'text-primary-foreground/70' : 'text-muted-foreground')}>
                            {format(new Date(msg.created_at), 'h:mm a')}
                          </span>
                          {isMine &&
                            ((msg as any).read_at ? (
                              <CheckCheck size={12} className="text-blue-400" />
                            ) : msg.read_status ? (
                              <CheckCheck size={12} className="text-primary-foreground/70" />
                            ) : (
                              <Check size={12} className="text-primary-foreground/70" />
                            ))}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Input — pinned above keyboard */}
          <div className="sticky bottom-0 px-3 pt-3 border-t bg-card shrink-0 pb-[calc(0.75rem+env(safe-area-inset-bottom,0px))] z-10">
            {disabled ? (
              <p className="text-center text-sm text-muted-foreground">Chat is disabled for completed orders</p>
            ) : (
              <div className="flex items-end gap-2">
                <Textarea
                  ref={textareaRef}
                  placeholder="Type a message..."
                  value={newMessage}
                  onChange={(e) => handleTextChange(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      sendMessage();
                    }
                  }}
                  onFocus={() => {
                    setTimeout(scrollToBottom, 200);
                  }}
                  rows={1}
                  className="flex-1 min-h-[40px] max-h-[120px] resize-none rounded-xl text-base md:text-sm py-2.5"
                  maxLength={1000}
                />
                <Button size="icon" className="shrink-0 h-10 w-10 rounded-xl" onClick={sendMessage} disabled={!newMessage.trim() || isSending} aria-label="Send message">
                  <Send size={16} />
                </Button>
              </div>
            )}
          </div>
        </div>,
        document.body,
      )}
      <ReportSheet open={reportOpen} onOpenChange={setReportOpen} targetType="user" targetId={otherUserId} targetName={otherUserName} />
    </>
  );
}
