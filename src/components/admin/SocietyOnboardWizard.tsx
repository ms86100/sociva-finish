import { useEffect, useMemo, useState } from 'react';
import { Building2, Check, Layers, Package, Shield, Sparkles, UserPlus, Users } from 'lucide-react';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { supabase } from '@/integrations/supabase/client';
import { adminNotify } from '@/lib/admin-notify';
import { logAudit } from '@/lib/audit';
import { useAuth } from '@/contexts/AuthContext';
import {
  appointSocietyAdmin,
  assignPackageToSociety,
  createBuilderRecord,
  createSocietyRecord,
  listPackageFeatures,
  loadSocietyOnboardSnapshot,
  searchResidentsForAppoint,
  verifyAndActivateSociety,
  type PackageFeatureChip,
  type SocietyOnboardSnapshot,
} from '@/lib/society-onboard';
import { decideSocietyMembership, listPendingMemberships, type PendingMembership } from '@/lib/society-membership';
import { escapeIlike } from '@/lib/query-utils';
import { cn } from '@/lib/utils';
import { FEATURE_PLAIN, friendlyPackageLabel, PACKAGE_FLOW_COPY } from '@/lib/feature-catalog-copy';

type Step = 'society' | 'approve' | 'package' | 'admin' | 'residents';

const STEPS: { id: Step; label: string; icon: typeof Building2 }[] = [
  { id: 'society', label: 'Society', icon: Building2 },
  { id: 'approve', label: 'Approve', icon: Check },
  { id: 'package', label: 'Package', icon: Package },
  { id: 'admin', label: 'Admin', icon: Shield },
  { id: 'residents', label: 'Residents', icon: Users },
];

type CatalogPackage = { id: string; label: string; is_default: boolean };
type CatalogBuilder = { id: string; name: string };

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onComplete: () => void;
  seedSocietyId?: string | null;
};

function hydrateSelection(
  snap: SocietyOnboardSnapshot | null,
  pkgs: CatalogPackage[],
  blds: CatalogBuilder[],
): { packageId: string; builderId: string } {
  let nextPackage = '';
  let nextBuilder = '';
  if (snap?.packageId && pkgs.some((p) => p.id === snap.packageId)) {
    nextPackage = snap.packageId;
  }
  if (snap?.builderId && blds.some((b) => b.id === snap.builderId)) {
    nextBuilder = snap.builderId;
  } else if (blds.length === 1) {
    nextBuilder = blds[0].id;
  }
  return { packageId: nextPackage, builderId: nextBuilder };
}

