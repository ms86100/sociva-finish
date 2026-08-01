// @ts-nocheck
import { useCommunitySearchSuggestions } from '@/hooks/queries/useCommunitySearchSuggestions';
import { TrendingUp } from 'lucide-react';

interface CommunitySuggestionsProps {
  onSuggestionTap: (term: string) => void;
}

export function CommunitySuggestions({ onSuggestionTap }: CommunitySuggestionsProps) {
  const { data: suggestions = [], isLoading } = useCommunitySearchSuggestions();

  if (isLoading || suggestions.length === 0) return null;

  return (
    <div className="mb-4">
      <p className="text-xs font-semibold text-muted-foreground mb-2 flex items-center gap-1.5">
        <TrendingUp size={12} />
        People in your society also searched for
      </p>
      <div className="flex flex-wrap gap-2">
        {suggestions.map((s) => (
          <button
            key={s.term}
            onClick={() => onSuggestionTap(s.term)}
            className="px-3 py-1.5 rounded-full bg-muted text-xs font-medium text-foreground hover:bg-muted/80 transition-colors"
          >
            {s.term}
          </button>
        ))}
      </div>
    </div>
  );
}
