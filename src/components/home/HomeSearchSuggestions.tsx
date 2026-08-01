// @ts-nocheck
import { useNavigate } from 'react-router-dom';
import { useCommunitySearchSuggestions } from '@/hooks/queries/useCommunitySearchSuggestions';
import { TrendingUp, Sparkles } from 'lucide-react';
import { motion } from 'framer-motion';
import { useMarketplaceLabels } from '@/hooks/useMarketplaceLabels';

export function HomeSearchSuggestions() {
  const navigate = useNavigate();
  const { data: suggestions = [] } = useCommunitySearchSuggestions();
  const ml = useMarketplaceLabels();

  if (suggestions.length === 0) return null;

  return (
    <div className="px-4 mt-3">
      <div className="flex items-center gap-1.5 mb-2">
        <Sparkles size={12} className="text-primary" />
        <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
          {ml.label('label_section_search_popular')}
        </span>
      </div>
      <div className="flex gap-2 overflow-x-auto scrollbar-hide pb-1">
        {suggestions.slice(0, 8).map(({ term, count }, i) => (
          <motion.button
            key={term}
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: i * 0.05 }}
            onClick={() => navigate(`/search?q=${encodeURIComponent(term)}`)}
            className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-card border border-border hover:border-primary/30 hover:bg-primary/5 transition-all duration-200 shadow-sm"
          >
            <TrendingUp size={10} className="text-primary/70" />
            <span className="text-[11px] font-semibold text-foreground whitespace-nowrap">{term}</span>
            <span className="text-[9px] text-muted-foreground font-medium bg-muted px-1.5 py-0.5 rounded-md">{count}×</span>
          </motion.button>
        ))}
      </div>
    </div>
  );
}
