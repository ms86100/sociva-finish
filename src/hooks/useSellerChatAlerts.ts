// @ts-nocheck
/**
 * Seller-wide realtime listener for incoming chat messages.
 * - Plays the same gate-bell sound used for new orders
 * - Shows a toast with sender name + preview + Reply CTA that deep-links to the order chat
 * - Increments a global unread counter exposed via getter
 *
 * Mounted once at the app shell when the user is a seller.
 */
import { useEffect, useRef, useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { hapticNotification } from '@/lib/haptics';
import { isChatActive, onSilenceChatBell } from '@/lib/activeChatRegistry';

export function useSellerChatAlerts(sellerUserId: string | null | undefined, enabled: boolean) {
  const navigate = useNavigate();
  const [unreadCount, setUnreadCount] = useState(0);

  // Lazy-loaded audio (reuse the same gate_bell.mp3 used by useNewOrderAlert)
  const audioCtxRef = useRef<AudioContext | null>(null);
  const audioBufRef = useRef<AudioBuffer | null>(null);
  // Per-order last-played timestamps so back-to-back messages don't machine-gun the bell.
  const lastPlayedPerOrderRef = useRef<Map<string, number>>(new Map());
  // Track in-flight bell sources per order so silenceChatBell() can stop them.
  const activeSourcesRef = useRef<Map<string, AudioBufferSourceNode>>(new Map());

  const ensureAudio = useCallback(async () => {
    if (audioBufRef.current) return true;
    try {
      const ctx = audioCtxRef.current || new (window.AudioContext || (window as any).webkitAudioContext)();
      audioCtxRef.current = ctx;
      const res = await fetch('/sounds/gate_bell.mp3');
      const arr = await res.arrayBuffer();
      audioBufRef.current = await ctx.decodeAudioData(arr);
      return true;
    } catch {
      return false;
    }
  }, []);

  const playBell = useCallback(async (orderId: string) => {
    // Per-order 4s throttle.
    const now = Date.now();
    const last = lastPlayedPerOrderRef.current.get(orderId) || 0;
    if (now - last < 4000) return;
    lastPlayedPerOrderRef.current.set(orderId, now);
    const ok = await ensureAudio();
    if (!ok) return;
    const ctx = audioCtxRef.current!;
    const buf = audioBufRef.current!;
    try {
      if (ctx.state === 'suspended') ctx.resume();
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.connect(ctx.destination);
      src.onended = () => {
        if (activeSourcesRef.current.get(orderId) === src) {
          activeSourcesRef.current.delete(orderId);
        }
      };
      activeSourcesRef.current.set(orderId, src);
      src.start(0);
    } catch {/* noop */}
  }, [ensureAudio]);

  // Listen for explicit silence requests (seller opened/replied in chat).
  useEffect(() => {
    return onSilenceChatBell((orderId) => {
      const src = activeSourcesRef.current.get(orderId);
      if (src) {
        try { src.stop(0); } catch {/* noop */}
        activeSourcesRef.current.delete(orderId);
      }
      // Dismiss any toast for this order's chat.
      toast.dismiss(`chat-${orderId}`);
    });
  }, []);

  // Initial unread count
  useEffect(() => {
    if (!enabled || !sellerUserId) return;
    let cancelled = false;
    (async () => {
      const { count } = await supabase
        .from('chat_messages')
        .select('id', { count: 'exact', head: true })
        .eq('receiver_id', sellerUserId)
        .eq('read_status', false);
      if (!cancelled && typeof count === 'number') setUnreadCount(count);
    })();
    return () => { cancelled = true; };
  }, [enabled, sellerUserId]);

  // Realtime: chat_messages where receiver = seller
  useEffect(() => {
    if (!enabled || !sellerUserId) return;

    const channel = supabase
      .channel(`seller-chat-alerts-${sellerUserId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'chat_messages',
          filter: `receiver_id=eq.${sellerUserId}`,
        },
        async (payload) => {
          const msg: any = payload.new;
          if (!msg) return;

          // If the seller is currently in this chat, count silently and skip bell + toast.
          const chatOpen = isChatActive(msg.order_id);
          if (chatOpen) {
            // Don't increment unread either — they'll see/auto-mark it inside the open chat.
            return;
          }

          setUnreadCount((c) => c + 1);
          playBell(msg.order_id);
          hapticNotification('success');

          // Resolve sender display name (best effort)
          let senderName = 'Customer';
          try {
            const { data } = await supabase
              .from('profiles')
              .select('name')
              .eq('id', msg.sender_id)
              .maybeSingle();
            if (data?.name) senderName = data.name;
          } catch {/* noop */}

          const preview = String(msg.message_text || '').slice(0, 80);
          toast(`💬 ${senderName}`, {
            id: `chat-${msg.order_id}`,
            description: preview || 'New message',
            duration: 7000,
            action: {
              label: 'Reply',
              onClick: () => navigate(`/orders/${msg.order_id}?chat=1`),
            },
          });
        },
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'chat_messages',
          filter: `receiver_id=eq.${sellerUserId}`,
        },
        (payload) => {
          const oldRow: any = payload.old;
          const newRow: any = payload.new;
          // If a previously unread message just got read, decrement.
          if (oldRow?.read_status === false && newRow?.read_status === true) {
            setUnreadCount((c) => Math.max(0, c - 1));
          }
        },
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [enabled, sellerUserId, playBell, navigate]);

  return { unreadCount };
}
