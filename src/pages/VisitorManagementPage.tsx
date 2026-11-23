// @ts-nocheck
import { FeatureGate } from '@/components/ui/FeatureGate';
import { AppLayout } from '@/components/layout/AppLayout';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerDescription, DrawerTrigger } from '@/components/ui/drawer';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { ConfirmAction } from '@/components/ui/confirm-action';
import { Switch } from '@/components/ui/switch';
import { ModuleSearchBar } from '@/components/search/ModuleSearchBar';
import { useVisitorManagement, statusColors } from '@/hooks/useVisitorManagement';
import { UserPlus, Shield, Clock, Car, Phone, Users, XCircle, Copy, LogOut, Download, Loader2, Sparkles } from 'lucide-react';

function OtpTile({ code, onCopy }: { code: string; onCopy: () => void }) {
  return (
    <button
      type="button"
      onClick={onCopy}
      className="shrink-0 rounded-2xl bg-gradient-to-br from-primary to-primary/75 px-3.5 py-2.5 text-primary-foreground shadow-lg shadow-primary/20 transition-transform active:scale-95"
    >
      <span className="block font-mono text-xl font-bold tracking-[0.28em]">{code}</span>
      <span className="mt-0.5 flex items-center justify-center gap-1 text-[10px] text-primary-foreground/80">
        <Copy size={10} /> Copy gate OTP
      </span>
    </button>
  );
}

