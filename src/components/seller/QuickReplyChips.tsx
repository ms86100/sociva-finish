// @ts-nocheck
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { cn } from '@/lib/utils';
import { Zap } from 'lucide-react';

interface QuickReplyChipsProps {
  sellerId: string;
  onSelect: (text: string) => void;
}

export function QuickReplyChips({ sellerId, onSelect }: QuickReplyChipsProps) {
  const { data: replies = [] } = useQuery({
    queryKey: ['quick-replies', sellerId],
    enabled: !!sellerId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('seller_quick_replies')
        .select('id, label, message_text, sort_order')
        .eq('seller_id', sellerId)
        .order('sort_order', { ascending: true });
      if (error) throw error;
      return data || [];
    },
    staleTime: 10 * 60_000,
  });

  if (replies.length === 0) return null;

  return (
    <div className="flex gap-1.5 overflow-x-auto px-3 py-2 scrollbar-none border-b border-border bg-card/50">
      <Zap size={14} className="text-muted-foreground shrink-0 mt-0.5" />
      {replies.map((r) => (
        <button
          key={r.id}
          type="button"
          onClick={() => onSelect(r.message_text)}
          className={cn(
            'shrink-0 px-2.5 py-1 rounded-full text-[11px] font-medium',
            'bg-muted text-muted-foreground hover:bg-primary/10 hover:text-primary',
            'transition-colors whitespace-nowrap'
          )}
        >
          {r.label}
        </button>
      ))}
    </div>
  );
}
