// @ts-nocheck
import { useEffect, useMemo, useState } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/integrations/supabase/client';
import { Loader2, X } from 'lucide-react';

export type AudienceMode = 'all' | 'society' | 'never_ordered' | 'pick';

export interface AudienceUser {
  id: string;
  name: string;
  phone: string | null;
  society_id: string | null;
  society_name: string | null;
  has_token: boolean;
  never_ordered: boolean;
}

interface Props {
  mode: AudienceMode;
  onModeChange: (mode: AudienceMode) => void;
  societyId: string;
  onSocietyChange: (id: string) => void;
  societies: { id: string; name: string }[];
  selectedIds: string[];
  onSelectedIdsChange: (ids: string[]) => void;
  excludeUserId?: string | null;
}

export function CampaignAudiencePicker({
  mode,
  onModeChange,
  societyId,
  onSocietyChange,
  societies,
  selectedIds,
  onSelectedIdsChange,
  excludeUserId,
}: Props) {
  const [search, setSearch] = useState('');
  const [onlyNeverOrdered, setOnlyNeverOrdered] = useState(false);
  const [tokenFilter, setTokenFilter] = useState<'all' | 'has' | 'none'>('has');
  const [rows, setRows] = useState<AudienceUser[]>([]);
  const [loading, setLoading] = useState(false);
  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);

  useEffect(() => {
    if (mode !== 'pick') return;
    const t = setTimeout(async () => {
      setLoading(true);
      const { data, error } = await supabase.rpc('admin_campaign_user_directory' as any, {
        _search: search.trim() || null,
        _society_id: societyId || null,
        _never_ordered: onlyNeverOrdered,
        _has_token: tokenFilter === 'all' ? null : tokenFilter === 'has',
        _limit: 100,
        _offset: 0,
      });
      if (!error && data) {
        setRows(
          (data as AudienceUser[]).filter((u) => !excludeUserId || u.id !== excludeUserId),
        );
      } else {
        setRows([]);
      }
      setLoading(false);
    }, 250);
    return () => clearTimeout(t);
  }, [mode, search, societyId, onlyNeverOrdered, tokenFilter, excludeUserId]);

  function toggle(id: string, hasToken: boolean) {
    if (!hasToken) return;
    if (selectedSet.has(id)) {
      onSelectedIdsChange(selectedIds.filter((x) => x !== id));
    } else {
      onSelectedIdsChange([...selectedIds, id]);
    }
  }

  function selectAllMatching() {
    const withToken = rows.filter((r) => r.has_token).map((r) => r.id);
    const merged = Array.from(new Set([...selectedIds, ...withToken]));
    onSelectedIdsChange(merged);
  }

  const modes: { id: AudienceMode; label: string; hint: string }[] = [
    { id: 'all', label: 'All with tokens', hint: 'Everyone who can receive push' },
    { id: 'society', label: 'One society', hint: 'Filter by society + tokens' },
    { id: 'never_ordered', label: 'Never ordered', hint: 'Has token, no non-cancelled orders' },
    { id: 'pick', label: 'Pick people', hint: 'Search and multi-select' },
  ];

  return (
    <div className="space-y-3">
      <Label className="text-xs font-semibold">Audience</Label>
      <div className="grid grid-cols-2 gap-2">
        {modes.map((m) => (
          <button
            key={m.id}
            type="button"
            onClick={() => onModeChange(m.id)}
            className={`rounded-xl border px-3 py-2 text-left transition-colors ${
              mode === m.id
                ? 'border-primary bg-primary/10'
                : 'border-border hover:bg-muted/40'
            }`}
          >
            <p className="text-xs font-bold">{m.label}</p>
            <p className="text-[10px] text-muted-foreground mt-0.5">{m.hint}</p>
          </button>
        ))}
      </div>

      {(mode === 'society' || mode === 'pick') && (
        <div className="space-y-1.5">
          <Label className="text-[10px] font-semibold text-muted-foreground">Society filter</Label>
          <Select value={societyId || '_all'} onValueChange={(v) => onSocietyChange(v === '_all' ? '' : v)}>
            <SelectTrigger className="rounded-xl text-xs">
              <SelectValue placeholder="All societies" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="_all">{mode === 'society' ? 'Select a society…' : 'All societies'}</SelectItem>
              {societies.map((s) => (
                <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {mode === 'pick' && (
        <div className="space-y-2 rounded-xl border border-border/50 p-3">
          <Input
            placeholder="Search name or phone…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="rounded-xl text-xs"
          />
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setTokenFilter('has')}
              className={`text-[10px] font-semibold px-2 py-1 rounded-lg border ${tokenFilter === 'has' ? 'bg-primary text-primary-foreground border-primary' : 'border-border'}`}
            >
              Has token
            </button>
            <button
              type="button"
              onClick={() => setTokenFilter('none')}
              className={`text-[10px] font-semibold px-2 py-1 rounded-lg border ${tokenFilter === 'none' ? 'bg-primary text-primary-foreground border-primary' : 'border-border'}`}
            >
              No token
            </button>
            <button
              type="button"
              onClick={() => setTokenFilter('all')}
              className={`text-[10px] font-semibold px-2 py-1 rounded-lg border ${tokenFilter === 'all' ? 'bg-primary text-primary-foreground border-primary' : 'border-border'}`}
            >
              Any
            </button>
            <button
              type="button"
              onClick={() => setOnlyNeverOrdered((v) => !v)}
              className={`text-[10px] font-semibold px-2 py-1 rounded-lg border ${onlyNeverOrdered ? 'bg-primary text-primary-foreground border-primary' : 'border-border'}`}
            >
              Never ordered
            </button>
          </div>

          <div className="flex items-center gap-2">
            <Button type="button" size="sm" variant="outline" className="rounded-lg text-[10px] h-7" onClick={selectAllMatching}>
              Select all matching
            </Button>
            <Button type="button" size="sm" variant="ghost" className="rounded-lg text-[10px] h-7" onClick={() => onSelectedIdsChange([])}>
              Clear
            </Button>
            <span className="text-[10px] text-muted-foreground ml-auto">
              {selectedIds.length} selected
            </span>
          </div>

          {selectedIds.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {selectedIds.slice(0, 12).map((id) => {
                const row = rows.find((r) => r.id === id);
                return (
                  <Badge key={id} variant="secondary" className="gap-1 rounded-md text-[10px] font-medium">
                    {row?.name || id.slice(0, 8)}
                    <button type="button" onClick={() => onSelectedIdsChange(selectedIds.filter((x) => x !== id))}>
                      <X size={10} />
                    </button>
                  </Badge>
                );
              })}
              {selectedIds.length > 12 && (
                <Badge variant="outline" className="rounded-md text-[10px]">+{selectedIds.length - 12} more</Badge>
              )}
            </div>
          )}

          <div className="max-h-52 overflow-y-auto rounded-xl border border-border/40 divide-y divide-border/30">
            {loading ? (
              <p className="p-3 text-xs text-muted-foreground flex items-center gap-2">
                <Loader2 size={12} className="animate-spin" /> Loading…
              </p>
            ) : rows.length === 0 ? (
              <p className="p-3 text-xs text-muted-foreground">No users match</p>
            ) : (
              rows.map((u) => {
                const checked = selectedSet.has(u.id);
                const disabled = !u.has_token;
                return (
                  <label
                    key={u.id}
                    className={`flex items-start gap-2 px-3 py-2 text-xs ${disabled ? 'opacity-50' : 'hover:bg-muted/40 cursor-pointer'}`}
                    title={disabled ? 'No push token - cannot receive this campaign' : undefined}
                  >
                    <Checkbox
                      checked={checked}
                      disabled={disabled}
                      onCheckedChange={() => toggle(u.id, u.has_token)}
                      className="mt-0.5"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="font-semibold block truncate">{u.name}</span>
                      <span className="text-[10px] text-muted-foreground block truncate">
                        {u.phone || 'No phone'}
                        {u.society_name ? ` · ${u.society_name}` : ''}
                      </span>
                    </span>
                    <span className="flex flex-col items-end gap-0.5 shrink-0">
                      {u.has_token ? (
                        <Badge className="text-[9px] h-4 rounded-md" variant="default">token</Badge>
                      ) : (
                        <Badge className="text-[9px] h-4 rounded-md" variant="outline">no token</Badge>
                      )}
                      {u.never_ordered && (
                        <Badge className="text-[9px] h-4 rounded-md" variant="secondary">never ordered</Badge>
                      )}
                    </span>
                  </label>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
