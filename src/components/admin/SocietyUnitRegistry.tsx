// @ts-nocheck
import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Building2, Plus, Layers } from 'lucide-react';
import { toast } from 'sonner';
import { friendlyError } from '@/lib/utils';

type Tower = {
  id: string;
  name: string;
  sort_order: number;
  unit_count: number;
};

type Unit = {
  id: string;
  tower_id: string;
  tower_name: string;
  floor: string | null;
  unit_number: string;
};

export function SocietyUnitRegistry({ societyId }: { societyId: string }) {
  const [towers, setTowers] = useState<Tower[]>([]);
  const [units, setUnits] = useState<Unit[]>([]);
  const [selectedTowerId, setSelectedTowerId] = useState<string | null>(null);
  const [towerName, setTowerName] = useState('');
  const [unitNumber, setUnitNumber] = useState('');
  const [unitFloor, setUnitFloor] = useState('');
  const [seedFloors, setSeedFloors] = useState('4');
  const [seedPerFloor, setSeedPerFloor] = useState('4');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    if (!societyId) return;
    setLoading(true);
    const [{ data: tData, error: tErr }, { data: uData, error: uErr }] = await Promise.all([
      supabase.rpc('list_society_towers', { _society_id: societyId }),
      supabase.rpc('list_society_units', { _society_id: societyId, _tower_id: null }),
    ]);
    if (tErr) toast.error(friendlyError(tErr.message));
    if (uErr) toast.error(friendlyError(uErr.message));
    const nextTowers = (tData as Tower[]) || [];
    setTowers(nextTowers);
    setUnits((uData as Unit[]) || []);
    if (!selectedTowerId && nextTowers[0]?.id) setSelectedTowerId(nextTowers[0].id);
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, [societyId]);

  const addTower = async () => {
    if (!towerName.trim()) return;
    setBusy(true);
    const { error } = await supabase.rpc('admin_upsert_society_tower', {
      _society_id: societyId,
      _name: towerName.trim(),
      _sort_order: towers.length + 1,
      _tower_id: null,
    });
    setBusy(false);
    if (error) {
      toast.error(friendlyError(error.message));
      return;
    }
    setTowerName('');
    toast.success('Tower saved');
    await load();
  };

  const addUnit = async () => {
    if (!selectedTowerId || !unitNumber.trim()) return;
    setBusy(true);
    const { error } = await supabase.rpc('admin_upsert_society_unit', {
      _society_id: societyId,
      _tower_id: selectedTowerId,
      _unit_number: unitNumber.trim(),
      _floor: unitFloor.trim() || null,
      _label: null,
      _unit_id: null,
    });
    setBusy(false);
    if (error) {
      toast.error(friendlyError(error.message));
      return;
    }
    setUnitNumber('');
    setUnitFloor('');
    toast.success('Unit saved');
    await load();
  };

  const seedUnits = async () => {
    if (!selectedTowerId) return;
    const floors = parseInt(seedFloors, 10);
    const per = parseInt(seedPerFloor, 10);
    if (!floors || !per) {
      toast.error('Enter floors and units per floor');
      return;
    }
    setBusy(true);
    const { data, error } = await supabase.rpc('admin_seed_tower_units', {
      _society_id: societyId,
      _tower_id: selectedTowerId,
      _floors: floors,
      _units_per_floor: per,
      _unit_prefix: '',
    });
    setBusy(false);
    if (error) {
      toast.error(friendlyError(error.message));
      return;
    }
    toast.success(`Seeded ${(data as any)?.created ?? 0} units`);
    await load();
  };

  const selectedUnits = units.filter((u) => u.tower_id === selectedTowerId);

  return (
    <Card className="border-0 shadow-[var(--shadow-card)] rounded-2xl">
      <CardContent className="p-4 space-y-4">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-xl bg-primary/10 flex items-center justify-center">
            <Building2 size={15} className="text-primary" />
          </div>
          <div>
            <h3 className="text-sm font-bold">Tower and unit registry</h3>
            <p className="text-[11px] text-muted-foreground">MyGate-style master list for resident join</p>
          </div>
        </div>

        {loading ? (
          <p className="text-xs text-muted-foreground py-6 text-center">Loading registry...</p>
        ) : (
          <>
            <div className="flex flex-wrap gap-2">
              {towers.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setSelectedTowerId(t.id)}
                  className={`rounded-xl px-3 py-2 text-xs font-semibold border transition-colors ${
                    selectedTowerId === t.id
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'border-border bg-background text-muted-foreground'
                  }`}
                >
                  {t.name}{' '}
                  <Badge variant="secondary" className="ml-1 text-[9px] rounded-md tabular-nums">
                    {t.unit_count}
                  </Badge>
                </button>
              ))}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-2">
              <div>
                <Label className="text-xs">Add tower</Label>
                <Input
                  value={towerName}
                  onChange={(e) => setTowerName(e.target.value)}
                  placeholder="e.g. Tower H"
                  className="mt-1 rounded-xl h-10"
                />
              </div>
              <Button className="sm:mt-5 rounded-xl h-10" disabled={busy || !towerName.trim()} onClick={addTower}>
                <Plus size={14} className="mr-1" /> Add
              </Button>
            </div>

            {selectedTowerId && (
              <div className="space-y-3 rounded-xl border border-border/70 p-3">
                <div className="flex items-center gap-2 text-xs font-semibold text-foreground">
                  <Layers size={14} /> Units in selected tower
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <Label className="text-xs">Unit no.</Label>
                    <Input value={unitNumber} onChange={(e) => setUnitNumber(e.target.value)} placeholder="1204" className="mt-1 rounded-xl h-10" />
                  </div>
                  <div>
                    <Label className="text-xs">Floor</Label>
                    <Input value={unitFloor} onChange={(e) => setUnitFloor(e.target.value)} placeholder="12" className="mt-1 rounded-xl h-10" />
                  </div>
                </div>
                <Button size="sm" className="rounded-xl" disabled={busy || !unitNumber.trim()} onClick={addUnit}>
                  <Plus size={14} className="mr-1" /> Add unit
                </Button>

                <div className="grid grid-cols-3 gap-2 pt-1">
                  <div>
                    <Label className="text-xs">Seed floors</Label>
                    <Input value={seedFloors} onChange={(e) => setSeedFloors(e.target.value)} className="mt-1 rounded-xl h-9" />
                  </div>
                  <div>
                    <Label className="text-xs">Per floor</Label>
                    <Input value={seedPerFloor} onChange={(e) => setSeedPerFloor(e.target.value)} className="mt-1 rounded-xl h-9" />
                  </div>
                  <Button size="sm" variant="outline" className="rounded-xl mt-5 h-9" disabled={busy} onClick={seedUnits}>
                    Bulk seed
                  </Button>
                </div>

                <div className="max-h-40 overflow-y-auto space-y-1">
                  {selectedUnits.length === 0 ? (
                    <p className="text-[11px] text-muted-foreground py-3 text-center">No units yet - add one or bulk seed</p>
                  ) : (
                    selectedUnits.map((u) => (
                      <div key={u.id} className="flex items-center justify-between rounded-lg bg-muted/40 px-2.5 py-1.5 text-xs">
                        <span className="font-medium">{u.unit_number}</span>
                        <span className="text-muted-foreground">{u.floor ? `Floor ${u.floor}` : 'Floor -'}</span>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
