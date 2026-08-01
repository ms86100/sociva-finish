// @ts-nocheck
import { useState } from 'react';
import { Input } from '@/components/ui/input';
import { Search, X } from 'lucide-react';
import { useSearchPlaceholder, type SearchContext } from '@/hooks/useSearchPlaceholder';

interface ModuleSearchBarProps {
  context: SearchContext;
  value: string;
  onChange: (value: string) => void;
  className?: string;
}

/**
 * Reusable context-aware search bar with typewriter placeholder.
 * Drop into any society module page for consistent search UX.
 */
export function ModuleSearchBar({ context, value, onChange, className }: ModuleSearchBarProps) {
  const placeholder = useSearchPlaceholder(context);

  return (
    <div className={className}>
      <div className="relative">
        <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder={placeholder}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="pl-8 pr-8 h-9 bg-muted border-0 rounded-xl text-xs"
        />
        {value && (
          <button
            onClick={() => onChange('')}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"
          >
            <X size={12} />
          </button>
        )}
      </div>
    </div>
  );
}