export function SocietyOnboardWizard({ open, onOpenChange, onComplete, seedSocietyId }: Props) {
  const { user } = useAuth();
  const [step, setStep] = useState<Step>('society');
  const [saving, setSaving] = useState(false);
  const [societyId, setSocietyId] = useState<string | null>(seedSocietyId || null);
  const [snapshot, setSnapshot] = useState<SocietyOnboardSnapshot | null>(null);
  const [form, setForm] = useState({ name: '', city: '', state: '', pincode: '', address: '' });
  const [search, setSearch] = useState('');
  const [matches, setMatches] = useState<{ id: string; name: string; is_verified: boolean | null; city: string | null }[]>([]);
  const [packages, setPackages] = useState<CatalogPackage[]>([]);
  const [builders, setBuilders] = useState<CatalogBuilder[]>([]);
  const [packageId, setPackageId] = useState('');
  const [builderId, setBuilderId] = useState('');
  const [newBuilderName, setNewBuilderName] = useState('');
  const [adminQuery, setAdminQuery] = useState('');
  const [adminHits, setAdminHits] = useState<{ id: string; name: string; phone: string; block?: string | null; flat_number?: string | null }[]>([]);
  const [pending, setPending] = useState<PendingMembership[]>([]);
  const [chips, setChips] = useState<PackageFeatureChip[]>([]);
  const [changeAssignment, setChangeAssignment] = useState(false);

  const stepIndex = STEPS.findIndex((s) => s.id === step);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      setSaving(false);
      setForm({ name: '', city: '', state: '', pincode: '', address: '' });
      setSearch('');
      setMatches([]);
      setAdminQuery('');
      setAdminHits([]);
      setNewBuilderName('');
      setPending([]);
      setChips([]);
      setChangeAssignment(false);
      setSocietyId(seedSocietyId || null);
      setSnapshot(null);
      setStep(seedSocietyId ? 'approve' : 'society');

      const [pkgRes, builderRes] = await Promise.all([
        supabase.from('feature_packages').select('id, name, package_name, is_default, is_active').eq('is_active', true),
        supabase.from('builders').select('id, name').eq('is_active', true).order('name'),
      ]);
      if (cancelled) return;
      const pkgs: CatalogPackage[] = (pkgRes.data || []).map((p: { id: string; name?: string; package_name?: string | null; is_default?: boolean }) => ({
        id: p.id,
        label: p.package_name || p.name || 'Package',
        is_default: !!p.is_default,
      }));
      const blds: CatalogBuilder[] = builderRes.data || [];
      setPackages(pkgs);
      setBuilders(blds);

      if (!seedSocietyId) {
        const picked = hydrateSelection(null, pkgs, blds);
        setPackageId(picked.packageId);
        setBuilderId(picked.builderId);
        return;
      }

      const snap = await loadSocietyOnboardSnapshot(seedSocietyId);
      if (cancelled) return;
      setSnapshot(snap);
      const picked = hydrateSelection(snap, pkgs, blds);
      setPackageId(picked.packageId);
      setBuilderId(picked.builderId);
      const members = await listPendingMemberships(seedSocietyId);
      if (!cancelled) setPending(members);
    })();
    return () => {
      cancelled = true;
    };
  }, [open, seedSocietyId]);

  useEffect(() => {
    if (!packageId) {
      setChips([]);
      return;
    }
    void listPackageFeatures(packageId).then(setChips);
  }, [packageId]);

  const refreshSnapshot = async (id: string) => {
    const snap = await loadSocietyOnboardSnapshot(id);
    setSnapshot(snap);
    const picked = hydrateSelection(snap, packages, builders);
    if (picked.packageId) setPackageId(picked.packageId);
    if (picked.builderId) setBuilderId(picked.builderId);
    const members = await listPendingMemberships(id);
    setPending(members);
    return snap;
  };

  const searchSocieties = async (q: string) => {
    setSearch(q);
    if (q.trim().length < 2) {
      setMatches([]);
      return;
    }
    const { data } = await supabase
      .from('societies')
      .select('id, name, is_verified, city')
      .ilike('name', `%${escapeIlike(q.trim())}%`)
      .order('created_at', { ascending: false })
      .limit(8);
    setMatches(data || []);
  };

  const pickSociety = async (id: string) => {
    setSocietyId(id);
    await refreshSnapshot(id);
    setStep('approve');
  };

  const createSociety = async () => {
    setSaving(true);
    const result = await createSocietyRecord(form);
    setSaving(false);
    if (!result.ok) {
      adminNotify.error(result.error);
      return;
    }
    await logAudit('society_created', 'society', result.id, result.id, { name: form.name });
    adminNotify.success('Society added - still pending approval');
    setSocietyId(result.id);
    await refreshSnapshot(result.id);
    setStep('approve');
  };

  const approveSociety = async () => {
    if (!societyId) return;
    setSaving(true);
    const result = await verifyAndActivateSociety(societyId);
    setSaving(false);
    if (!result.ok) {
      adminNotify.error(result.error);
      return;
    }
    await logAudit('society_status_changed', 'society', societyId, societyId, { is_verified: true, is_active: true });
    adminNotify.success('Society approved and activated');
    await refreshSnapshot(societyId);
    setStep('package');
  };

  const applyPackage = async () => {
    if (!societyId || !packageId) return;
    if (!builderId && !newBuilderName.trim()) {
      adminNotify.error('Pick a builder, or type a new builder name');
      return;
    }
    setSaving(true);
    let builder = builderId;
    if (newBuilderName.trim()) {
      const created = await createBuilderRecord(newBuilderName);
      if (!created.ok) {
        setSaving(false);
        adminNotify.error(created.error);
        return;
      }
      builder = created.id;
      setBuilderId(builder);
      await logAudit('builder_created', 'builder', builder, societyId, { name: newBuilderName });
    }
    const result = await assignPackageToSociety({
      societyId,
      packageId,
      builderId: builder || null,
      assignedBy: user?.id || null,
    });
    setSaving(false);
    if (!result.ok) {
      adminNotify.error(result.error);
      return;
    }
    await logAudit('package_assigned_to_society', 'builder_feature_package', result.id, societyId, { package_id: packageId });
    adminNotify.success('Package assigned through builder');
    setChangeAssignment(false);
    await refreshSnapshot(societyId);
    setStep('admin');
  };

  const searchAdmins = async (q: string) => {
    setAdminQuery(q);
    const hits = await searchResidentsForAppoint(q);
    setAdminHits(hits as { id: string; name: string; phone: string; block?: string | null; flat_number?: string | null }[]);
  };

  const appoint = async (userId: string) => {
    if (!societyId) return;
    setSaving(true);
    const result = await appointSocietyAdmin({
      societyId,
      userId,
      appointedBy: user?.id || null,
    });
    setSaving(false);
    if (!result.ok) {
      adminNotify.error(result.error);
      return;
    }
    await logAudit('admin_appointed', 'society_admin', userId, societyId, { role: 'admin' });
    adminNotify.success('Society admin appointed');
    await refreshSnapshot(societyId);
    setStep('residents');
  };

  const decide = async (membershipId: string, decision: 'active' | 'rejected') => {
    const result = await decideSocietyMembership(membershipId, decision);
    if (!result.ok) {
      adminNotify.error(result.error);
      return;
    }
    adminNotify.success(decision === 'active' ? 'Resident approved' : 'Resident rejected');
    if (societyId) await refreshSnapshot(societyId);
  };

  const finish = () => {
    onComplete();
    onOpenChange(false);
  };

  const selectedPackage = useMemo(
    () => packages.find((p) => p.id === packageId),
    [packages, packageId],
  );

  const alreadyAssigned = !!(
    snapshot?.packageId
    && snapshot.packageId === packageId
    && snapshot.builderId
    && snapshot.builderId === builderId
    && !newBuilderName.trim()
  );

  const canAssign = !!packageId && (!!builderId || !!newBuilderName.trim());
  const visibleChips = chips.slice(0, 10);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-lg overflow-y-auto p-0">
        <div className="relative overflow-hidden bg-gradient-to-br from-slate-900 via-emerald-950 to-teal-900 px-5 pb-5 pt-6 text-white">
          <div className="pointer-events-none absolute -right-10 -top-8 h-36 w-36 rounded-full bg-emerald-400/20 blur-3xl" />
          <div className="pointer-events-none absolute -left-8 bottom-0 h-24 w-24 rounded-full bg-white/10 blur-2xl" />
          <SheetHeader className="relative text-left">
            <p className="text-[10px] uppercase tracking-[0.22em] text-emerald-200/80 font-semibold">Society OS</p>
            <SheetTitle className="text-white text-xl font-bold tracking-tight mt-1">Onboard society</SheetTitle>
            <p className="text-xs text-white/75 mt-1">
              Approve the society, attach a package through a builder, appoint the RWA admin, then residents.
            </p>
          </SheetHeader>
          <div className="relative mt-4 flex gap-1">
            {STEPS.map((s, i) => {
              const Icon = s.icon;
              const done = i < stepIndex;
              const active = s.id === step;
              return (
                <button
                  key={s.id}
                  type="button"
                  disabled={!societyId && s.id !== 'society'}
                  onClick={() => societyId && setStep(s.id)}
                  className={cn(
                    'flex-1 rounded-xl px-1 py-2 text-[10px] font-semibold transition-all',
                    active ? 'bg-white text-slate-900 shadow-lg' : done ? 'bg-white/20 text-white' : 'bg-white/10 text-white/70',
                  )}
                >
                  <Icon size={12} className="mx-auto mb-1" />
                  {s.label}
                </button>
              );
            })}
          </div>
        </div>

        <div className="space-y-4 p-5">
          {snapshot && (
            <Card className="border-0 shadow-[var(--shadow-card)] rounded-3xl overflow-hidden">
              <CardContent className="p-4 space-y-2">
                <p className="font-bold text-sm leading-snug">{snapshot.society.name}</p>
                <div className="flex flex-wrap gap-1.5">
                  <Badge variant={snapshot.society.is_verified ? 'default' : 'outline'} className="text-[10px] rounded-md">
                    {snapshot.society.is_verified ? 'Verified' : 'Pending'}
                  </Badge>
                  {snapshot.packageName && (
                    <Badge variant="secondary" className="text-[10px] rounded-md">{friendlyPackageLabel(snapshot.packageName)}</Badge>
                  )}
                  {snapshot.builderName && (
                    <Badge variant="secondary" className="text-[10px] rounded-md">{snapshot.builderName}</Badge>
                  )}
                  <Badge variant="secondary" className="text-[10px] rounded-md">{snapshot.adminCount} admins</Badge>
                </div>
              </CardContent>
            </Card>
          )}

          {step === 'society' && (
            <div className="space-y-3">
              <div>
                <Label className="text-xs font-semibold">Find existing (e.g. Shriram Greenfield)</Label>
                <Input
                  value={search}
                  onChange={(e) => void searchSocieties(e.target.value)}
                  placeholder="Search society name"
                  className="rounded-xl mt-1"
                />
              </div>
              {matches.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => void pickSociety(m.id)}
                  className="w-full rounded-2xl border border-border/60 bg-card p-3 text-left hover:border-primary/40 transition-colors"
                >
                  <p className="text-sm font-bold">{m.name}</p>
                  <p className="text-[11px] text-muted-foreground">
                    {[m.city, m.is_verified ? 'verified' : 'unverified'].filter(Boolean).join(' - ')}
                  </p>
                </button>
              ))}
              <div className="h-px bg-border/60" />
              <p className="text-xs font-bold">Or add a new society</p>
              <Input placeholder="Name" value={form.name} onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))} className="rounded-xl" />
              <div className="grid grid-cols-2 gap-2">
                <Input placeholder="City" value={form.city} onChange={(e) => setForm((p) => ({ ...p, city: e.target.value }))} className="rounded-xl" />
                <Input placeholder="Pincode" value={form.pincode} onChange={(e) => setForm((p) => ({ ...p, pincode: e.target.value }))} className="rounded-xl" />
              </div>
              <Input placeholder="State" value={form.state} onChange={(e) => setForm((p) => ({ ...p, state: e.target.value }))} className="rounded-xl" />
              <Input placeholder="Address" value={form.address} onChange={(e) => setForm((p) => ({ ...p, address: e.target.value }))} className="rounded-xl" />
              <Button className="w-full rounded-xl h-10 font-semibold" disabled={!form.name.trim() || saving} onClick={() => void createSociety()}>
                Add society
              </Button>
            </div>
          )}

          {step === 'approve' && societyId && (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Residents cannot join an unverified society. Google Maps is discovery only. Approve it here, then attach a package.
              </p>
              {snapshot?.society.is_verified ? (
                <Button className="w-full rounded-xl h-11 font-semibold" onClick={() => setStep('package')}>
                  Already verified - continue
                </Button>
              ) : (
                <Button className="w-full rounded-xl h-11 font-semibold" disabled={saving} onClick={() => void approveSociety()}>
                  Approve and activate
                </Button>
              )}
            </div>
          )}

          {step === 'package' && (
            <div className="space-y-3">
              <p className="text-xs text-muted-foreground leading-relaxed">{PACKAGE_FLOW_COPY}</p>

              {alreadyAssigned && !changeAssignment && (
                <div className="rounded-3xl bg-emerald-500/8 border border-emerald-500/20 p-4 space-y-3">
                  <div className="flex items-start gap-2">
                    <Sparkles size={16} className="text-emerald-600 mt-0.5 shrink-0" />
                    <div>
                      <p className="text-sm font-bold">Already live for this society</p>
                      <p className="text-[11px] text-muted-foreground mt-0.5">
                        {friendlyPackageLabel(snapshot?.packageName)} via {snapshot?.builderName || 'builder'}
                      </p>
                    </div>
                  </div>
                  {visibleChips.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {visibleChips.map((chip) => (
                        <Badge key={chip.key} variant="secondary" className="text-[10px] rounded-md font-medium">
                          {FEATURE_PLAIN[chip.key] || chip.name}
                        </Badge>
                      ))}
                      {chips.length > visibleChips.length && (
                        <Badge variant="outline" className="text-[10px] rounded-md">+{chips.length - visibleChips.length} more</Badge>
                      )}
                    </div>
                  )}
                  <Button className="w-full rounded-xl h-11 font-semibold" onClick={() => setStep('admin')}>
                    Continue to appoint admin
                  </Button>
                  <Button variant="ghost" className="w-full rounded-xl h-9 text-xs" onClick={() => setChangeAssignment(true)}>
                    Change package or builder
                  </Button>
                </div>
              )}

              {(!alreadyAssigned || changeAssignment) && (
                <>
                  <div>
                    <Label className="text-xs font-semibold">Package</Label>
                    <Select value={packageId} onValueChange={setPackageId}>
                      <SelectTrigger className="rounded-xl mt-1 h-11"><SelectValue placeholder="Select package" /></SelectTrigger>
                      <SelectContent>
                        {packages.map((p) => (
                          <SelectItem key={p.id} value={p.id}>
                            {friendlyPackageLabel(p.label)}{p.is_default ? ' (default - every society)' : ''}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  {selectedPackage?.is_default && (
                    <p className="text-[11px] text-amber-800 bg-amber-500/10 rounded-xl px-3 py-2">
                      Sociva Core is already granted to every society. Pick Pilot Ops to add visitors, parcels, parking, and guard kiosk.
                    </p>
                  )}
                  {visibleChips.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {visibleChips.map((chip) => (
                        <Badge key={chip.key} variant="secondary" className="text-[10px] rounded-md font-medium">
                          {FEATURE_PLAIN[chip.key] || chip.name}
                        </Badge>
                      ))}
                      {chips.length > visibleChips.length && (
                        <Badge variant="outline" className="text-[10px] rounded-md">+{chips.length - visibleChips.length} more</Badge>
                      )}
                    </div>
                  )}
                  <div>
                    <Label className="text-xs font-semibold">Builder</Label>
                    <Select value={builderId} onValueChange={setBuilderId}>
                      <SelectTrigger className="rounded-xl mt-1 h-11"><SelectValue placeholder="Select builder" /></SelectTrigger>
                      <SelectContent>
                        {builders.map((b) => (
                          <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <Input
                    placeholder="Or create a builder name"
                    value={newBuilderName}
                    onChange={(e) => setNewBuilderName(e.target.value)}
                    className="rounded-xl h-11"
                  />
                  <Button className="w-full rounded-xl h-11 font-semibold" disabled={!canAssign || saving} onClick={() => void applyPackage()}>
                    <Layers size={14} className="mr-1" /> Assign package
                  </Button>
                </>
              )}
            </div>
          )}

          {step === 'admin' && (
            <div className="space-y-3">
              <p className="text-xs text-muted-foreground">
                Appoint a real RWA or builder contact. Search any resident by name or phone - they do not need to be joined yet.
              </p>
              {snapshot && snapshot.adminCount > 0 && (
                <div className="rounded-2xl bg-emerald-500/8 border border-emerald-500/20 px-3 py-2 text-[11px] font-medium text-emerald-800">
                  {snapshot.adminCount} admin already appointed for this society.
                </div>
              )}
              <Input
                placeholder="Search Aditi, 98765..., or builder contact"
                value={adminQuery}
                onChange={(e) => void searchAdmins(e.target.value)}
                className="rounded-xl h-11"
              />
              {adminHits.map((hit) => (
                <Card key={hit.id} className="border-0 shadow-[var(--shadow-card)] rounded-2xl">
                  <CardContent className="p-3 flex items-center justify-between gap-2">
                    <div>
                      <p className="text-sm font-bold">{hit.name}</p>
                      <p className="text-[11px] text-muted-foreground">
                        {[hit.phone, hit.block, hit.flat_number].filter(Boolean).join(' - ')}
                      </p>
                    </div>
                    <Button size="sm" className="rounded-xl h-8 text-xs" disabled={saving} onClick={() => void appoint(hit.id)}>
                      <UserPlus size={12} className="mr-1" /> Admin
                    </Button>
                  </CardContent>
                </Card>
              ))}
              <Button variant="outline" className="w-full rounded-xl h-10" onClick={() => setStep('residents')}>
                Skip for now
              </Button>
            </div>
          )}

          {step === 'residents' && (
            <div className="space-y-3">
              {pending.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-8">No pending memberships for this society.</p>
              ) : pending.map((row) => (
                <Card key={row.id} className="border-0 shadow-[var(--shadow-card)] rounded-2xl">
                  <CardContent className="p-3 flex items-center justify-between gap-2">
                    <div>
                      <p className="text-sm font-bold">{row.name || 'Resident'}</p>
                      <p className="text-[11px] text-muted-foreground">{row.phone}</p>
                    </div>
                    <div className="flex gap-1.5">
                      <Button size="sm" variant="outline" className="h-8 rounded-xl text-xs" onClick={() => void decide(row.id, 'rejected')}>
                        Reject
                      </Button>
                      <Button size="sm" className="h-8 rounded-xl text-xs" onClick={() => void decide(row.id, 'active')}>
                        Approve
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
              <Button className="w-full rounded-xl h-11 font-semibold" onClick={finish}>
                Done
              </Button>
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