export default function VisitorManagementPage() {
  const v = useVisitorManagement();

  return (
    <AppLayout headerTitle="Visitor Management" showLocation={false}>
      <FeatureGate feature="visitor_management">
      <div className="relative space-y-4 p-4">
        <div className="relative overflow-hidden rounded-[1.75rem] border border-primary/15 bg-gradient-to-br from-primary via-primary/85 to-emerald-700 p-5 text-primary-foreground shadow-lg shadow-primary/20">
          <div className="pointer-events-none absolute -right-8 -top-10 h-36 w-36 rounded-full bg-white/15 blur-2xl" />
          <div className="pointer-events-none absolute -bottom-12 left-10 h-28 w-28 rounded-full bg-emerald-300/20 blur-2xl" />
          <div className="relative flex items-start justify-between gap-3">
            <div>
              <p className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-primary-foreground/80">
                <Sparkles size={12} /> Gate-ready pass
              </p>
              <p className="mt-2 text-3xl font-bold tabular-nums leading-none">{v.todayCount}</p>
              <p className="mt-1 text-sm text-primary-foreground/85">
                {v.todayCount === 1 ? 'visitor expected today' : 'visitors expected today'}
              </p>
            </div>
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-white/15 backdrop-blur">
              <Shield size={26} />
            </div>
          </div>
          <div className="relative mt-5 flex gap-2">
            {v.visitors.length > 0 && (
              <Button size="sm" variant="secondary" className="rounded-xl bg-white/15 text-primary-foreground hover:bg-white/25" onClick={v.handleExport} title="Export CSV">
                <Download size={16} className="mr-1" /> Export
              </Button>
            )}
            <Drawer open={v.isAddOpen} onOpenChange={v.setIsAddOpen}>
              <DrawerTrigger asChild>
                <Button size="sm" className="rounded-xl bg-white text-primary hover:bg-white/90">
                  <UserPlus size={16} className="mr-1" /> Add visitor
                </Button>
              </DrawerTrigger>
              <DrawerContent className="max-h-[85dvh] overflow-y-auto">
                <DrawerHeader>
                  <DrawerTitle>Add a visitor</DrawerTitle>
                  <DrawerDescription>Pre-approve someone and share a one-time gate OTP</DrawerDescription>
                </DrawerHeader>
                <div className="space-y-4 px-4 pb-6">
                  <div><Label>Visitor name *</Label><Input value={v.visitorName} onChange={e => v.setVisitorName(e.target.value)} placeholder="Enter name" className="h-12 rounded-xl" /></div>
                  <div><Label>Phone number</Label><Input value={v.visitorPhone} onChange={e => v.setVisitorPhone(e.target.value)} placeholder="+91 XXXXX XXXXX" className="h-12 rounded-xl" /></div>
                  <div>
                    <Label>Visitor type</Label>
                    <Select value={v.visitorType} onValueChange={v.setVisitorType}>
                      <SelectTrigger className="h-12 rounded-xl"><SelectValue /></SelectTrigger>
                      <SelectContent>{v.visitorTypes.map(vt => <SelectItem key={vt.type_key} value={vt.type_key}>{vt.label}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <div><Label>Purpose</Label><Input value={v.purpose} onChange={e => v.setPurpose(e.target.value)} placeholder="e.g. Family visit" className="h-12 rounded-xl" /></div>
                  <div className="grid grid-cols-2 gap-3">
                    <div><Label>Expected date</Label><Input type="date" value={v.expectedDate} onChange={e => v.setExpectedDate(e.target.value)} className="h-12 rounded-xl" /></div>
                    <div><Label>Expected time</Label><Input type="time" value={v.expectedTime} onChange={e => v.setExpectedTime(e.target.value)} className="h-12 rounded-xl" /></div>
                  </div>
                  <div><Label>Vehicle number (optional)</Label><Input value={v.vehicleNumber} onChange={e => v.setVehicleNumber(e.target.value)} placeholder="MH 01 AB 1234" className="h-12 rounded-xl" /></div>
                  <div className="flex items-center justify-between rounded-2xl border border-border/70 bg-muted/40 px-3 py-3">
                    <Label className="text-sm">Recurring visitor</Label>
                    <Switch checked={v.isRecurring} onCheckedChange={v.setIsRecurring} />
                  </div>
                  {v.isRecurring && (
                    <div>
                      <Label className="text-xs">Active days</Label>
                      <div className="mt-1.5 flex flex-wrap gap-1.5">
                        {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(day => (
                          <button
                            key={day}
                            type="button"
                            onClick={() => v.setRecurringDays(prev => prev.includes(day) ? prev.filter(d => d !== day) : [...prev, day])}
                            className={`rounded-full px-2.5 py-1 text-xs font-medium transition-colors ${v.recurringDays.includes(day) ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'}`}
                          >
                            {day}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                  <Button onClick={v.handleAddVisitor} disabled={!v.visitorName.trim() || v.isSubmitting} className="h-12 w-full rounded-xl text-base font-semibold">
                    {v.isSubmitting ? <><Loader2 size={16} className="mr-1 animate-spin" /> Adding...</> : 'Add visitor and generate OTP'}
                  </Button>
                </div>
              </DrawerContent>
            </Drawer>
          </div>
        </div>

        <ModuleSearchBar context="visitors" value={v.searchQuery} onChange={v.setSearchQuery} />

        <Tabs value={v.activeTab} onValueChange={v.setActiveTab}>
          <TabsList className="grid w-full grid-cols-3 rounded-2xl bg-muted/70 p-1">
            <TabsTrigger value="today" className="rounded-xl text-xs">Today</TabsTrigger>
            <TabsTrigger value="upcoming" className="rounded-xl text-xs">Upcoming</TabsTrigger>
            <TabsTrigger value="history" className="rounded-xl text-xs">History</TabsTrigger>
          </TabsList>
          <TabsContent value={v.activeTab} className="mt-3 space-y-3">
            {v.isLoading ? Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-28 w-full rounded-2xl" />) : v.visitors.length === 0 ? (
              <div className="relative overflow-hidden rounded-[1.75rem] border border-border/60 bg-gradient-to-br from-card via-background to-secondary/50 px-5 py-14 text-center shadow-card">
                <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                  <Users size={26} />
                </div>
                <p className="text-sm font-semibold text-foreground">
                  {v.activeTab === 'today'
                    ? "You haven't added any visitors yet"
                    : v.activeTab === 'upcoming'
                      ? 'No upcoming visitor passes'
                      : 'No visitor history yet'}
                </p>
                <p className="mx-auto mt-2 max-w-[280px] text-xs leading-relaxed text-muted-foreground">
                  {v.activeTab === 'history'
                    ? 'Completed and cancelled visits archive here after check-out.'
                    : 'Create a visitor pass before your guest reaches the gate so security can verify them with OTP.'}
                </p>
                {v.activeTab !== 'history' && (
                  <div className="mt-5">
                    <Button
                      size="sm"
                      className="rounded-xl gap-1.5"
                      onClick={() => v.setIsAddOpen(true)}
                    >
                      <UserPlus size={14} /> Add visitor pass
                    </Button>
                  </div>
                )}
              </div>
            ) : v.visitors.map(visitor => (
              <Card key={visitor.id} className="overflow-hidden border-border/70">
                <CardContent className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="truncate font-semibold">{visitor.visitor_name}</p>
                        <Badge variant="outline" className={`text-[10px] capitalize ${statusColors[visitor.status]}`}>{visitor.status.replace('_', ' ')}</Badge>
                      </div>
                      <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                        <span className="capitalize">{v.getVisitorTypeLabel(visitor.visitor_type)}</span>
                        {visitor.visitor_phone && <span className="flex items-center gap-0.5"><Phone size={10} /> {visitor.visitor_phone}</span>}
                        {visitor.vehicle_number && <span className="flex items-center gap-0.5"><Car size={10} /> {visitor.vehicle_number}</span>}
                      </div>
                      {visitor.purpose && <p className="mt-1 text-xs text-muted-foreground">{visitor.purpose}</p>}
                      {visitor.expected_time && <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground"><Clock size={10} /> {visitor.expected_time}</p>}
                    </div>
                    {visitor.otp_code && visitor.status === 'expected' && (
                      <OtpTile code={visitor.otp_code} onCopy={() => v.copyOTP(visitor.otp_code!)} />
                    )}
                  </div>
                  {visitor.status === 'expected' && (
                    <div className="mt-3 flex gap-2">
                      <p className="flex-1 text-xs text-muted-foreground">Share the OTP with the guard. Residents cannot skip gate check-in.</p>
                      <ConfirmAction title="Cancel visitor entry?" description={`Cancel entry for ${visitor.visitor_name}?`} actionLabel="Cancel entry" onConfirm={() => v.handleCancel(visitor.id)}>
                        <Button size="sm" variant="outline" className="h-10 rounded-xl"><XCircle size={14} /></Button>
                      </ConfirmAction>
                    </div>
                  )}
                  {visitor.status === 'checked_in' && (
                    <ConfirmAction title="Check out visitor?" description={`Mark ${visitor.visitor_name} as checked out?`} actionLabel="Check out" variant="default" onConfirm={() => v.handleCheckOut(visitor.id)}>
                      <Button size="sm" variant="outline" className="mt-3 h-10 w-full rounded-xl"><LogOut size={14} className="mr-1" /> Check out</Button>
                    </ConfirmAction>
                  )}
                  {visitor.checked_in_at && (
                    <p className="mt-2 text-[10px] text-muted-foreground">
                      In: {new Date(visitor.checked_in_at).toLocaleTimeString()}
                      {visitor.checked_out_at && ` - Out: ${new Date(visitor.checked_out_at).toLocaleTimeString()}`}
                    </p>
                  )}
                </CardContent>
              </Card>
            ))}
          </TabsContent>
        </Tabs>
      </div>
      </FeatureGate>
    </AppLayout>
  );
}
