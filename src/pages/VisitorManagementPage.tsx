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
import { UserPlus, Shield, Clock, Car, Phone, Users, XCircle, Copy, LogIn, LogOut, Download, Loader2 } from 'lucide-react';

export default function VisitorManagementPage() {
  const v = useVisitorManagement();

  return (
    <AppLayout headerTitle="Visitor Management" showLocation={false}>
      <FeatureGate feature="visitor_management">
      <div className="p-4 space-y-4">
        <ModuleSearchBar context="visitors" value={v.searchQuery} onChange={v.setSearchQuery} />

        {/* Summary */}
        <Card className="border-primary/20 bg-primary/5">
          <CardContent className="p-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center">
                <Shield className="text-primary" size={24} />
              </div>
              <div>
                <p className="font-semibold text-sm">Today's Visitors</p>
                <p className="text-2xl font-bold text-primary tabular-nums">{v.todayCount}</p>
              </div>
            </div>
          <Drawer open={v.isAddOpen} onOpenChange={v.setIsAddOpen}>
            <div className="flex gap-2">
              {v.visitors.length > 0 && <Button size="sm" variant="outline" onClick={v.handleExport} title="Export CSV"><Download size={16} /></Button>}
              <DrawerTrigger asChild><Button size="sm"><UserPlus size={16} className="mr-1" />Add</Button></DrawerTrigger>
            </div>
            <DrawerContent className="max-h-[85vh] overflow-y-auto">
              <DrawerHeader><DrawerTitle>Add Visitor</DrawerTitle><DrawerDescription>Pre-approve a visitor with an OTP for gate entry</DrawerDescription></DrawerHeader>
              <div className="space-y-4 py-4">
                <div><Label>Visitor Name *</Label><Input value={v.visitorName} onChange={e => v.setVisitorName(e.target.value)} placeholder="Enter name" /></div>
                <div><Label>Phone Number</Label><Input value={v.visitorPhone} onChange={e => v.setVisitorPhone(e.target.value)} placeholder="+91 XXXXX XXXXX" /></div>
                <div><Label>Visitor Type</Label><Select value={v.visitorType} onValueChange={v.setVisitorType}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{v.visitorTypes.map(vt => <SelectItem key={vt.type_key} value={vt.type_key}>{vt.label}</SelectItem>)}</SelectContent></Select></div>
                <div><Label>Purpose</Label><Input value={v.purpose} onChange={e => v.setPurpose(e.target.value)} placeholder="e.g., Family visit" /></div>
                <div className="grid grid-cols-2 gap-3">
                  <div><Label>Expected Date</Label><Input type="date" value={v.expectedDate} onChange={e => v.setExpectedDate(e.target.value)} /></div>
                  <div><Label>Expected Time</Label><Input type="time" value={v.expectedTime} onChange={e => v.setExpectedTime(e.target.value)} /></div>
                </div>
                <div><Label>Vehicle Number (optional)</Label><Input value={v.vehicleNumber} onChange={e => v.setVehicleNumber(e.target.value)} placeholder="MH 01 AB 1234" /></div>
                <div className="flex items-center justify-between py-2"><Label className="text-sm">Recurring Visitor</Label><Switch checked={v.isRecurring} onCheckedChange={v.setIsRecurring} /></div>
                {v.isRecurring && (
                  <div><Label className="text-xs">Active Days</Label><div className="flex flex-wrap gap-1.5 mt-1">{['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(day => (
                    <button key={day} type="button" onClick={() => v.setRecurringDays(prev => prev.includes(day) ? prev.filter(d => d !== day) : [...prev, day])} className={`px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${v.recurringDays.includes(day) ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'}`}>{day}</button>
                  ))}</div></div>
                )}
                <Button onClick={v.handleAddVisitor} disabled={!v.visitorName.trim() || v.isSubmitting} className="w-full">{v.isSubmitting ? <><Loader2 size={16} className="mr-1 animate-spin" /> Adding...</> : 'Add Visitor & Generate OTP'}</Button>
              </div>
            </DrawerContent>
          </Drawer>
          </CardContent>
        </Card>

        {/* Tabs */}
        <Tabs value={v.activeTab} onValueChange={v.setActiveTab}>
          <TabsList className="w-full grid grid-cols-3">
            <TabsTrigger value="today" className="text-xs">Today</TabsTrigger>
            <TabsTrigger value="upcoming" className="text-xs">Upcoming</TabsTrigger>
            <TabsTrigger value="history" className="text-xs">History</TabsTrigger>
          </TabsList>
          <TabsContent value={v.activeTab} className="mt-3 space-y-3">
            {v.isLoading ? Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-24 w-full rounded-xl" />) : v.visitors.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground"><Users className="mx-auto mb-3" size={32} /><p className="text-sm">No visitors {v.activeTab === 'today' ? 'expected today' : v.activeTab === 'upcoming' ? 'upcoming' : 'in history'}</p></div>
            ) : v.visitors.map(visitor => (
              <Card key={visitor.id}><CardContent className="p-4">
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-2"><p className="font-semibold">{visitor.visitor_name}</p><Badge variant="outline" className={`text-[10px] ${statusColors[visitor.status]}`}>{visitor.status.replace('_', ' ')}</Badge></div>
                    <div className="flex flex-wrap items-center gap-2 mt-1 text-xs text-muted-foreground">
                      <span className="capitalize">{v.getVisitorTypeLabel(visitor.visitor_type)}</span>
                      {visitor.visitor_phone && <span className="flex items-center gap-0.5"><Phone size={10} /> {visitor.visitor_phone}</span>}
                      {visitor.vehicle_number && <span className="flex items-center gap-0.5"><Car size={10} /> {visitor.vehicle_number}</span>}
                    </div>
                    {visitor.purpose && <p className="text-xs text-muted-foreground mt-1">{visitor.purpose}</p>}
                    {visitor.expected_time && <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1"><Clock size={10} /> {visitor.expected_time}</p>}
                  </div>
                  {visitor.otp_code && visitor.status === 'expected' && (
                    <button onClick={() => v.copyOTP(visitor.otp_code!)} className="flex flex-col items-center gap-1 bg-primary/10 rounded-lg px-3 py-2">
                      <span className="text-lg font-mono font-bold text-primary tracking-widest">{visitor.otp_code}</span>
                      <span className="text-[10px] text-muted-foreground flex items-center gap-0.5"><Copy size={8} /> Copy OTP</span>
                    </button>
                  )}
                </div>
                {visitor.status === 'expected' && (
                  <div className="flex gap-2 mt-3">
                    <Button size="sm" variant="default" className="flex-1" onClick={() => v.handleCheckIn(visitor.id)} disabled={v.loadingId === visitor.id}>{v.loadingId === visitor.id ? <Loader2 size={14} className="mr-1 animate-spin" /> : <LogIn size={14} className="mr-1" />} Check In</Button>
                    <ConfirmAction title="Cancel Visitor Entry?" description={`Cancel entry for ${visitor.visitor_name}?`} actionLabel="Cancel Entry" onConfirm={() => v.handleCancel(visitor.id)}><Button size="sm" variant="outline"><XCircle size={14} /></Button></ConfirmAction>
                  </div>
                )}
                {visitor.status === 'checked_in' && (
                  <ConfirmAction title="Check Out Visitor?" description={`Mark ${visitor.visitor_name} as checked out?`} actionLabel="Check Out" variant="default" onConfirm={() => v.handleCheckOut(visitor.id)}>
                    <Button size="sm" variant="outline" className="w-full mt-3"><LogOut size={14} className="mr-1" /> Check Out</Button>
                  </ConfirmAction>
                )}
                {visitor.checked_in_at && <p className="text-[10px] text-muted-foreground mt-2">In: {new Date(visitor.checked_in_at).toLocaleTimeString()}{visitor.checked_out_at && ` • Out: ${new Date(visitor.checked_out_at).toLocaleTimeString()}`}</p>}
              </CardContent></Card>
            ))}
          </TabsContent>
        </Tabs>
      </div>
      </FeatureGate>
    </AppLayout>
  );
}
