// @ts-nocheck
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { escapeIlike } from '@/lib/query-utils';

export interface GateAuditFilters {
  dateFrom?: string;
  dateTo?: string;
  entryType?: string;
  confirmationStatus?: string;
  residentName?: string;
  officerId?: string;
  page: number;
  pageSize: number;
}

export interface GateAuditMetrics {
  totalToday: number;
  manualCount: number;
  manualPercent: number;
  deniedCount: number;
  deniedPercent: number;
  avgConfirmationMs: number | null;
}

export function useGateAudit(societyId: string | null, filters: GateAuditFilters) {
  return useQuery({
    queryKey: ['gate-audit', societyId, filters],
    queryFn: async () => {
      if (!societyId) return { entries: [], total: 0 };

      let query = supabase
        .from('gate_entries')
        .select('*', { count: 'exact' })
        .eq('society_id', societyId)
        .order('entry_time', { ascending: false })
        .range(
          filters.page * filters.pageSize,
          (filters.page + 1) * filters.pageSize - 1
        );

      if (filters.dateFrom) {
        query = query.gte('entry_time', filters.dateFrom);
      }
      if (filters.dateTo) {
        query = query.lte('entry_time', filters.dateTo + 'T23:59:59');
      }
      if (filters.entryType) {
        query = query.eq('entry_type', filters.entryType);
      }
      if (filters.confirmationStatus) {
        query = query.eq('confirmation_status', filters.confirmationStatus);
      }
      if (filters.residentName) {
        query = query.ilike('resident_name', `%${escapeIlike(filters.residentName)}%`);
      }
      if (filters.officerId) {
        query = query.eq('verified_by', filters.officerId);
      }

      const { data, count, error } = await query;
      if (error) throw error;

      return { entries: data || [], total: count || 0 };
    },
    enabled: !!societyId,
    staleTime: 30 * 1000,
  });
}

export function useGateAuditMetrics(societyId: string | null) {
  return useQuery({
    queryKey: ['gate-audit-metrics', societyId],
    queryFn: async () => {
      if (!societyId) return null;

      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);

      const { data: todayEntries } = await supabase
        .from('gate_entries')
        .select('entry_type, confirmation_status, confirmed_by_resident_at, created_at')
        .eq('society_id', societyId)
        .gte('entry_time', todayStart.toISOString());

      const entries = todayEntries || [];
      const totalToday = entries.length;
      const manualCount = entries.filter(e => e.entry_type === 'manual').length;
      const deniedCount = entries.filter(e => e.confirmation_status === 'denied').length;

      // Calculate avg confirmation time
      const confirmed = entries.filter(e => e.confirmed_by_resident_at && e.created_at);
      let avgConfirmationMs: number | null = null;
      if (confirmed.length > 0) {
        const totalMs = confirmed.reduce((sum, e) => {
          return sum + (new Date(e.confirmed_by_resident_at!).getTime() - new Date(e.created_at).getTime());
        }, 0);
        avgConfirmationMs = totalMs / confirmed.length;
      }

      return {
        totalToday,
        manualCount,
        manualPercent: totalToday > 0 ? Math.round((manualCount / totalToday) * 100) : 0,
        deniedCount,
        deniedPercent: totalToday > 0 ? Math.round((deniedCount / totalToday) * 100) : 0,
        avgConfirmationMs,
      } as GateAuditMetrics;
    },
    enabled: !!societyId,
    staleTime: 60 * 1000,
  });
}
