// @ts-nocheck
import { useQuery } from '@tanstack/react-query';
import { loadAppBootstrap } from '@/lib/app-bootstrap';
import { jitteredStaleTime } from '@/lib/query-utils';

import {
  ORDER_STATUS_LABELS,
  PAYMENT_STATUS_LABELS,
  ITEM_STATUS_LABELS,
} from '@/types/Database';

interface StatusLabel {
  label: string;
  color: string;
}

type StatusDomain = 'order_status' | 'payment_status' | 'item_status' | 'delivery_status' | 'worker_job_status';

type StatusDisplayConfig = Record<StatusDomain, Record<string, StatusLabel>>;

const UNKNOWN_STATUS: StatusLabel = { label: 'Unknown', color: 'bg-gray-100 text-gray-600' };

const DELIVERY_STATUS_FALLBACK: Record<string, StatusLabel> = {
  pending: { label: 'Pending', color: 'bg-yellow-100 text-yellow-800' },
  assigned: { label: 'Assigned', color: 'bg-blue-100 text-blue-800' },
  picked_up: { label: 'In Transit', color: 'bg-indigo-100 text-indigo-800' },
  at_gate: { label: 'At Gate', color: 'bg-cyan-100 text-cyan-800' },
  delivered: { label: 'Delivered', color: 'bg-green-100 text-green-800' },
  failed: { label: 'Failed', color: 'bg-red-100 text-red-800' },
  cancelled: { label: 'Cancelled', color: 'bg-gray-100 text-gray-800' },
};

const WORKER_JOB_STATUS_FALLBACK: Record<string, StatusLabel> = {
  open: { label: 'Open', color: 'bg-yellow-100 text-yellow-800' },
  accepted: { label: 'Accepted', color: 'bg-blue-100 text-blue-800' },
  completed: { label: 'Completed', color: 'bg-green-100 text-green-800' },
  cancelled: { label: 'Cancelled', color: 'bg-red-100 text-red-800' },
  expired: { label: 'Expired', color: 'bg-muted text-muted-foreground' },
};

/**
 * Hook that provides status display labels from the DB (system_settings)
 * with hardcoded fallbacks from types/database.ts.
 *
 * Usage:
 *   const { getOrderStatus, getPaymentStatus, getItemStatus, getDeliveryStatus, getWorkerJobStatus } = useStatusLabels();
 *   const { label, color } = getOrderStatus('placed');
 */
export function useStatusLabels() {
  const { data: dbConfig } = useQuery({
    queryKey: ['status-display-config'],
    // PERF: served from the shared single-request bootstrap.
    queryFn: async (): Promise<StatusDisplayConfig | null> => {
      const { sysMap } = await loadAppBootstrap();
      const raw = sysMap.status_display_config;
      if (!raw) return null;
      try {
        return JSON.parse(raw) as StatusDisplayConfig;
      } catch {
        return null;
      }
    },
    staleTime: jitteredStaleTime(30 * 60 * 1000),
  });


  const getOrderStatus = (status: string): StatusLabel => {
    return dbConfig?.order_status?.[status] ?? ORDER_STATUS_LABELS[status as keyof typeof ORDER_STATUS_LABELS] ?? UNKNOWN_STATUS;
  };

  const getPaymentStatus = (status: string): StatusLabel => {
    return dbConfig?.payment_status?.[status] ?? PAYMENT_STATUS_LABELS[status as keyof typeof PAYMENT_STATUS_LABELS] ?? UNKNOWN_STATUS;
  };

  const getItemStatus = (status: string): StatusLabel => {
    return dbConfig?.item_status?.[status] ?? ITEM_STATUS_LABELS[status as keyof typeof ITEM_STATUS_LABELS] ?? UNKNOWN_STATUS;
  };

  const getDeliveryStatus = (status: string): StatusLabel => {
    return dbConfig?.delivery_status?.[status] ?? DELIVERY_STATUS_FALLBACK[status] ?? UNKNOWN_STATUS;
  };

  const getWorkerJobStatus = (status: string): StatusLabel => {
    return dbConfig?.worker_job_status?.[status] ?? WORKER_JOB_STATUS_FALLBACK[status] ?? UNKNOWN_STATUS;
  };

  return { getOrderStatus, getPaymentStatus, getItemStatus, getDeliveryStatus, getWorkerJobStatus };
}
