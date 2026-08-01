// @ts-nocheck
import { useState, useEffect, useMemo, useCallback } from 'react';
import { useLocation } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Profile, SellerProfile, Review, PaymentRecord, VerificationStatus, PaymentStatus, Society } from '@/types/database';
import { useStatusLabels } from '@/hooks/useStatusLabels';
import { useCurrency } from '@/hooks/useCurrency';
import { logAudit } from '@/lib/audit';
import { notifySellerStatusChange } from '@/lib/admin-notifications';
import { toast } from 'sonner';

interface Report {
  id: string;
  reporter_id: string;
  reported_user_id: string | null;
  reported_seller_id: string | null;
  report_type: string;
  description: string | null;
  status: string;
  admin_notes: string | null;
  created_at: string;
  reporter?: { name: string };
  reported_user?: { name: string } | null;
  reported_seller?: { business_name: string } | null;
}

interface Warning {
  id: string;
  user_id: string;
  issued_by: string;
  reason: string;
  severity: string;
  acknowledged_at: string | null;
  created_at: string;
  user?: { name: string };
}

const PAGE_SIZE = 50;

/**
 * Tab-lazy admin data hook.
 * Only fetches stats + sellers on mount. Other datasets (reviews, payments, reports, warnings, societies)
 * are loaded on-demand when their tab becomes active.
 */
