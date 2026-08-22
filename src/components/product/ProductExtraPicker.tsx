// @ts-nocheck
import { useMemo } from 'react';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { useBlockLibrary } from '@/hooks/useAttributeBlocks';
import {
  extractBuyerOptionGroups,
  type SelectedExtra,
} from '@/lib/productExtras';

interface ProductExtraPickerProps {
  specifications?: Record<string, any> | null;
  value: SelectedExtra[];
  onChange: (next: SelectedExtra[]) => void;
}

export function ProductExtraPicker({ specifications, value, onChange }: ProductExtraPickerProps) {
  const { data: library = [] } = useBlockLibrary();
  const groups = useMemo(
    () => extractBuyerOptionGroups(specifications, library),
    [specifications, library],
  );

  if (groups.length === 0) return null;

  const upsert = (extra: SelectedExtra) => {
    onChange([...value.filter((item) => item.id !== extra.id), extra]);
  };

  const toggleMulti = (group: (typeof groups)[number], option: string) => {
    const current = value.find((item) => item.id === group.id);
    const selected = Array.isArray(current?.value) ? [...current.value] : [];
    const next = selected.includes(option)
      ? selected.filter((item) => item !== option)
      : [...selected, option];
    upsert({
      id: group.id,
      blockType: group.blockType,
      blockLabel: group.blockLabel,
      fieldKey: group.fieldKey,
      fieldLabel: group.fieldLabel,
      value: next,
    });
  };

  return (
    <div className="space-y-3">
      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Extra details</p>
      {groups.map((group) => {
        const current = value.find((item) => item.id === group.id);
        return (
          <div key={group.id} className="space-y-1.5">
            <label className="text-sm font-medium">
              {group.fieldLabel}
              {group.required ? <span className="text-destructive ml-0.5">*</span> : null}
            </label>
            {group.input === 'boolean' ? (
              <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2">
                <span className="text-xs text-muted-foreground">Add this option</span>
                <Switch
                  checked={current?.value === true}
                  onCheckedChange={(checked) => upsert({
                    id: group.id,
                    blockType: group.blockType,
                    blockLabel: group.blockLabel,
                    fieldKey: group.fieldKey,
                    fieldLabel: group.fieldLabel,
                    value: checked,
                  })}
                />
              </div>
            ) : group.input === 'date' ? (
              <input
                type="date"
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={typeof current?.value === 'string' ? current.value : ''}
                onChange={(event) => upsert({
                  id: group.id,
                  blockType: group.blockType,
                  blockLabel: group.blockLabel,
                  fieldKey: group.fieldKey,
                  fieldLabel: group.fieldLabel,
                  value: event.target.value,
                })}
              />
            ) : group.input === 'text' ? (
              <Textarea
                rows={2}
                value={typeof current?.value === 'string' ? current.value : ''}
                placeholder={`Add ${group.fieldLabel.toLowerCase()}…`}
                onChange={(event) => upsert({
                  id: group.id,
                  blockType: group.blockType,
                  blockLabel: group.blockLabel,
                  fieldKey: group.fieldKey,
                  fieldLabel: group.fieldLabel,
                  value: event.target.value.slice(0, 300),
                })}
              />
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {group.options.map((option) => {
                  const selected = group.input === 'multi'
                    ? Array.isArray(current?.value) && current.value.includes(option)
                    : current?.value === option;
                  return (
                    <button
                      key={option}
                      type="button"
                      onClick={() => {
                        if (group.input === 'multi') {
                          toggleMulti(group, option);
                          return;
                        }
                        upsert({
                          id: group.id,
                          blockType: group.blockType,
                          blockLabel: group.blockLabel,
                          fieldKey: group.fieldKey,
                          fieldLabel: group.fieldLabel,
                          value: option,
                        });
                      }}
                      className={`rounded-full border px-3 py-1.5 text-[11px] font-medium transition-colors ${
                        selected
                          ? 'border-primary bg-primary/10 text-primary'
                          : 'border-border bg-card text-foreground hover:border-primary/40'
                      }`}
                    >
                      {option}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

export function useProductExtraGroups(specifications?: Record<string, any> | null) {
  const { data: library = [] } = useBlockLibrary();
  return useMemo(
    () => extractBuyerOptionGroups(specifications, library),
    [specifications, library],
  );
}
