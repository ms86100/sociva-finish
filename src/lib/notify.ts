// Imperative API for showing a centered "action blocked" / validation popup.
// Use this INSTEAD of `toast.error(...)` for pre-condition guards that
// prevent an action from proceeding (e.g. "Please sign in", "Cannot place
// an order from your own store", "Select at least one operating day").
//
// Operational failures (network errors, "Failed to save", etc.) should
// continue to use toasts — they're informational, not blocking.

import { toast } from 'sonner';
import { hapticNotification } from '@/lib/haptics';
import { friendlyError } from '@/lib/utils';

export type NotifyVariant = 'block' | 'warn' | 'info';
export type NotifyPriority = 'normal' | 'high' | 'critical';

export interface NotifyOptions {
  title?: string;
  okLabel?: string;
  cancelLabel?: string;
  onAck?: () => void;
  onCancel?: () => void;
  /** Stable key used to suppress an already-open or queued duplicate. */
  id?: string;
  priority?: NotifyPriority;
}

export interface NotifyState {
  open: boolean;
  variant: NotifyVariant;
  title: string;
  message: string;
  okLabel: string;
  cancelLabel?: string;
  id?: string;
  priority: NotifyPriority;
  confirmation: boolean;
  onAck?: () => void;
  onCancel?: () => void;
  resolve?: (confirmed: boolean) => void;
  nonce: number;
}

const DEFAULT_TITLES: Record<NotifyVariant, string> = {
  block: 'Almost there',
  warn: 'Please review',
  info: 'Just so you know',
};

let state: NotifyState = {
  open: false,
  variant: 'block',
  title: DEFAULT_TITLES.block,
  message: '',
  okLabel: 'OK',
  priority: 'normal',
  confirmation: false,
  nonce: 0,
};

const listeners = new Set<(s: NotifyState) => void>();
const queue: NotifyState[] = [];
const PRIORITY: Record<NotifyPriority, number> = { normal: 0, high: 1, critical: 2 };

function emit() {
  for (const l of listeners) l(state);
}

export function subscribeNotify(listener: (s: NotifyState) => void): () => void {
  listeners.add(listener);
  listener(state);
  return () => {
    listeners.delete(listener);
  };
}

export function getNotifyState(): NotifyState {
  return state;
}

function openNext() {
  if (state.open || queue.length === 0) return;
  const next = queue.shift()!;
  state = { ...next, open: true, nonce: state.nonce + 1 };
  emit();
}

function finishCurrent(confirmed: boolean) {
  if (!state.open) return;
  const current = state;
  state = { ...state, open: false };
  emit();
  current.resolve?.(confirmed);
  if (confirmed) current.onAck?.();
  else current.onCancel?.();
  queueMicrotask(openNext);
}

export function closeNotify() {
  finishCurrent(false);
}

export function acknowledgeNotify() {
  finishCurrent(true);
}

export function clearNotifyQueue() {
  if (state.open) {
    const current = state;
    state = { ...state, open: false };
    current.resolve?.(false);
  }
  for (const queued of queue.splice(0)) queued.resolve?.(false);
  emit();
}

function enqueue(
  variant: NotifyVariant,
  message: string,
  opts: NotifyOptions = {},
  confirmation = false,
  resolve?: (confirmed: boolean) => void,
) {
  const id = opts.id ?? `${variant}:${message}`;
  if (state.open && state.id === id) {
    if (confirmation && resolve) {
      const previousResolve = state.resolve;
      state.resolve = (confirmed) => {
        previousResolve?.(confirmed);
        resolve(confirmed);
      };
    }
    return;
  }
  const queuedDuplicate = queue.find(item => item.id === id);
  if (queuedDuplicate) {
    if (confirmation && resolve) {
      const previousResolve = queuedDuplicate.resolve;
      queuedDuplicate.resolve = (confirmed) => {
        previousResolve?.(confirmed);
        resolve(confirmed);
      };
    }
    return;
  }
  if (variant === 'block') hapticNotification('error');
  else if (variant === 'warn') hapticNotification('warning');
  const next: NotifyState = {
    open: false,
    variant,
    title: opts.title ?? DEFAULT_TITLES[variant],
    message,
    okLabel: opts.okLabel ?? 'OK',
    cancelLabel: opts.cancelLabel,
    id,
    priority: opts.priority ?? (variant === 'block' ? 'high' : 'normal'),
    confirmation,
    onAck: opts.onAck,
    onCancel: opts.onCancel,
    resolve,
    nonce: state.nonce,
  };
  queue.push(next);
  queue.sort((a, b) => PRIORITY[b.priority] - PRIORITY[a.priority]);
  openNext();
}

export const notify = {
  block: (message: string, opts?: NotifyOptions) => enqueue('block', message, opts),
  warn: (message: string, opts?: NotifyOptions) => enqueue('warn', message, opts),
  info: (message: string, opts?: NotifyOptions) => enqueue('info', message, opts),
  confirm: (message: string, opts: NotifyOptions = {}) =>
    new Promise<boolean>((resolve) => enqueue('warn', message, {
      okLabel: opts.okLabel ?? 'Continue',
      cancelLabel: opts.cancelLabel ?? 'Cancel',
      priority: opts.priority ?? 'high',
      ...opts,
    }, true, resolve)),
  /** Operational failures stay transient and are always sanitized. */
  error: (error: unknown, opts?: { id?: string; title?: string }) =>
    toast.error(opts?.title ?? friendlyError(error), { id: opts?.id }),
  success: (message: string, opts?: { id?: string }) =>
    toast.success(message, { id: opts?.id }),
  close: closeNotify,
  clear: clearNotifyQueue,
};
