// @ts-nocheck
import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { AppLayout } from '@/components/layout/AppLayout';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import { friendlyError } from '@/lib/utils';
import { useRazorpay } from '@/hooks/useRazorpay';
import { CheckCircle2, Clock, AlertTriangle, Plus, Download, Loader2 } from 'lucide-react';
import { exportMaintenanceDues } from '@/lib/csv-export';
import { FeatureGate } from '@/components/ui/FeatureGate';
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerTrigger } from '@/components/ui/drawer';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useCurrency } from '@/hooks/useCurrency';

interface MaintenanceDue {
  id: string;
  flat_identifier: string;
  month: string;
  amount: number;
  late_fee: number | null;
  status: string;
  paid_date: string | null;
  created_at: string;
}

export default function MaintenancePage() {
  const { user, profile, isAdmin, isSocietyAdmin, effectiveSocietyId } = useAuth();
  const canManage = isAdmin || isSocietyAdmin;
  const { formatPrice, currencySymbol } = useCurrency();
  const { createOrder: razorpayOrder, isLoading: paymentLoading } = useRazorpay();
  const [dues, setDues] = useState<MaintenanceDue[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [generateMonth, setGenerateMonth] = useState('');
  const [generateAmount, setGenerateAmount] = useState('');
  const [generating, setGenerating] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [applyingLateFees, setApplyingLateFees] = useState(false);
  useEffect(() => {
    fetchDues();
  }, [user, profile]);

  const fetchDues = async () => {
    if (!effectiveSocietyId) return;
    const { data } = await supabase
      .from('maintenance_dues')
      .select('*')
      .eq('society_id', effectiveSocietyId)
      .order('month', { ascending: false })
      .limit(100);
    setDues((data as any) || []);
    setIsLoading(false);
  };

  const handleMarkPaid = async (id: string) => {
    if (!effectiveSocietyId) return;
    const { error } = await supabase
      .from('maintenance_dues')
      .update({ status: 'paid', paid_date: new Date().toISOString().split('T')[0] })
      .eq('id', id)
      .eq('society_id', effectiveSocietyId);
    if (error) { toast.error('Failed to update'); return; }
    toast.success('Marked as paid');
    fetchDues();
  };

  const [residentCount, setResidentCount] = useState<number | null>(null);
  const [showConfirm, setShowConfirm] = useState(false);

  const fetchResidentCount = async () => {
    const targetSocietyId = effectiveSocietyId || profile?.society_id;
    if (!targetSocietyId || !generateMonth || !generateAmount) return;
    setGenerating(true);
    try {
      const { data: residents, error } = await supabase
        .from('profiles')
        .select('id')
        .eq('society_id', targetSocietyId)
        .eq('verification_status', 'approved');
      if (error) throw error;
      if (!residents?.length) { toast.error('No approved residents found'); setGenerating(false); return; }
      setResidentCount(residents.length);
      setShowConfirm(true);
    } catch (err: any) {
      toast.error(friendlyError(err));
    } finally {
      setGenerating(false);
    }
  };

  const handleBulkGenerate = async () => {
    const targetSocietyId = effectiveSocietyId || profile?.society_id;
    if (!generateMonth || !generateAmount || !targetSocietyId) return;
    setGenerating(true);
    setShowConfirm(false);
    try {
      const { data: residents } = await supabase
        .from('profiles')
        .select('id, block, flat_number')
        .eq('society_id', targetSocietyId)
        .eq('verification_status', 'approved');

      if (!residents?.length) { toast.error('No approved residents found'); return; }

      const rows = residents.map(r => ({
        society_id: targetSocietyId,
        flat_identifier: `${r.block}-${r.flat_number}`,
        resident_id: r.id,
        month: generateMonth,
        amount: parseFloat(generateAmount),
        status: 'pending',
      }));

      const { error } = await supabase.from('maintenance_dues').insert(rows as any);
      if (error) throw error;
      toast.success(`Generated dues for ${rows.length} flats`);
      setSheetOpen(false);
      setGenerateMonth('');
      setGenerateAmount('');
      setResidentCount(null);
      fetchDues();
    } catch (err: any) {
      toast.error(friendlyError(err));
    } finally {
      setGenerating(false);
    }
  };

  const handleApplyLateFees = async () => {
    setApplyingLateFees(true);
    try {
      const { error } = await supabase.rpc('apply_maintenance_late_fees' as any);
      if (error) throw error;
      toast.success('Late fees applied to overdue records');
      fetchDues();
    } catch (err: any) {
      toast.error(friendlyError(err));
    } finally {
      setApplyingLateFees(false);
    }
  };

  const statusIcon = (status: string) => {
    if (status === 'paid') return <CheckCircle2 size={14} className="text-success" />;
    if (status === 'overdue') return <AlertTriangle size={14} className="text-destructive" />;
    return <Clock size={14} className="text-warning" />;
  };

  const statusBadge = (status: string) => {
    const variant = status === 'paid' ? 'default' : status === 'overdue' ? 'destructive' : 'secondary';
    return <Badge variant={variant} className="text-[10px]">{status}</Badge>;
  };

  // For residents, show only their own dues
  const displayDues = canManage ? dues : dues.filter(d => (d as any).resident_id === user?.id);

  return (
    <AppLayout headerTitle="Maintenance" showLocation={false}>
      <FeatureGate feature="maintenance">
      <div className="p-4 space-y-4">
        {canManage && (
          <div className="flex gap-2">
          <Drawer open={sheetOpen} onOpenChange={setSheetOpen}>
            <DrawerTrigger asChild>
              <Button className="w-full gap-2">
                <Plus size={16} /> Generate Monthly Dues
              </Button>
            </DrawerTrigger>
            <DrawerContent>
              <DrawerHeader>
                <DrawerTitle>Generate Monthly Dues</DrawerTitle>
              </DrawerHeader>
              <div className="space-y-4 mt-4">
                <div>
                  <label className="text-sm font-medium">Month (YYYY-MM)</label>
                  <Input 
                    value={generateMonth} 
                    onChange={e => setGenerateMonth(e.target.value)} 
                    placeholder="2026-02" 
                  />
                </div>
                <div>
                  <label className="text-sm font-medium">Amount per flat ({currencySymbol})</label>
                  <Input 
                    type="number" 
                    value={generateAmount} 
                    onChange={e => setGenerateAmount(e.target.value)} 
                    placeholder="5000" 
                  />
                </div>
                <Button className="w-full" disabled={generating || !generateMonth || !generateAmount} onClick={fetchResidentCount}>
                  {generating ? 'Checking...' : 'Preview & Generate'}
                </Button>
              </div>
            </DrawerContent>
          </Drawer>
          {dues.length > 0 && (
            <Button variant="outline" size="icon" onClick={() => exportMaintenanceDues(dues)} title="Export CSV">
              <Download size={16} />
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={handleApplyLateFees} disabled={applyingLateFees} title="Apply late fees to overdue dues">
            {applyingLateFees ? <Loader2 size={16} className="animate-spin" /> : <AlertTriangle size={16} />}
          </Button>
          </div>
        )}

        {/* Confirmation dialog for bulk generation */}
        <AlertDialog open={showConfirm} onOpenChange={setShowConfirm}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Confirm Dues Generation</AlertDialogTitle>
              <AlertDialogDescription>
                This will create dues for <strong>{residentCount}</strong> flats, totaling <strong>{formatPrice((residentCount || 0) * parseFloat(generateAmount || '0'))}</strong> for {generateMonth || 'the selected month'}.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={handleBulkGenerate}>
                Generate for All Flats
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {isLoading ? (
          <div className="space-y-2">
            {[1, 2, 3].map(i => <Skeleton key={i} className="h-16 w-full rounded-xl" />)}
          </div>
        ) : displayDues.length === 0 ? (
          <div className="text-center py-16 text-muted-foreground">
            <p className="font-medium">No maintenance records</p>
            <p className="text-sm mt-1">Records will appear here once generated</p>
          </div>
        ) : (
          <div className="space-y-2">
            {displayDues.map(d => (
              <Card key={d.id}>
                <CardContent className="p-4 flex items-center gap-3">
                  {statusIcon(d.status)}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="font-medium text-sm">{d.flat_identifier}</p>
                      {statusBadge(d.status)}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {d.month} · {formatPrice(d.amount)}
                      {d.late_fee ? ` + ${formatPrice(d.late_fee)} late fee` : ''}
                      {d.paid_date && ` · Paid ${d.paid_date}`}
                    </p>
                  </div>
                  {canManage && d.status !== 'paid' && (
                    <Button size="sm" variant="outline" className="text-xs" onClick={() => handleMarkPaid(d.id)}>
                      Mark Paid
                    </Button>
                  )}
                  {!canManage && d.status !== 'paid' && (
                    <Button
                      size="sm"
                      className="text-xs"
                      disabled={paymentLoading}
                      onClick={() => {
                        razorpayOrder({
                          orderId: d.id,
                          amount: d.amount,
                          sellerId: d.id,
                          customerName: profile?.name || '',
                          customerEmail: '',
                          customerPhone: profile?.phone || '',
                          businessName: 'Maintenance Dues',
                          onSuccess: async (paymentId) => {
                            await supabase.from('maintenance_dues')
                              .update({ status: 'paid', paid_date: new Date().toISOString().split('T')[0], receipt_url: paymentId })
                              .eq('id', d.id);
                            toast.success('Payment successful!');
                            fetchDues();
                          },
                          onFailure: () => toast.error('Payment failed'),
                        });
                      }}
                    >
                      Pay {formatPrice(d.amount)}
                    </Button>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
      </FeatureGate>
    </AppLayout>
  );
}
