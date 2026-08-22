import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Search, X } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import {
  formatAdminStoreOption,
  searchAdminStoreCredits,
  shortSellerId,
  type AdminStoreCreditRow,
} from '@/lib/adminStoreCredits';
import { useCurrency } from '@/hooks/useCurrency';

function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}

type AdminStoreSearchPickerProps = {
  value: string;
  onChange: (sellerId: string, row?: AdminStoreCreditRow) => void;
  placeholder?: string;
  helperText?: string;
  showBalance?: boolean;
  className?: string;
};

export function AdminStoreSearchPicker({
  value,
  onChange,
  placeholder = 'Search store by name, phone, or id',
  helperText,
  showBalance = true,
  className,
}: AdminStoreSearchPickerProps) {
  const { formatPrice } = useCurrency();
  const listId = useId();
  const containerRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [selectedLabel, setSelectedLabel] = useState('');
  const debouncedQuery = useDebouncedValue(query, 250);

  const searchEnabled = open && debouncedQuery.trim().length >= 1;

  const resultsQuery = useQuery({
    queryKey: ['admin-store-search-picker', debouncedQuery],
    queryFn: () => searchAdminStoreCredits(debouncedQuery),
    enabled: searchEnabled,
    staleTime: 30_000,
  });

  const selectedQuery = useQuery({
    queryKey: ['admin-store-search-selected', value],
    queryFn: async () => {
      const rows = await searchAdminStoreCredits(value);
      return rows.find((row) => row.seller_id === value) ?? rows[0] ?? null;
    },
    enabled: Boolean(value),
    staleTime: 60_000,
  });

  useEffect(() => {
    if (!value) {
      setSelectedLabel('');
      return;
    }
    if (selectedQuery.data) {
      setSelectedLabel(formatAdminStoreOption(selectedQuery.data));
    }
  }, [value, selectedQuery.data]);

  useEffect(() => {
    const onPointerDown = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, []);

  const results = useMemo(() => resultsQuery.data ?? [], [resultsQuery.data]);

  const pick = (row: AdminStoreCreditRow) => {
    onChange(row.seller_id, row);
    setSelectedLabel(formatAdminStoreOption(row));
    setQuery('');
    setOpen(false);
  };

  const clear = () => {
    onChange('');
    setQuery('');
    setSelectedLabel('');
    setOpen(false);
  };

  return (
    <div ref={containerRef} className={cn('space-y-1.5', className)}>
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          placeholder={placeholder}
          className="pl-9"
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
        />
        {open && searchEnabled && (
          <div
            id={listId}
            role="listbox"
            className="absolute z-50 mt-1 max-h-56 w-full overflow-y-auto rounded-md border bg-popover shadow-md"
          >
            {resultsQuery.isLoading && (
              <p className="px-3 py-2 text-xs text-muted-foreground">Searching stores…</p>
            )}
            {!resultsQuery.isLoading && results.length === 0 && (
              <p className="px-3 py-2 text-xs text-muted-foreground">No stores match that search.</p>
            )}
            {results.map((row) => (
              <button
                key={row.seller_id}
                type="button"
                role="option"
                aria-selected={row.seller_id === value}
                className="flex w-full flex-col items-start gap-0.5 border-b px-3 py-2 text-left text-sm last:border-b-0 hover:bg-muted/70"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pick(row)}
              >
                <span className="font-medium">{row.business_name}</span>
                <span className="text-[11px] text-muted-foreground">
                  {row.seller_phone ? `${row.seller_phone} · ` : ''}
                  {shortSellerId(row.seller_id)}
                  {showBalance ? ` · ${formatPrice(Number(row.available) || 0)} available` : ''}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
      {value && (
        <div className="flex items-center justify-between gap-2 rounded-md border bg-muted/30 px-2 py-1.5">
          <div className="min-w-0">
            <p className="truncate text-xs font-medium">{selectedLabel || 'Store selected'}</p>
            <p className="truncate text-[11px] text-muted-foreground">{value}</p>
          </div>
          <Button type="button" size="icon" variant="ghost" className="h-7 w-7 shrink-0" onClick={clear} aria-label="Clear selected store">
            <X className="h-4 w-4" />
          </Button>
        </div>
      )}
      {helperText && <p className="text-[11px] text-muted-foreground">{helperText}</p>}
    </div>
  );
}
