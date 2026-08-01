// @ts-nocheck
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

interface Tower {
  id: string;
  name: string;
}

interface TowerSelectorProps {
  towers: Tower[];
  selectedTowerId: string | null;
  onSelect: (towerId: string | null) => void;
}

export function TowerSelector({ towers, selectedTowerId, onSelect }: TowerSelectorProps) {
  if (towers.length <= 1) return null;

  return (
    <Select
      value={selectedTowerId || 'all'}
      onValueChange={(v) => onSelect(v === 'all' ? null : v)}
    >
      <SelectTrigger className="w-[160px] h-8 text-xs">
        <SelectValue placeholder="All Towers" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="all">All Towers</SelectItem>
        {towers.map((t) => (
          <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
