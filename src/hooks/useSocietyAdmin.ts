// @ts-nocheck
import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { escapeIlike } from '@/lib/query-utils';
import { useAuth } from '@/contexts/AuthContext';
import { Profile, SellerProfile, VerificationStatus, SocietyAdmin } from '@/types/database';
import { useEffectiveFeatures } from '@/hooks/useEffectiveFeatures';
import { toast } from 'sonner';
import { logAudit } from '@/lib/audit';
import { notifySellerStatusChange } from '@/lib/admin-notifications';
import { notify } from '@/lib/notify';

export function useSocietyAdmin() {
  const { profile, effectiveSociety, effectiveSocietyId, isSocietyAdmin, isAdmin } = useAuth();
  const [pendingUsers, setPendingUsers] = useState<Profile[]>([]);
  const [pendingSellers, setPendingSellers] = useState<SellerProfile[]>([]);
  const [societyAdmins, setSocietyAdmins] = useState<(SocietyAdmin & { user?: { name: string } })[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [autoApprove, setAutoApprove] = useState(false);
  const [approvalMethod, setApprovalMethod] = useState('manual');
  const [appointOpen, setAppointOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<Profile[]>([]);
  const features = useEffectiveFeatures();

  const societyId = effectiveSocietyId;

  useEffect(() => {
    if (!societyId || (!isSocietyAdmin && !isAdmin)) return;
    fetchData();
  }, [societyId, isSocietyAdmin, isAdmin]);

  useEffect(() => {
    if (effectiveSociety) {
      setAutoApprove(effectiveSociety.auto_approve_residents || false);
      setApprovalMethod(effectiveSociety.approval_method || 'manual');
    }
  }, [effectiveSociety]);

  const fetchData = async () => {
    if (!societyId) return;
    try {
      const [usersRes, sellersRes, adminsRes] = await Promise.all([
        supabase.from('profiles').select('*').eq('society_id', societyId).eq('verification_status', 'pending'),
        supabase.from('seller_profiles').select('*, profile:profiles!seller_profiles_user_id_fkey(name, block, flat_number)').eq('society_id', societyId).eq('verification_status', 'pending'),
        supabase.from('society_admins').select('*, user:profiles!society_admins_user_id_fkey(name)').eq('society_id', societyId).is('deactivated_at', null),
      ]);
      setPendingUsers((usersRes.data as Profile[]) || []);
      setPendingSellers((sellersRes.data as any) || []);
      setSocietyAdmins((adminsRes.data as any) || []);
    } catch (error) {
      console.error('Error:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const updateUserStatus = async (id: string, status: VerificationStatus) => {
    if (!societyId) return;
    try {
      await supabase.from('profiles').update({ verification_status: status }).eq('id', id);
      await logAudit(`user_${status}`, 'profile', id, societyId, { status });
      toast.success(`User ${status}`);
      fetchData();
    } catch { toast.error('Failed to update'); }
  };

  const updateSellerStatus = async (id: string, status: VerificationStatus, rejectionNote?: string) => {
    if (!societyId) return;
    try {
      // Fetch seller details for notification
      const { data: seller } = await supabase
        .from('seller_profiles')
        .select('user_id, business_name')
        .eq('id', id)
        .single();
      if (!seller) throw new Error('Seller not found');

      if (status === 'approved') {
        const { approveSeller } = await import('@/lib/seller-approval');
        await approveSeller({
          sellerId: id,
          userId: seller.user_id,
          businessName: seller.business_name,
          societyId,
        });
      } else if (status === 'rejected' || status === 'suspended') {
        const { rejectOrSuspendSeller } = await import('@/lib/seller-approval');
        await rejectOrSuspendSeller(
          id, seller.user_id, seller.business_name,
          status as 'rejected' | 'suspended',
          rejectionNote?.trim() || undefined, societyId || undefined,
        );
      }

      toast.success(`Seller ${status}`);
      fetchData();
    } catch (error: any) {
      const msg = error?.message || '';
      if (msg.includes('location') || msg.includes('Cannot approve')) {
        toast.error(msg || 'Cannot approve: Store has no location set. Ask seller to set their store location first.');
      } else {
        toast.error('Failed to update seller status');
      }
    }
  };

  const updateSocietySettings = async (field: string, value: any) => {
    if (!societyId) return;
    try {
      await supabase.from('societies').update({ [field]: value }).eq('id', societyId);
      await logAudit('settings_changed', 'society', societyId, societyId, { field, value });
      toast.success('Settings updated');
    } catch { toast.error('Failed to update settings'); }
  };

  const searchResidents = async (query: string) => {
    setSearchQuery(query);
    if (query.length < 2 || !societyId) { setSearchResults([]); return; }
    const { data } = await supabase.from('profiles').select('*').eq('society_id', societyId).eq('verification_status', 'approved').ilike('name', `%${escapeIlike(query)}%`).limit(10);
    setSearchResults((data as Profile[]) || []);
  };

  const appointAdmin = async (userId: string, role: 'admin' | 'moderator') => {
    if (!societyId || !profile) return;
    try {
      await supabase.from('society_admins').insert({ society_id: societyId, user_id: userId, role, appointed_by: profile.id });
      await logAudit('admin_appointed', 'society_admin', userId, societyId, { role });
      toast.success('Admin appointed');
      setAppointOpen(false); setSearchQuery(''); setSearchResults([]); fetchData();
    } catch (error: any) {
      if (error?.code === '23505') toast.error('This user is already an admin');
      else if (error?.message?.includes('Maximum number')) toast.error('Maximum admin limit reached for this society');
      else toast.error('Failed to appoint admin');
    }
  };

  const removeAdmin = async (adminId: string) => {
    if (!societyId) return;
    const activeAdmins = societyAdmins.filter(a => !a.deactivated_at);
    if (activeAdmins.length <= 1) {
      notify.block('Cannot remove the last admin. Appoint another admin first.');
      return;
    }
    try {
      await supabase.from('society_admins').update({ deactivated_at: new Date().toISOString() }).eq('id', adminId);
      await logAudit('admin_removed', 'society_admin', adminId, societyId);
      toast.success('Admin removed'); fetchData();
    } catch { toast.error('Failed to remove admin'); }
  };

  return {
    profile, effectiveSociety, societyId, isSocietyAdmin, isAdmin,
    pendingUsers, pendingSellers, societyAdmins,
    isLoading, autoApprove, setAutoApprove, approvalMethod, setApprovalMethod,
    appointOpen, setAppointOpen, searchQuery, searchResults,
    ...features,
    updateUserStatus, updateSellerStatus, updateSocietySettings,
    searchResidents, appointAdmin, removeAdmin,
  };
}
