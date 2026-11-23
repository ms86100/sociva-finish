import { Building2, CheckCircle2, Search } from 'lucide-react';
import { Input } from '@/components/ui/input';
import type { ApprovedSociety } from '@/lib/approved-societies';

type Props = {
  societies: ApprovedSociety[];
  query: string;
  onQueryChange: (value: string) => void;
  selectedId?: string | null;
  onSelect: (society: ApprovedSociety) => void;
  loading?: boolean;
};

export function ApprovedSocietyPicker({
  societies,
  query,
  onQueryChange,
  selectedId,
  onSelect,
  loading,
}: Props) {
  return (
    <div className="space-y-3">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={16} />
        <Input
          placeholder="Search approved societies by name, city, or pincode"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          className="pl-9 h-12 rounded-xl"
        />
      </div>
      {loading ? (
        <p className="text-xs text-muted-foreground text-center py-4">Loading approved societies...</p>
      ) : societies.length > 0 ? (
        <div className="max-h-56 overflow-y-auto space-y-1.5">
          {societies.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => onSelect(s)}
              className={`w-full text-left p-3 rounded-xl border-2 transition-all ${
                selectedId === s.id ? 'border-primary bg-primary/5 shadow-sm' : 'border-border hover:border-primary/30'
              }`}
            >
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
                  <Building2 size={18} className="text-primary" />
                </div>
                <div className="min-w-0">
                  <p className="font-medium text-sm truncate">{s.name}</p>
                  <p className="text-xs text-muted-foreground truncate">
                    {[s.city, s.state, s.pincode].filter(Boolean).join(', ') || s.address || 'Approved society'}
                  </p>
                </div>
                {selectedId === s.id && <CheckCircle2 size={18} className="text-primary shrink-0 ml-auto" />}
              </div>
            </button>
          ))}
        </div>
      ) : query.trim().length >= 2 ? (
        <p className="text-center text-sm text-muted-foreground py-4">
          No approved society matches "{query}". Request it for admin review.
        </p>
      ) : (
        <p className="text-center text-xs text-muted-foreground py-3">
          Sociva societies are added by admin. Search the approved list, then request to join.
        </p>
      )}
    </div>
  );
}
