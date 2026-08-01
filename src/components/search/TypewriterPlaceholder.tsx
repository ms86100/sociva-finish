// @ts-nocheck
import { memo, useMemo } from 'react';
import { useTypewriterPlaceholder } from '@/hooks/useTypewriterPlaceholder';
import { useCategoryConfig } from '@/hooks/queries/useCategoryConfig';
import { SearchContext } from '@/hooks/useSearchPlaceholder';

const CONTEXT_WORDS: Record<string, string[]> = {
  society: ['visitors', 'parking', 'finances', 'snags', 'disputes', 'workers', 'notices'],
  visitors: ['guest name', 'flat number', 'OTP code'],
  finances: ['expense', 'income', 'budget', 'receipt'],
  construction: ['milestone', 'tower', 'progress', 'document'],
  disputes: ['complaint', 'ticket', 'resolution'],
  workforce: ['maid', 'driver', 'plumber', 'electrician'],
  parking: ['vehicle number', 'slot', 'sticker'],
  bulletin: ['announcement', 'discussion', 'event', 'poll'],
  deliveries: ['order', 'rider', 'tracking'],
  maintenance: ['dues', 'payment', 'receipt'],
};

/**
 * Fix #10: Isolated typewriter component — only THIS component re-renders
 * on each tick (every 40-80ms), not the parent Header or page tree.
 * Fix #13: Derives display names from shared ['category-configs'] cache.
 */
function TypewriterPlaceholderInner({ context = 'home' }: { context?: SearchContext }) {
  // Fix #13: Reuse the shared category-configs cache instead of a separate query
  const { data: configs = [] } = useCategoryConfig();
  const categoryNames = useMemo(
    () => configs.map((c: any) => c.displayName || c.display_name),
    [configs],
  );

  const words = ['home', 'marketplace', 'search'].includes(context)
    ? (categoryNames.length > 0 ? categoryNames : ['products'])
    : (CONTEXT_WORDS[context] || ['items']);

  const placeholder = useTypewriterPlaceholder(words, { prefix: 'Search "', suffix: '"' });

  return <span className="text-sm text-muted-foreground flex-1 transition-opacity duration-300 truncate">{placeholder}</span>;
}

export const TypewriterPlaceholder = memo(TypewriterPlaceholderInner);
