// @ts-nocheck
import { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { useSellerChat } from '@/hooks/useSellerChat';
import { useChatViewport } from '@/hooks/useChatViewport';
import { Send, MessageCircle, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { ChatProductHeader } from './ChatProductHeader';
import { QuickReplyChips } from '@/components/seller/QuickReplyChips';

interface SellerChatSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  buyerId: string;
  sellerId: string;
  productId: string;
  productName: string;
  sellerName: string;
}

export function SellerChatSheet({ open, onOpenChange, buyerId, sellerId, productId, productName, sellerName }: SellerChatSheetProps) {
  const { messages, isLoading, getOrCreate, sendMessage, isSending } = useSellerChat(buyerId, sellerId, productId);
  const { viewportHeight, viewportTop, keyboardInset } = useChatViewport(open);
  const [text, setText] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (open) {
      getOrCreate();
      document.body.style.overflow = 'hidden';
    }
    return () => { document.body.style.overflow = ''; };
  }, [open, getOrCreate]);

  // Auto-scroll to bottom on new messages
  const scrollToBottom = useCallback(() => {
    requestAnimationFrame(() => {
      scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
    });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  // Auto-resize textarea
  const handleTextChange = (value: string) => {
    setText(value);
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 120)}px`;
    }
  };

  const handleSend = async () => {
    const trimmed = text.trim();
    if (!trimmed || isSending) return;

    try {
      await sendMessage({ text: trimmed, senderId: buyerId });
      setText('');
      if (textareaRef.current) {
        textareaRef.current.style.height = 'auto';
      }
    } catch (error) {
      console.error('Failed to send seller chat message:', error);
      toast.error('Could not send message. Please try again.');
    }
  };

  if (!open) return null;

  const containerStyle: React.CSSProperties = {
    height: `${Math.max(viewportHeight, 320)}px`,
    top: viewportTop,
    paddingTop: 'env(safe-area-inset-top, 0px)',
    paddingBottom: keyboardInset ? `${keyboardInset}px` : undefined,
    pointerEvents: 'auto' as const,
  };

  return createPortal(
    <div
      className="fixed inset-x-0 z-[60] bg-background flex flex-col overflow-hidden"
      style={containerStyle}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b bg-card shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
            <MessageCircle className="text-primary" size={20} />
          </div>
          <div className="min-w-0">
            <p className="font-semibold truncate text-sm">{sellerName}</p>
            <p className="text-xs text-muted-foreground truncate">Re: {productName}</p>
          </div>
        </div>
        <Button variant="ghost" size="icon" onClick={() => onOpenChange(false)} className="shrink-0" aria-label="Close chat">
          <X size={20} />
        </Button>
      </div>

      {/* Product context card */}
      <ChatProductHeader productId={productId} sellerName={sellerName} />

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto px-4 py-2 space-y-2 overscroll-contain">
        {isLoading && <p className="text-xs text-muted-foreground text-center py-8">Loading messages…</p>}
        {!isLoading && messages.length === 0 && (
          <div className="text-center py-8 text-muted-foreground">
            <MessageCircle className="mx-auto mb-2" size={32} />
            <p className="text-sm">No messages yet</p>
            <p className="text-xs">Say hello to {sellerName}!</p>
          </div>
        )}
        {messages.map((m) => {
          const isMine = m.sender_id === buyerId;
          return (
            <div key={m.id} className={cn('flex', isMine ? 'justify-end' : 'justify-start')}>
              <div
                className={cn(
                  'max-w-[75%] px-3 py-2 rounded-2xl text-sm',
                  isMine ? 'bg-primary text-primary-foreground rounded-br-md' : 'bg-muted text-foreground rounded-bl-md',
                )}
              >
                {m.message_text}
              </div>
            </div>
          );
        })}
      </div>

      {/* Quick Reply Chips */}
      <QuickReplyChips sellerId={sellerId} onSelect={(msg) => handleTextChange(msg)} />

      {/* Input bar — pinned above keyboard */}
      <div className="sticky bottom-0 shrink-0 border-t border-border px-3 pt-3 flex items-end gap-2 bg-card pb-[calc(0.75rem+env(safe-area-inset-bottom,0px))] z-10">
        <Textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => handleTextChange(e.target.value)}
          placeholder="Type a message…"
          rows={1}
          className="flex-1 min-h-[40px] max-h-[120px] resize-none rounded-xl text-base md:text-sm py-2.5"
          onFocus={() => {
            setTimeout(scrollToBottom, 200);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void handleSend();
            }
          }}
        />
        <Button
          size="icon"
          className="shrink-0 h-10 w-10 rounded-xl"
          onClick={() => void handleSend()}
          disabled={!text.trim() || isSending}
          aria-label="Send message"
        >
          <Send size={16} />
        </Button>
      </div>
    </div>,
    document.body,
  );
}
