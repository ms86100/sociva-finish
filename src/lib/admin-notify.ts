import { notify } from '@/lib/notify';
import { friendlyError } from '@/lib/utils';

type AdminMessageOptions = {
  id?: string;
  title?: string;
  description?: string;
  duration?: number;
};

function textWithDescription(message: unknown, options?: AdminMessageOptions): string {
  const text = typeof message === 'string' ? message : friendlyError(message);
  return options?.description ? `${text}\n\n${options.description}` : text;
}

/**
 * Admin actions use persistent acknowledgement popups rather than transient
 * toasts. The Sonner-compatible shape keeps admin call sites consistent.
 */
export const adminNotify = {
  success(message: unknown, options?: AdminMessageOptions) {
    notify.info(textWithDescription(message, options), {
      id: options?.id,
      title: options?.title ?? 'Update complete',
      okLabel: 'Done',
    });
  },
  error(error: unknown, options?: AdminMessageOptions) {
    notify.block(friendlyError(error), {
      id: options?.id,
      title: options?.title ?? 'Action failed',
      okLabel: 'OK',
      priority: 'high',
    });
  },
  warning(message: unknown, options?: AdminMessageOptions) {
    notify.warn(textWithDescription(message, options), {
      id: options?.id,
      title: options?.title ?? 'Review required',
      okLabel: 'Review',
      priority: 'high',
    });
  },
  info(message: unknown, options?: AdminMessageOptions) {
    notify.info(textWithDescription(message, options), {
      id: options?.id,
      title: options?.title ?? 'Admin notice',
      okLabel: 'OK',
    });
  },
  message(message: unknown, options?: AdminMessageOptions) {
    notify.info(textWithDescription(message, options), {
      id: options?.id,
      title: options?.title ?? 'Admin notice',
      okLabel: 'OK',
    });
  },
};
