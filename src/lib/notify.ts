// Imperative API for showing a centered "action blocked" / validation popup.
// Use this INSTEAD of `toast.error(...)` for pre-condition guards that
// prevent an action from proceeding (e.g. "Please sign in", "Cannot place
// an order from your own store", "Select at least one operating day").
//
// Operational failures (network errors, "Failed to save", etc.) should
// continue to use toasts — they're informational, not blocking.

import { hapticNotification } from '@/lib/haptics';

export type NotifyVariant = 'block' | 'warn' | 'info';

export interface NotifyOptions {
  title?: string;
  okLabel?: string;
  onAck?: () => void;
}

export interface NotifyState {
  open: boolean;
  variant: NotifyVariant;
  title: string;
  message: string;
  okLabel: string;
  onAck?: () => void;
  // bump on every open so identical messages still re-trigger if the previous
  // dialog was dismissed
  nonce: number;
}

const DEFAULT_TITLES: Record<NotifyVariant, string> = {
  block: 'Action not allowed',
  warn: 'Please review',
  info: 'Heads up',
};

let state: NotifyState = {
  open: false,
  variant: 'block',
  title: DEFAULT_TITLES.block,
  message: '',
  okLabel: 'OK',
  nonce: 0,
};

const listeners = new Set<(s: NotifyState) => void>();

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

export function closeNotify() {
  if (!state.open) return;
  state = { ...state, open: false };
  emit();
}

function show(variant: NotifyVariant, message: string, opts: NotifyOptions = {}) {
  // Dedupe: if the same message+variant is already open, do nothing.
  if (state.open && state.message === message && state.variant === variant) return;
  if (variant === 'block') hapticNotification('error');
  else if (variant === 'warn') hapticNotification('warning');
  state = {
    open: true,
    variant,
    title: opts.title ?? DEFAULT_TITLES[variant],
    message,
    okLabel: opts.okLabel ?? 'OK',
    onAck: opts.onAck,
    nonce: state.nonce + 1,
  };
  emit();
}

export const notify = {
  block: (message: string, opts?: NotifyOptions) => show('block', message, opts),
  warn: (message: string, opts?: NotifyOptions) => show('warn', message, opts),
  info: (message: string, opts?: NotifyOptions) => show('info', message, opts),
  close: closeNotify,
};
