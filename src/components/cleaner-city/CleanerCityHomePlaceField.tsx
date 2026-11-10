// @ts-nocheck
import { useEffect, useId, useRef, useState } from 'react';
import { Loader2, MapPin } from 'lucide-react';
import { useAutocomplete } from '@/hooks/useGoogleMaps';
import { cn } from '@/lib/utils';

type Props = {
  label: string;
  value: string;
  onChange: (value: string) => void;
  icon?: 'dot' | 'pin';
  placeholder?: string;
  className?: string;
};

/**
 * Compact Google Places autocomplete for Home Find pickup / drop-off.
 */
export function CleanerCityHomePlaceField({
  label,
  value,
  onChange,
  icon = 'pin',
  placeholder = 'Search place or address',
  className,
}: Props) {
  const listId = useId();
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);
  const { predictions, isSearching, searchPlaces, getPlaceDetails, clearPredictions, isLoaded } =
    useAutocomplete();

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) {
        setOpen(false);
        clearPredictions();
      }
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [clearPredictions]);

  const pick = async (placeId: string, description: string) => {
    const details = await getPlaceDetails(placeId);
    clearPredictions();
    setOpen(false);
    onChange(details?.name || details?.formattedAddress || description);
  };

  return (
    <div ref={wrapRef} className={cn('relative space-y-1', className)}>
      <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <div className="flex min-w-0 items-center gap-1.5 rounded-xl border border-border bg-background px-2.5 py-2.5">
        {icon === 'dot' ? (
          <span className="h-2 w-2 shrink-0 rounded-full bg-emerald-600" />
        ) : (
          <MapPin className="h-3.5 w-3.5 shrink-0 text-emerald-800" />
        )}
        <input
          value={value}
          placeholder={placeholder}
          autoComplete="off"
          role="combobox"
          aria-expanded={open && predictions.length > 0}
          aria-controls={listId}
          className="min-w-0 flex-1 bg-transparent text-sm font-medium outline-none"
          onChange={(e) => {
            const next = e.target.value;
            onChange(next);
            setOpen(true);
            if (isLoaded) void searchPlaces(next);
            else clearPredictions();
          }}
          onFocus={() => {
            setOpen(true);
            if (isLoaded && value.trim().length >= 3) void searchPlaces(value);
          }}
        />
        {isSearching ? (
          <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-muted-foreground" />
        ) : null}
      </div>

      {open && predictions.length > 0 ? (
        <div
          id={listId}
          role="listbox"
          className="absolute left-0 right-0 top-full z-30 mt-1 max-h-52 overflow-auto rounded-xl border border-border bg-card shadow-lg"
          data-testid="cleaner-city-home-place-dropdown"
        >
          {predictions.slice(0, 6).map((p) => (
            <button
              key={p.placeId}
              type="button"
              role="option"
              className="w-full border-b border-border/60 px-3 py-2.5 text-left last:border-b-0 hover:bg-muted"
              onClick={() => void pick(p.placeId, p.description)}
            >
              <p className="text-sm font-semibold text-foreground">{p.mainText || p.description}</p>
              {p.secondaryText ? (
                <p className="text-[11px] text-muted-foreground">{p.secondaryText}</p>
              ) : null}
            </button>
          ))}
        </div>
      ) : null}

      {!isLoaded ? (
        <p className="text-[10px] text-muted-foreground">Maps loading for address suggestions…</p>
      ) : null}
    </div>
  );
}
