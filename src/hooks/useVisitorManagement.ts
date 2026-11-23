// @ts-nocheck
import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useActionLoading } from '@/hooks/useActionLoading';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { friendlyError } from '@/lib/utils';
import { exportVisitorLog } from '@/lib/csv-export';
import { showFeedback } from '@/components/FeedbackPopupProvider';
import { isVisitorRpcAvailable } from '@/lib/society-membership';

type VisitorStatus = 'expected' | 'checked_in' | 'checked_out' | 'cancelled' | 'expired';

export interface VisitorTypeConfig {
  type_key: string;
  label: string;
  icon: string | null;
}

export interface VisitorEntry {
  id: string;
  visitor_name: string;
  visitor_phone: string | null;
  visitor_type: string;
  purpose: string | null;
  expected_date: string | null;
  expected_time: string | null;
  otp_code: string | null;
  is_preapproved: boolean;
  is_recurring: boolean;
  recurring_days: string[] | null;
  status: VisitorStatus;
  checked_in_at: string | null;
  checked_out_at: string | null;
  vehicle_number: string | null;
  flat_number: string | null;
  created_at: string;
}

const FALLBACK_VISITOR_TYPES: VisitorTypeConfig[] = [
  { type_key: 'guest', label: 'Guest', icon: null },
  { type_key: 'delivery', label: 'Delivery', icon: null },
  { type_key: 'cab', label: 'Cab/Ride', icon: null },
  { type_key: 'domestic_help', label: 'Domestic Help', icon: null },
  { type_key: 'contractor', label: 'Contractor', icon: null },
];

export const statusColors: Record<VisitorStatus, string> = {
  expected: 'bg-warning/10 text-warning',
  checked_in: 'bg-success/10 text-success',
  checked_out: 'bg-muted text-muted-foreground',
  cancelled: 'bg-destructive/10 text-destructive',
  expired: 'bg-muted text-muted-foreground',
};

function generateOTP(): string {
  const arr = new Uint32Array(1);
  crypto.getRandomValues(arr);
  return (100000 + (arr[0] % 900000)).toString();
}