export function useAdminData() {
  const location = useLocation();
  const { getPaymentStatus } = useStatusLabels();
  const { formatPrice } = useCurrency();
  const tabParam = useMemo(() => new URLSearchParams(location.search).get('tab'), [location.search]);
  const [activeTab, setActiveTab] = useState(tabParam || 'sellers');

  const [pendingUsers, setPendingUsers] = useState<Profile[]>([]);
  const [pendingSellers, setPendingSellers] = useState<SellerProfile[]>([]);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [allSellers, setAllSellers] = useState<SellerProfile[]>([]);
  const [payments, setPayments] = useState<PaymentRecord[]>([]);
  const [reports, setReports] = useState<Report[]>([]);
  const [warnings, setWarnings] = useState<Warning[]>([]);
  const [allSocieties, setAllSocieties] = useState<Society[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [stats, setStats] = useState({ users: 0, sellers: 0, orders: 0, reviews: 0, revenue: 0, pendingReports: 0, societies: 0 });

  const [selectedReview, setSelectedReview] = useState<Review | null>(null);
  const [selectedReport, setSelectedReport] = useState<Report | null>(null);
  const [selectedUserForWarning, setSelectedUserForWarning] = useState<string | null>(null);
  const [warningReason, setWarningReason] = useState('');
  const [warningSeverity, setWarningSeverity] = useState<'warning' | 'final_warning'>('warning');
  const [selectedChat, setSelectedChat] = useState<string | null>(null);
  const [chatMessages, setChatMessages] = useState<any[]>([]);
  const [hideReason, setHideReason] = useState('');
  const [adminNotes, setAdminNotes] = useState('');
  const [paymentFilter, setPaymentFilter] = useState<string>('all');

  const [hasMoreReviews, setHasMoreReviews] = useState(true);
  const [hasMorePayments, setHasMorePayments] = useState(true);
  const [hasMoreReports, setHasMoreReports] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);

  // Track which tabs have been loaded to avoid re-fetching
  const [loadedTabs, setLoadedTabs] = useState<Set<string>>(new Set());

  // Core data: stats + pending sellers (always needed for badge counts)
  const fetchCoreData = useCallback(async () => {
    try {
      const [usersRes, sellersRes, allSellersRes, statsRes] = await Promise.all([
        supabase.from('profiles').select('*, society:societies!profiles_society_id_fkey(name)').eq('verification_status', 'pending'),
        supabase.from('seller_profiles').select('*, profile:profiles!seller_profiles_user_id_fkey(name, block, flat_number)').eq('verification_status', 'pending'),
        supabase.from('seller_profiles').select('*, profile:profiles!seller_profiles_user_id_fkey(name, block)').eq('verification_status', 'approved'),
        Promise.all([
          supabase.from('profiles').select('id', { count: 'exact', head: true }),
          supabase.from('seller_profiles').select('id', { count: 'exact', head: true }).eq('verification_status', 'approved'),
          supabase.from('orders').select('id', { count: 'exact', head: true }),
          supabase.from('reviews').select('id', { count: 'exact', head: true }),
          supabase.from('payment_records').select('amount').eq('payment_status', 'paid'),
          supabase.from('reports').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
          supabase.from('societies').select('id', { count: 'exact', head: true }),
        ]),
      ]);

      setPendingUsers((usersRes.data as any) || []);
      setPendingSellers((sellersRes.data as any) || []);
      setAllSellers((allSellersRes.data as any) || []);
      const totalRevenue = (statsRes[4].data || []).reduce((sum: number, p: any) => sum + Number(p.amount), 0);
      setStats({ users: statsRes[0].count || 0, sellers: statsRes[1].count || 0, orders: statsRes[2].count || 0, reviews: statsRes[3].count || 0, revenue: totalRevenue, pendingReports: statsRes[5].count || 0, societies: statsRes[6].count || 0 });
    } catch (error) { console.error('Error:', error); }
    finally { setIsLoading(false); }
  }, []);

  // Tab-specific data loaders
  const fetchReviews = useCallback(async () => {
    const { data } = await supabase.from('reviews').select('*, buyer:profiles!reviews_buyer_id_fkey(name), seller:seller_profiles(business_name)').order('created_at', { ascending: false }).limit(PAGE_SIZE);
    const reviewsData = (data as any) || [];
    setReviews(reviewsData);
    setHasMoreReviews(reviewsData.length >= PAGE_SIZE);
  }, []);

  const fetchPayments = useCallback(async () => {
    const { data } = await supabase.from('payment_records').select('*, seller:seller_profiles(business_name), order:orders(buyer:profiles!orders_buyer_id_fkey(name))').order('created_at', { ascending: false }).limit(PAGE_SIZE);
    const paymentsData = (data as any) || [];
    setPayments(paymentsData);
    setHasMorePayments(paymentsData.length >= PAGE_SIZE);
  }, []);

  const fetchReports = useCallback(async () => {
    const { data } = await supabase.from('reports').select('*, reporter:profiles!reports_reporter_id_fkey(name), reported_seller:seller_profiles(business_name)').order('created_at', { ascending: false }).limit(PAGE_SIZE);
    const reportsData = (data as any) || [];
    setReports(reportsData);
    setHasMoreReports(reportsData.length >= PAGE_SIZE);
  }, []);

  const fetchWarnings = useCallback(async () => {
    const { data } = await supabase.from('warnings').select('*, user:profiles!warnings_user_id_fkey(name)').order('created_at', { ascending: false }).limit(PAGE_SIZE);
    setWarnings((data as any) || []);
  }, []);

  const fetchSocieties = useCallback(async () => {
    const { data } = await supabase.from('societies').select('*').order('created_at', { ascending: false });
    setAllSocieties((data as Society[]) || []);
  }, []);

  // Load core data on mount
  useEffect(() => { fetchCoreData(); }, []);

  // Lazy-load tab data when tab changes
  useEffect(() => {
    if (loadedTabs.has(activeTab)) return;
    const load = async () => {
      switch (activeTab) {
        case 'reviews': await fetchReviews(); break;
        case 'payments': await fetchPayments(); break;
        case 'reports': await fetchReports(); break;
        case 'warnings': await fetchWarnings(); break;
        case 'societies': await fetchSocieties(); break;
      }
      setLoadedTabs(prev => new Set(prev).add(activeTab));
    };
    load();
  }, [activeTab]);

  // Full refresh (used after mutations)
  const fetchData = useCallback(async () => {
    setLoadedTabs(new Set());
    await fetchCoreData();
  }, [fetchCoreData]);

  const loadMoreReviews = async () => {
    if (!hasMoreReviews || isLoadingMore) return;
    setIsLoadingMore(true);
    const lastItem = reviews[reviews.length - 1];
    const { data } = await supabase.from('reviews').select('*, buyer:profiles!reviews_buyer_id_fkey(name), seller:seller_profiles(business_name)').order('created_at', { ascending: false }).lt('created_at', lastItem.created_at).limit(PAGE_SIZE);
    const newItems = (data as any) || [];
    setReviews(prev => [...prev, ...newItems]);
    setHasMoreReviews(newItems.length >= PAGE_SIZE);
    setIsLoadingMore(false);
  };

  const loadMorePayments = async () => {
    if (!hasMorePayments || isLoadingMore) return;
    setIsLoadingMore(true);
    const lastItem = payments[payments.length - 1];
    const { data } = await supabase.from('payment_records').select('*, seller:seller_profiles(business_name), order:orders(buyer:profiles!orders_buyer_id_fkey(name))').order('created_at', { ascending: false }).lt('created_at', lastItem.created_at).limit(PAGE_SIZE);
    const newItems = (data as any) || [];
    setPayments(prev => [...prev, ...newItems]);
    setHasMorePayments(newItems.length >= PAGE_SIZE);
    setIsLoadingMore(false);
  };

  const loadMoreReports = async () => {
    if (!hasMoreReports || isLoadingMore) return;
    setIsLoadingMore(true);
    const lastItem = reports[reports.length - 1];
    const { data } = await supabase.from('reports').select('*, reporter:profiles!reports_reporter_id_fkey(name), reported_seller:seller_profiles(business_name)').order('created_at', { ascending: false }).lt('created_at', lastItem.created_at).limit(PAGE_SIZE);
    const newItems = (data as any) || [];
    setReports(prev => [...prev, ...newItems]);
    setHasMoreReports(newItems.length >= PAGE_SIZE);
    setIsLoadingMore(false);
  };

  const updateUserStatus = async (id: string, status: VerificationStatus) => {
    try {
      await supabase.from('profiles').update({ verification_status: status }).eq('id', id);
      await logAudit(`user_${status}`, 'profile', id, '', { status });
      toast.success(`User ${status}`);
      fetchData();
    } catch { toast.error('Failed to update'); }
  };

  const updateSellerStatus = async (id: string, status: VerificationStatus) => {
    try {
      const { data: seller } = await supabase.from('seller_profiles').select('user_id, business_name, latitude, longitude, society_id').eq('id', id).single();
      if (!seller) throw new Error('Seller not found');

      // Location validation is now handled inside approveSeller() — single source of truth

      if (status === 'approved') {
        const { approveSeller } = await import('@/lib/seller-approval');
        await approveSeller({ sellerId: id, userId: seller.user_id, businessName: seller.business_name });
      } else if (status === 'rejected' || status === 'suspended') {
        const { rejectOrSuspendSeller } = await import('@/lib/seller-approval');
        await rejectOrSuspendSeller(id, seller.user_id, seller.business_name, status as 'rejected' | 'suspended', adminNotes.trim() || undefined);
      }

      toast.success(`Seller ${status}`);
      fetchData();
    } catch (error: any) {
      const msg = error?.message || '';
      if (msg.includes('location') || msg.includes('Cannot approve')) {
        toast.error(msg || 'Cannot approve: Store has no location coordinates.');
      } else {
        console.error('Error updating seller status:', error);
        toast.error('Failed to update');
      }
    }
  };

  const toggleSellerFeatured = async (seller: SellerProfile) => {
    try {
      await supabase.from('seller_profiles').update({ is_featured: !seller.is_featured }).eq('id', seller.id);
      toast.success(seller.is_featured ? 'Removed from featured' : 'Added to featured');
      fetchData();
    } catch { toast.error('Failed to update'); }
  };

  const toggleReviewHidden = async (review: Review, hide: boolean) => {
    try {
      await supabase.from('reviews').update({ is_hidden: hide, hidden_reason: hide ? hideReason : null }).eq('id', review.id);
      await logAudit(hide ? 'review_hidden' : 'review_restored', 'review', review.id, '', { reason: hideReason });
      toast.success(hide ? 'Review hidden' : 'Review restored');
      setSelectedReview(null);
      setHideReason('');
      fetchData();
    } catch { toast.error('Failed to update'); }
  };

  const updateReportStatus = async (report: Report, status: string) => {
    try {
      await supabase.from('reports').update({ status, admin_notes: adminNotes || null }).eq('id', report.id);
      await logAudit(`report_${status}`, 'report', report.id, '', { admin_notes: adminNotes });
      toast.success(`Report ${status}`);
      setSelectedReport(null);
      setAdminNotes('');
      fetchData();
    } catch { toast.error('Failed to update report'); }
  };

  const issueWarning = async (userId: string) => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');
      await supabase.from('warnings').insert({ user_id: userId, issued_by: user.id, reason: warningReason, severity: warningSeverity });
      await logAudit('warning_issued', 'profile', userId, '', { reason: warningReason, severity: warningSeverity });
      toast.success('Warning issued');
      setSelectedUserForWarning(null);
      setWarningReason('');
      setWarningSeverity('warning');
      fetchData();
    } catch { toast.error('Failed to issue warning'); }
  };

  const updateSocietyStatus = async (id: string, is_verified: boolean, is_active: boolean) => {
    try {
      await supabase.from('societies').update({ is_verified, is_active }).eq('id', id);
      await logAudit('society_status_changed', 'society', id, '', { is_verified, is_active });
      toast.success(is_verified ? 'Society approved' : 'Society updated');
      fetchData();
    } catch { toast.error('Failed to update society'); }
  };

  const fetchChatForOrder = async (orderId: string) => {
    const { data } = await supabase.from('chat_messages').select('*, sender:profiles!chat_messages_sender_id_fkey(name)').eq('order_id', orderId).order('created_at', { ascending: true });
    setChatMessages(data || []);
    setSelectedChat(orderId);
  };

  const filteredPayments = paymentFilter === 'all' ? payments : payments.filter(p => p.payment_status === paymentFilter || p.payment_method === paymentFilter);

  return {
    activeTab, setActiveTab, pendingUsers, pendingSellers, reviews, allSellers, payments: filteredPayments,
    reports, warnings, allSocieties, isLoading, stats, selectedReview, setSelectedReview,
    selectedReport, setSelectedReport, selectedUserForWarning, setSelectedUserForWarning,
    warningReason, setWarningReason, warningSeverity, setWarningSeverity, selectedChat, setSelectedChat,
    chatMessages, hideReason, setHideReason, adminNotes, setAdminNotes, paymentFilter, setPaymentFilter,
    hasMoreReviews, hasMorePayments, hasMoreReports, isLoadingMore, formatPrice, getPaymentStatus,
    fetchData, loadMoreReviews, loadMorePayments, loadMoreReports, updateUserStatus, updateSellerStatus,
    toggleSellerFeatured, toggleReviewHidden, updateReportStatus, issueWarning, updateSocietyStatus,
    fetchChatForOrder,
  };
}