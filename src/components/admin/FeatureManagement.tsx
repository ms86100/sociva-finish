// @ts-nocheck
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Skeleton } from '@/components/ui/skeleton';
import { Plus, Package, Layers, Building2, Trash2, Check, BarChart3, Settings2 } from 'lucide-react';
import { CreateBuilderSheet } from './CreateBuilderSheet';
import { PackageComparisonMatrix } from './PackageComparisonMatrix';
import { SocietyFeatureAudit } from './SocietyFeatureAudit';
import { BuilderManagementSheet } from './BuilderManagementSheet';
import { useFeatureManagement, CATEGORIES, TIERS } from '@/hooks/useFeatureManagement';
import { motion } from 'framer-motion';

export function FeatureManagement() {
  const f = useFeatureManagement();

  if (f.isLoading) {
    return <div className="space-y-3 p-2">{[1,2,3].map(i => <Skeleton key={i} className="h-16 w-full rounded-2xl" />)}</div>;
  }

  return (
    <div className="space-y-4">
      <Tabs defaultValue="features">
        <TabsList className="w-full grid grid-cols-3 bg-muted/60 p-1 rounded-2xl">
          <TabsTrigger value="features" className="text-xs gap-1.5 rounded-xl data-[state=active]:shadow-[var(--shadow-sm)]"><Layers size={12} /> Features</TabsTrigger>
          <TabsTrigger value="packages" className="text-xs gap-1.5 rounded-xl data-[state=active]:shadow-[var(--shadow-sm)]"><Package size={12} /> Packages</TabsTrigger>
          <TabsTrigger value="assignments" className="text-xs gap-1.5 rounded-xl data-[state=active]:shadow-[var(--shadow-sm)]"><Building2 size={12} /> Assignments</TabsTrigger>
        </TabsList>

        {/* FEATURES TAB */}
        <TabsContent value="features" className="space-y-3 mt-4">
          <div className="flex justify-between items-center">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-xl bg-primary/10 flex items-center justify-center">
                <Layers size={15} className="text-primary" />
              </div>
              <h3 className="text-sm font-bold">Platform Features <span className="text-muted-foreground font-normal text-xs">({f.features.length})</span></h3>
            </div>
            <Sheet open={f.newFeatureOpen} onOpenChange={f.setNewFeatureOpen}>
              <SheetTrigger asChild><Button size="sm" variant="outline" className="gap-1.5 rounded-xl font-semibold"><Plus size={14} /> Add</Button></SheetTrigger>
              <SheetContent>
                <SheetHeader><SheetTitle className="font-bold">New Feature</SheetTitle></SheetHeader>
                <div className="mt-4 space-y-3">
                  <div><Label className="text-xs font-semibold">Key (snake_case)</Label><Input value={f.newFeature.feature_key} onChange={e => f.setNewFeature(p => ({ ...p, feature_key: e.target.value }))} placeholder="my_feature" className="rounded-xl" /></div>
                  <div><Label className="text-xs font-semibold">Name</Label><Input value={f.newFeature.feature_name} onChange={e => f.setNewFeature(p => ({ ...p, feature_name: e.target.value }))} placeholder="My Feature" className="rounded-xl" /></div>
                  <div><Label className="text-xs font-semibold">Description</Label><Input value={f.newFeature.description} onChange={e => f.setNewFeature(p => ({ ...p, description: e.target.value }))} className="rounded-xl" /></div>
                  <div>
                    <Label className="text-xs font-semibold">Category</Label>
                    <Select value={f.newFeature.category} onValueChange={v => f.setNewFeature(p => ({ ...p, category: v }))}>
                      <SelectTrigger className="rounded-xl"><SelectValue /></SelectTrigger>
                      <SelectContent>{CATEGORIES.map(c => <SelectItem key={c} value={c} className="capitalize">{c}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <div className="flex items-center justify-between"><Label className="text-xs font-semibold">Core (can't be disabled)</Label><Switch checked={f.newFeature.is_core} onCheckedChange={v => f.setNewFeature(p => ({ ...p, is_core: v }))} /></div>
                  <div className="flex items-center justify-between"><Label className="text-xs font-semibold">Society Configurable</Label><Switch checked={f.newFeature.society_configurable} onCheckedChange={v => f.setNewFeature(p => ({ ...p, society_configurable: v }))} /></div>
                  <Button className="w-full rounded-xl h-10 font-semibold" onClick={f.createFeature}>Create Feature</Button>
                </div>
              </SheetContent>
            </Sheet>
          </div>

          {CATEGORIES.map(cat => f.groupedFeatures[cat]?.length > 0 && (
            <div key={cat}>
              <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-2">{cat}</p>
              <Card className="border-0 shadow-[var(--shadow-card)] rounded-2xl"><CardContent className="p-3.5 space-y-3">
                {f.groupedFeatures[cat].map(feat => (
                  <div key={feat.id} className="flex items-center justify-between py-0.5">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <p className="text-sm font-semibold truncate">{feat.feature_name}</p>
                        {feat.is_core && <Badge variant="secondary" className="text-[9px] h-4 rounded-md">Core</Badge>}
                        {feat.is_experimental && <Badge variant="outline" className="text-[9px] h-4 rounded-md">Beta</Badge>}
                      </div>
                      <p className="text-[10px] text-muted-foreground font-mono">{feat.feature_key}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Switch checked={feat.society_configurable} onCheckedChange={v => f.toggleFeatureField(feat.id, 'society_configurable', v)} className="scale-75" />
                      <span className="text-[9px] text-muted-foreground w-10 font-medium">Config</span>
                    </div>
                  </div>
                ))}
              </CardContent></Card>
            </div>
          ))}
        </TabsContent>

        {/* PACKAGES TAB */}
        <TabsContent value="packages" className="space-y-3 mt-4">
          <div className="flex justify-between items-center">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-xl bg-amber-500/10 flex items-center justify-center">
                <Package size={15} className="text-amber-600" />
              </div>
              <h3 className="text-sm font-bold">Feature Packages <span className="text-muted-foreground font-normal text-xs">({f.packages.length})</span></h3>
            </div>
            <div className="flex gap-2">
              <Button size="sm" variant={f.showComparison ? 'default' : 'outline'} className="gap-1.5 text-xs rounded-xl font-semibold" onClick={() => f.setShowComparison(v => !v)}><BarChart3 size={12} /> Compare</Button>
              <Sheet open={f.newPkgOpen} onOpenChange={f.setNewPkgOpen}>
                <SheetTrigger asChild><Button size="sm" variant="outline" className="gap-1.5 rounded-xl font-semibold"><Plus size={14} /> Create</Button></SheetTrigger>
                <SheetContent>
                  <SheetHeader><SheetTitle className="font-bold">New Package</SheetTitle></SheetHeader>
                  <div className="mt-4 space-y-3">
                    <div><Label className="text-xs font-semibold">Name</Label><Input value={f.newPkg.package_name} onChange={e => f.setNewPkg(p => ({ ...p, package_name: e.target.value }))} placeholder="Pro Plan" className="rounded-xl" /></div>
                    <div><Label className="text-xs font-semibold">Description</Label><Input value={f.newPkg.description} onChange={e => f.setNewPkg(p => ({ ...p, description: e.target.value }))} className="rounded-xl" /></div>
                    <div>
                      <Label className="text-xs font-semibold">Price Tier</Label>
                      <Select value={f.newPkg.price_tier} onValueChange={v => f.setNewPkg(p => ({ ...p, price_tier: v }))}>
                        <SelectTrigger className="rounded-xl"><SelectValue /></SelectTrigger>
                        <SelectContent>{TIERS.map(t => <SelectItem key={t} value={t} className="capitalize">{t}</SelectItem>)}</SelectContent>
                      </Select>
                    </div>
                    <Button className="w-full rounded-xl h-10 font-semibold" onClick={f.createPackage}>Create Package</Button>
                  </div>
                </SheetContent>
              </Sheet>
            </div>
          </div>

          {f.showComparison && <PackageComparisonMatrix features={f.features} packages={f.packages} packageItems={f.allPkgItems} />}
          {f.packages.map(pkg => (
            <Card key={pkg.id} className="border-0 shadow-[var(--shadow-card)] rounded-2xl"><CardContent className="p-3.5">
              <div className="flex items-center justify-between mb-2">
                <div><p className="text-sm font-bold">{pkg.package_name}</p><Badge variant="outline" className="text-[9px] capitalize rounded-md">{pkg.price_tier}</Badge></div>
                <Button size="sm" variant={f.editingPkg === pkg.id ? 'default' : 'outline'} className="text-xs rounded-xl font-semibold" onClick={() => f.editingPkg === pkg.id ? f.setEditingPkg(null) : f.openPackageEditor(pkg.id)}>
                  {f.editingPkg === pkg.id ? 'Done' : 'Edit Features'}
                </Button>
              </div>
              {pkg.description && <p className="text-xs text-muted-foreground mb-2">{pkg.description}</p>}
              {f.editingPkg === pkg.id && (
                <div className="border-t border-border/30 pt-3 mt-3 divide-y divide-border/20 max-h-64 overflow-y-auto">
                  {f.features.map(feat => (
                    <div key={feat.id} className="flex items-center justify-between py-2.5">
                      <div className="flex items-center gap-1.5"><span className="text-xs font-medium">{feat.feature_name}</span>{feat.is_core && <Badge variant="secondary" className="text-[8px] h-3 rounded-md">Core</Badge>}</div>
                      <Switch checked={!!f.pkgItems[feat.id]} onCheckedChange={v => f.togglePkgItem(feat.id, v)} className="scale-75" />
                    </div>
                  ))}
                </div>
              )}
            </CardContent></Card>
          ))}
          {f.packages.length === 0 && <div className="text-center text-muted-foreground py-12 text-sm font-medium">No packages yet</div>}
        </TabsContent>

        {/* ASSIGNMENTS TAB */}
        <TabsContent value="assignments" className="space-y-3 mt-4">
          <div className="flex justify-between items-center">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-xl bg-cyan-500/10 flex items-center justify-center">
                <Building2 size={15} className="text-cyan-600" />
              </div>
              <h3 className="text-sm font-bold">Builder Assignments <span className="text-muted-foreground font-normal text-xs">({f.assignments.length})</span></h3>
            </div>
            <div className="flex gap-2">
              <CreateBuilderSheet onCreated={f.fetchAll} />
              <Sheet open={f.assignOpen} onOpenChange={f.setAssignOpen}>
                <SheetTrigger asChild><Button size="sm" variant="outline" className="gap-1.5 rounded-xl font-semibold"><Plus size={14} /> Assign</Button></SheetTrigger>
                <SheetContent>
                  <SheetHeader><SheetTitle className="font-bold">Assign Package to Builder</SheetTitle></SheetHeader>
                  <div className="mt-4 space-y-3">
                    <div>
                      <Label className="text-xs font-semibold">Builder</Label>
                      <Select value={f.assignBuilder} onValueChange={f.setAssignBuilder}>
                        <SelectTrigger className="rounded-xl"><SelectValue placeholder="Select builder" /></SelectTrigger>
                        <SelectContent>{f.builders.map(b => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}</SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label className="text-xs font-semibold">Package</Label>
                      <Select value={f.assignPackage} onValueChange={f.setAssignPackage}>
                        <SelectTrigger className="rounded-xl"><SelectValue placeholder="Select package" /></SelectTrigger>
                        <SelectContent>{f.packages.map(p => <SelectItem key={p.id} value={p.id}>{p.package_name}</SelectItem>)}</SelectContent>
                      </Select>
                    </div>
                    <Button className="w-full rounded-xl h-10 font-semibold" onClick={f.assignPackageToBuilder} disabled={!f.assignBuilder || !f.assignPackage}><Check size={14} className="mr-1" /> Assign Package</Button>
                  </div>
                </SheetContent>
              </Sheet>
            </div>
          </div>
          {f.assignments.map(a => (
            <Card key={a.id} className="border-0 shadow-[var(--shadow-card)] rounded-2xl"><CardContent className="p-3.5">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-bold">{(a as any).builder?.name || 'Unknown Builder'}</p>
                  <p className="text-xs text-muted-foreground">{(a as any).package?.package_name || 'Unknown Package'}</p>
                  {a.expires_at && <p className="text-[10px] text-warning font-semibold">Expires: {new Date(a.expires_at).toLocaleDateString()}</p>}
                </div>
                <div className="flex items-center gap-1.5">
                  <Button size="sm" variant="outline" className="text-xs h-8 gap-1 rounded-xl font-semibold" onClick={() => { f.setManageBuilderId(a.builder_id); f.setManageBuilderName((a as any).builder?.name || 'Builder'); }}><Settings2 size={12} /> Manage</Button>
                  <SocietyFeatureAudit builderId={a.builder_id} builderName={(a as any).builder?.name || 'Builder'} />
                  <Button size="sm" variant="ghost" className="text-destructive h-8 w-8 p-0 rounded-xl" onClick={() => f.removeAssignment(a.id, a.builder_id, a.package_id)}><Trash2 size={14} /></Button>
                </div>
              </div>
            </CardContent></Card>
          ))}
          {f.assignments.length === 0 && <div className="text-center text-muted-foreground py-12 text-sm font-medium">No assignments yet</div>}
        </TabsContent>
      </Tabs>

      <BuilderManagementSheet open={!!f.manageBuilderId} onOpenChange={(open) => { if (!open) f.setManageBuilderId(null); }} builderId={f.manageBuilderId || ''} builderName={f.manageBuilderName} />
    </div>
  );
}