export function useVisitorManagement() {
  const { user, profile, effectiveSocietyId } = useAuth();
  const [visitors, setVisitors] = useState<VisitorEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [activeTab, setActiveTab] = useState('today');
  const { loadingId, withLoading } = useActionLoading();
  const [searchQuery, setSearchQuery] = useState('');

  const { data: visitorTypes = FALLBACK_VISITOR_TYPES } = useQuery({
    queryKey: ['visitor-types', effectiveSocietyId],
    queryFn: async () => {
      if (!effectiveSocietyId) return FALLBACK_VISITOR_TYPES;
      const { data, error } = await supabase.rpc('get_visitor_types_for_society', { _society_id: effectiveSocietyId });
      if (error || !data?.length) return FALLBACK_VISITOR_TYPES;
      return data as VisitorTypeConfig[];
    },
    enabled: !!effectiveSocietyId,
    staleTime: 5 * 60 * 1000,
  });

  const getVisitorTypeLabel = (typeKey: string) => {
    const found = visitorTypes.find(vt => vt.type_key === typeKey);
    return found?.label || typeKey.replace('_', ' ');
  };

  // Form state
  const [visitorName, setVisitorName] = useState('');
  const [visitorPhone, setVisitorPhone] = useState('');
  const [visitorType, setVisitorType] = useState('guest');
  const [purpose, setPurpose] = useState('');
  const [vehicleNumber, setVehicleNumber] = useState('');
  const [expectedDate, setExpectedDate] = useState(new Date().toISOString().split('T')[0]);
  const [expectedTime, setExpectedTime] = useState('');
  const [isPreapproved, setIsPreapproved] = useState(true);
  const [isRecurring, setIsRecurring] = useState(false);
  const [recurringDays, setRecurringDays] = useState<string[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const fetchVisitors = useCallback(async () => {
    if (!effectiveSocietyId || !user) return;
    setIsLoading(true);
    const today = new Date().toISOString().split('T')[0];
    let query = supabase.from('visitor_entries').select(
      'id, visitor_name, visitor_phone, visitor_type, purpose, expected_date, expected_time, is_preapproved, is_recurring, recurring_days, status, checked_in_at, checked_out_at, vehicle_number, flat_number, created_at'
    ).eq('resident_id', user.id).order('created_at', { ascending: false });
    if (activeTab === 'today') query = query.eq('expected_date', today);
    else if (activeTab === 'upcoming') query = query.gt('expected_date', today);
    else if (activeTab === 'history') query = query.in('status', ['checked_out', 'cancelled', 'expired']);
    const { data, error } = await query.limit(50);
    if (error) { toast.error('Could not load visitors. Please try again.'); console.error(error); }
    let rows = (data as VisitorEntry[]) || [];
    if (isVisitorRpcAvailable() && rows.some((row) => row.status === 'expected' && !row.otp_code)) {
      const { data: otps } = await supabase.rpc('visitor_list_own_otps' as never);
      const map = (otps || {}) as Record<string, string>;
      rows = rows.map((row) => (
        row.otp_code || !map[row.id] ? row : { ...row, otp_code: map[row.id] }
      ));
    }
    setVisitors(rows);
    setIsLoading(false);
  }, [effectiveSocietyId, user, activeTab]);

  useEffect(() => { fetchVisitors(); }, [fetchVisitors]);

  const resetForm = () => {
    setVisitorName(''); setVisitorPhone(''); setVisitorType(visitorTypes[0]?.type_key || 'guest');
    setPurpose(''); setVehicleNumber(''); setExpectedDate(new Date().toISOString().split('T')[0]);
    setExpectedTime(''); setIsPreapproved(true); setIsRecurring(false); setRecurringDays([]);
  };

  const handleAddVisitor = async () => {
    if (!visitorName.trim() || !user || !effectiveSocietyId) return;
    setIsSubmitting(true);
    // Staging: server OTP RPC only. Production keeps legacy path until RPC is promoted.
    if (isVisitorRpcAvailable()) {
      const { data, error } = await supabase.rpc('visitor_create_entry' as never, {
        _visitor_name: visitorName.trim(),
        _visitor_phone: visitorPhone || null,
        _visitor_type: visitorType,
        _purpose: purpose || null,
        _expected_date: expectedDate || null,
        _expected_time: expectedTime || null,
        _is_preapproved: isPreapproved,
        _is_recurring: isRecurring,
        _recurring_days: isRecurring && recurringDays.length > 0 ? recurringDays : null,
        _vehicle_number: vehicleNumber || null,
      } as never);
      if (error) { toast.error(friendlyError(error)); }
      else {
        const otp = (data as { otp_code?: string } | null)?.otp_code;
        showFeedback({ title: `Visitor added${otp ? ` OTP: ${otp}` : ''}`, variant: 'success' });
        setIsAddOpen(false); resetForm(); fetchVisitors();
      }
      setIsSubmitting(false);
      return;
    }
    // Legacy production-compatible path (not used when connected to staging).
    const otp = generateOTP();
    const { error } = await supabase.from('visitor_entries').insert({
      society_id: effectiveSocietyId, resident_id: user.id, visitor_name: visitorName.trim(),
      visitor_phone: visitorPhone || null, visitor_type: visitorType, purpose: purpose || null,
      expected_date: expectedDate || null, expected_time: expectedTime || null,
      otp_code: isPreapproved ? otp : null, otp_expires_at: isPreapproved ? new Date(Date.now() + 24 * 3600000).toISOString() : null,
      is_preapproved: isPreapproved, is_recurring: isRecurring,
      recurring_days: isRecurring && recurringDays.length > 0 ? recurringDays : null,
      vehicle_number: vehicleNumber || null, flat_number: profile?.flat_number || null, status: 'expected',
    });
    if (error) { toast.error(friendlyError(error)); }
    else { showFeedback({ title: `Visitor added${isPreapproved ? ` OTP: ${otp}` : ''}`, variant: 'success' }); setIsAddOpen(false); resetForm(); fetchVisitors(); }
    setIsSubmitting(false);
  };

  const handleCheckIn = withLoading(async (id: string) => {
    if (!user) return;
    if (isVisitorRpcAvailable()) {
      toast.error('The guard must redeem the visitor OTP at the gate. Residents cannot skip check-in.');
      return;
    }
    const { error } = await supabase.from('visitor_entries').update({ status: 'checked_in', checked_in_at: new Date().toISOString() }).eq('id', id).eq('resident_id', user.id);
    if (!error) { showFeedback({ title: 'Visitor checked in' }); fetchVisitors(); }
  });

  const handleCheckOut = async (id: string) => {
    if (!user) return;
    if (isVisitorRpcAvailable()) {
      const { error } = await supabase.rpc('visitor_set_status' as never, { _id: id, _status: 'checked_out' } as never);
      if (!error) { showFeedback({ title: 'Visitor checked out' }); fetchVisitors(); }
      else toast.error(friendlyError(error));
      return;
    }
    const { error } = await supabase.from('visitor_entries').update({ status: 'checked_out', checked_out_at: new Date().toISOString() }).eq('id', id).eq('resident_id', user.id);
    if (!error) { showFeedback({ title: 'Visitor checked out' }); fetchVisitors(); }
  };

  const handleCancel = async (id: string) => {
    if (!user) return;
    if (isVisitorRpcAvailable()) {
      const { error } = await supabase.rpc('visitor_set_status' as never, { _id: id, _status: 'cancelled' } as never);
      if (!error) { showFeedback({ title: 'Visitor entry cancelled' }); fetchVisitors(); }
      else toast.error(friendlyError(error));
      return;
    }
    const { error } = await supabase.from('visitor_entries').update({ status: 'cancelled' }).eq('id', id).eq('resident_id', user.id);
    if (!error) { showFeedback({ title: 'Visitor entry cancelled' }); fetchVisitors(); }
  };

  const copyOTP = (otp: string) => { navigator.clipboard.writeText(otp); showFeedback({ title: 'OTP copied to clipboard' }); };

  const todayCount = visitors.filter(v => v.status === 'expected' || v.status === 'checked_in').length;

  const handleExport = () => exportVisitorLog(visitors);

  return {
    visitors, isLoading, isAddOpen, setIsAddOpen, activeTab, setActiveTab,
    loadingId, searchQuery, setSearchQuery, visitorTypes,
    getVisitorTypeLabel, todayCount,
    // Form
    visitorName, setVisitorName, visitorPhone, setVisitorPhone,
    visitorType, setVisitorType, purpose, setPurpose,
    vehicleNumber, setVehicleNumber, expectedDate, setExpectedDate,
    expectedTime, setExpectedTime, isPreapproved, setIsPreapproved,
    isRecurring, setIsRecurring, recurringDays, setRecurringDays,
    isSubmitting,
    // Actions
    handleAddVisitor, handleCheckIn, handleCheckOut, handleCancel, copyOTP, handleExport,
  };
}
