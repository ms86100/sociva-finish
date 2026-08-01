import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';

export type UpiValidationStatus =
  | 'idle'
  | 'checking'
  | 'valid'
  | 'invalid'
  | 'unavailable'
  | 'error'
  | 'stale';

export interface UpiValidationResult {
  status: UpiValidationStatus;
  customerName?: string;
  provider?: string;
  reason?: string;
  vpa?: string;
}

interface UseUpiValidationOptions {
  sellerId?: string;
  initialStatus?: UpiValidationStatus;
  initialHolderName?: string | null;
  initialProvider?: string | null;
  debounceMs?: number;
}

const VPA_REGEX =
  /^[a-zA-Z0-9](?:[a-zA-Z0-9._-]{0,254}[a-zA-Z0-9])?@[a-zA-Z][a-zA-Z0-9]{1,63}$/;

const cache = new Map<string, UpiValidationResult>();

const isTransientStatus = (status: UpiValidationStatus) =>
  status === 'idle' ||
  status === 'checking' ||
  status === 'unavailable' ||
  status === 'error' ||
  status === 'stale';

const hasLegacyUpstreamReason = (reason?: string) =>
  /requested url was not found on the server/i.test(reason ?? '');

const shouldUseCachedResult = (result: UpiValidationResult) =>
  !isTransientStatus(result.status) && !hasLegacyUpstreamReason(result.reason);

const shouldCacheResult = (result: UpiValidationResult) =>
  !isTransientStatus(result.status) && !hasLegacyUpstreamReason(result.reason);

export function useUpiValidation(opts: UseUpiValidationOptions = {}) {
  const { sellerId, initialStatus = 'idle', initialHolderName, initialProvider, debounceMs = 700 } = opts;
  const [status, setStatus] = useState<UpiValidationStatus>(initialStatus);
  const [customerName, setCustomerName] = useState<string | undefined>(initialHolderName ?? undefined);
  const [provider, setProvider] = useState<string | undefined>(initialProvider ?? undefined);
  const [reason, setReason] = useState<string | undefined>();
  const debounceRef = useRef<number | null>(null);
  const lastVpaRef = useRef<string>('');

  const reset = useCallback(() => {
    setStatus('idle');
    setCustomerName(undefined);
    setProvider(undefined);
    setReason(undefined);
  }, []);

  const runValidation = useCallback(async (vpa: string) => {
    const trimmed = vpa.trim();
    if (!trimmed) { reset(); return; }

    if (!VPA_REGEX.test(trimmed)) {
      setStatus('invalid');
      setCustomerName(undefined);
      setProvider(trimmed.split('@')[1]?.toLowerCase());
      setReason('Invalid UPI ID format');
      return;
    }

    const cacheKey = `${trimmed}:${sellerId ?? ''}`;
    if (cache.has(cacheKey)) {
      const c = cache.get(cacheKey)!;
      if (shouldUseCachedResult(c)) {
        setStatus(c.status);
        setCustomerName(c.customerName);
        setProvider(c.provider);
        setReason(c.reason);
        return;
      }
      cache.delete(cacheKey);
    }

    setStatus('checking');
    setReason(undefined);
    try {
      const { data, error } = await supabase.functions.invoke('validate-upi-vpa', {
        body: { vpa: trimmed, seller_id: sellerId },
      });
      if (error) throw error;
      const result: UpiValidationResult = {
        status: (data?.status ?? 'error') as UpiValidationStatus,
        customerName: data?.customer_name,
        provider: data?.provider,
        reason: data?.reason,
        vpa: data?.vpa,
      };
      if (shouldCacheResult(result)) {
        cache.set(cacheKey, result);
      } else {
        cache.delete(cacheKey);
      }
      setStatus(result.status);
      setCustomerName(result.customerName);
      setProvider(result.provider);
      setReason(result.reason);
    } catch (e: any) {
      const msg = String(e?.message ?? '');
      const isFetchFail =
        e?.name === 'FunctionsFetchError' ||
        /failed to send a request|failed to fetch|networkerror/i.test(msg);
      if (isFetchFail) {
        setStatus('unavailable');
        setReason('UPI verification service is offline. You can save and verify later.');
        setProvider(trimmed.split('@')[1]?.toLowerCase());
      } else {
        setStatus('error');
        setReason(msg || 'Validation request failed');
      }
    }
  }, [sellerId, reset]);

  const validate = useCallback((vpa: string, immediate = false) => {
    lastVpaRef.current = vpa;
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    if (immediate) {
      runValidation(vpa);
      return;
    }
    debounceRef.current = window.setTimeout(() => {
      if (lastVpaRef.current === vpa) runValidation(vpa);
    }, debounceMs);
  }, [runValidation, debounceMs]);

  useEffect(() => () => {
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
  }, []);

  return { status, customerName, provider, reason, validate, reset };
}

export function isUpiSavable(status: UpiValidationStatus): { ok: boolean; requiresConfirm: boolean; message?: string } {
  switch (status) {
    case 'valid': return { ok: true, requiresConfirm: false };
    case 'invalid': return { ok: false, requiresConfirm: false, message: 'UPI ID is invalid. Please correct it before saving.' };
    case 'unavailable':
    case 'error':
    case 'stale':
    case 'idle':
      return { ok: true, requiresConfirm: true, message: 'UPI could not be verified. Save anyway? Payouts will be paused until verified.' };
    case 'checking':
      return { ok: false, requiresConfirm: false, message: 'Please wait for UPI verification to finish.' };
    default:
      return { ok: false, requiresConfirm: true };
  }
}
