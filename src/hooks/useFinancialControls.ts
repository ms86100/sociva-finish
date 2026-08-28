import { useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type {
  FinancialControlType,
  FinancialControlsSnapshot,
} from '@/lib/financial-controls';

export const FINANCIAL_CONTROLS_SNAPSHOT_KEY = ['admin-financial-controls-snapshot'];

type RpcResult<T = unknown> = PromiseLike<{
  data: T;
  error: { message: string } | null;
}>;

const adminRpc = <T = unknown>(name: string, args?: Record<string, unknown>) =>
  supabase.rpc(name as never, args as never) as RpcResult<T>;

function parseSnapshot(raw: unknown): FinancialControlsSnapshot {
  const data = (raw || {}) as Partial<FinancialControlsSnapshot>;
  return {
    feature_flags: Array.isArray(data.feature_flags) ? data.feature_flags : [],
    configurations: Array.isArray(data.configurations) ? data.configurations : [],
    pending_requests: Array.isArray(data.pending_requests) ? data.pending_requests : [],
    recent_requests: Array.isArray(data.recent_requests) ? data.recent_requests : [],
    pending_adjustments: Array.isArray(data.pending_adjustments) ? data.pending_adjustments : [],
    recent_adjustments: Array.isArray(data.recent_adjustments) ? data.recent_adjustments : [],
    platform_admin_count: typeof data.platform_admin_count === 'number' ? data.platform_admin_count : 0,
    pending_control_count: typeof data.pending_control_count === 'number' ? data.pending_control_count : 0,
    pending_adjustment_count:
      typeof data.pending_adjustment_count === 'number' ? data.pending_adjustment_count : 0,
    pending_total_count: typeof data.pending_total_count === 'number' ? data.pending_total_count : 0,
    preflight: (data.preflight && typeof data.preflight === 'object'
      ? data.preflight
      : {}) as Record<string, unknown>,
    generated_at: typeof data.generated_at === 'string' ? data.generated_at : undefined,
  };
}

export function useFinancialControlsSnapshot() {
  return useQuery({
    queryKey: FINANCIAL_CONTROLS_SNAPSHOT_KEY,
    queryFn: async () => {
      const { data, error } = await adminRpc('admin_get_financial_controls_snapshot');
      if (error) throw new Error(error.message);
      return parseSnapshot(data);
    },
    refetchInterval: 30_000,
  });
}

/** Lightweight count for admin nav badges. */
export function useAdminFinancialPendingCount() {
  const query = useQuery({
    queryKey: FINANCIAL_CONTROLS_SNAPSHOT_KEY,
    queryFn: async () => {
      const { data, error } = await adminRpc('admin_get_financial_controls_snapshot');
      if (error) throw new Error(error.message);
      return parseSnapshot(data);
    },
    staleTime: 20_000,
    refetchInterval: 30_000,
  });
  return {
    total: query.data?.pending_total_count ?? 0,
    controls: query.data?.pending_control_count ?? 0,
    adjustments: query.data?.pending_adjustment_count ?? 0,
    isLoading: query.isLoading,
  };
}

export function useFinancialControlsRealtime() {
  const queryClient = useQueryClient();
  useEffect(() => {
    const channel = supabase
      .channel('admin-financial-controls')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'financial_control_change_requests' },
        () => {
          void queryClient.invalidateQueries({ queryKey: FINANCIAL_CONTROLS_SNAPSHOT_KEY });
        },
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'financial_adjustment_requests' },
        () => {
          void queryClient.invalidateQueries({ queryKey: FINANCIAL_CONTROLS_SNAPSHOT_KEY });
        },
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'financial_feature_flags' },
        () => {
          void queryClient.invalidateQueries({ queryKey: FINANCIAL_CONTROLS_SNAPSHOT_KEY });
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [queryClient]);
}

export function useFinancialControlMutations() {
  const queryClient = useQueryClient();

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: FINANCIAL_CONTROLS_SNAPSHOT_KEY });

  const requestChange = useMutation({
    mutationFn: async (input: {
      controlType: FinancialControlType;
      controlKey: string;
      newValue: string;
      reason: string;
    }) => {
      const reason = input.reason.trim();
      if (reason.length < 10) {
        throw new Error('Reason must be at least 10 characters');
      }
      const { data, error } = await adminRpc<string>('request_financial_control_change', {
        p_control_type: input.controlType,
        p_control_key: input.controlKey,
        p_new_value: input.newValue,
        p_reason: reason,
      });
      if (error) throw new Error(error.message);
      return data;
    },
    onSuccess: invalidate,
  });

  const approveChange = useMutation({
    mutationFn: async (requestId: string) => {
      const { data, error } = await adminRpc('approve_financial_control_change', {
        p_request_id: requestId,
      });
      if (error) throw new Error(error.message);
      return data;
    },
    onSuccess: invalidate,
  });

  const rejectChange = useMutation({
    mutationFn: async (input: { requestId: string; reason?: string }) => {
      const { data, error } = await adminRpc('reject_financial_control_change', {
        p_request_id: input.requestId,
        p_reason: input.reason?.trim() || null,
      });
      if (error) throw new Error(error.message);
      return data;
    },
    onSuccess: invalidate,
  });

  const cancelChange = useMutation({
    mutationFn: async (requestId: string) => {
      const { data, error } = await adminRpc('cancel_financial_control_change', {
        p_request_id: requestId,
      });
      if (error) throw new Error(error.message);
      return data;
    },
    onSuccess: invalidate,
  });

  const busy =
    requestChange.isPending ||
    approveChange.isPending ||
    rejectChange.isPending ||
    cancelChange.isPending;

  return {
    requestChange,
    approveChange,
    rejectChange,
    cancelChange,
    busy,
  };
}

export function useFinancialAdjustmentMutations() {
  const queryClient = useQueryClient();
  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: FINANCIAL_CONTROLS_SNAPSHOT_KEY });

  const request = useMutation({
    mutationFn: async (input: {
      referenceType: string;
      referenceId: string;
      entries: unknown[];
      reason: string;
      metadata?: Record<string, unknown>;
    }) => {
      if (input.reason.trim().length < 20) {
        throw new Error('Reason must be at least 20 characters');
      }
      const { data, error } = await adminRpc<string>('request_financial_adjustment', {
        p_reference_type: input.referenceType,
        p_reference_id: input.referenceId,
        p_entries: input.entries,
        p_reason: input.reason.trim(),
        p_metadata: input.metadata || {},
      });
      if (error) throw new Error(error.message);
      return data;
    },
    onSuccess: invalidate,
  });

  const approve = useMutation({
    mutationFn: async (requestId: string) => {
      const { data, error } = await adminRpc('approve_financial_adjustment', {
        p_request_id: requestId,
      });
      if (error) throw new Error(error.message);
      return data;
    },
    onSuccess: invalidate,
  });

  const reject = useMutation({
    mutationFn: async (input: { requestId: string; reason?: string }) => {
      const { data, error } = await adminRpc('reject_financial_adjustment', {
        p_request_id: input.requestId,
        p_reason: input.reason?.trim() || null,
      });
      if (error) throw new Error(error.message);
      return data;
    },
    onSuccess: invalidate,
  });

  const cancel = useMutation({
    mutationFn: async (requestId: string) => {
      const { data, error } = await adminRpc('cancel_financial_adjustment', {
        p_request_id: requestId,
      });
      if (error) throw new Error(error.message);
      return data;
    },
    onSuccess: invalidate,
  });

  return {
    request,
    approve,
    reject,
    cancel,
    busy: request.isPending || approve.isPending || reject.isPending || cancel.isPending,
  };
}
