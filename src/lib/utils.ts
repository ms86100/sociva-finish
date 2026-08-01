// @ts-nocheck
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Maps technical/system error messages to user-friendly text.
 * Use in catch blocks instead of showing raw error.message.
 */
export function friendlyError(error: unknown): string {
  // Handle Supabase PostgrestError objects { message, code, details, hint }
  const msg = error instanceof Error
    ? error.message
    : (typeof error === 'object' && error !== null && 'message' in error && typeof (error as any).message === 'string')
      ? (error as any).message
      : String(error ?? '');
  const lower = msg.toLowerCase();

  if (lower.includes('invalid category') || lower.includes('category does not exist')) {
    return 'Please pick a category before saving. If you don\'t see yours, use the closest "Other" category or request a new one.';
  }
  if (lower.includes('is currently disabled') && lower.includes('category')) {
    return 'That category is currently unavailable. Please pick another or use the closest "Other" category.';
  }


  if (lower.includes('jwt') || lower.includes('token') || lower.includes('refresh_token')) {
    return 'Your session has expired. Please log in again.';
  }
  if (lower.includes('row-level security') || lower.includes('rls') || lower.includes('policy')) {
    return "You don't have permission for this action.";
  }
  if (lower.includes('networkerror') || lower.includes('failed to fetch') || lower.includes('network request failed')) {
    return 'Please check your internet connection and try again.';
  }
  if (lower.includes('duplicate key') || lower.includes('unique constraint') || lower.includes('already exists')) {
    return 'This entry already exists. Please try a different value.';
  }
  if (lower.includes('not found') || lower.includes('no rows')) {
    return 'The requested item was not found. It may have been removed.';
  }
  if (lower.includes('timeout') || lower.includes('timed out')) {
    return 'The request took too long. Please try again.';
  }
  if (lower.includes('rate limit') || lower.includes('too many requests')) {
    return 'Too many requests. Please wait a moment and try again.';
  }
  if (lower.includes('invalid login') || lower.includes('invalid credentials')) {
    return 'Invalid email or password. Please try again.';
  }
  if (lower.includes('email not confirmed')) {
    return 'Please verify your email before logging in. Check your inbox.';
  }
  if (lower.includes('storage') && lower.includes('quota')) {
    return 'Storage limit reached. Please free up space and try again.';
  }
  if (lower.includes('stock_validation_failed') || lower.includes('items are unavailable')) {
    return 'Some items in your cart are no longer available. Please review your cart.';
  }
  if (lower.includes('insufficient') || lower.includes('balance')) {
    return 'Insufficient balance. Please try a different payment method.';
  }
  if (lower.includes('permission') || lower.includes('forbidden') || lower.includes('403')) {
    return "You don't have permission for this action.";
  }
  if (lower.includes('invalid') && lower.includes('phone')) {
    return 'Please enter a valid phone number.';
  }
  if (lower.includes('invalid') && lower.includes('email')) {
    return 'Please enter a valid email address.';
  }
  if (lower.includes('file') && (lower.includes('large') || lower.includes('size'))) {
    return 'File is too large. Please choose a smaller file.';
  }
  if (lower.includes('user_already_exists') || lower.includes('user already registered')) {
    return 'An account with this email already exists. Try logging in instead.';
  }
  if (lower.includes('weak_password') || lower.includes('password')) {
    return 'Password is too weak. Use at least 8 characters with mixed case and numbers.';
  }
  if (lower.includes('server') || lower.includes('500') || lower.includes('internal')) {
    return 'Server error. Please try again in a moment.';
  }

  // Fallback: return original if it looks user-friendly (short, no technical jargon)
  if (msg.length > 0 && msg.length < 120 && !lower.includes('error') && !lower.includes('exception') && !lower.includes('unexpected')) {
    return msg;
  }

  return 'Something went wrong. Please try again.';
}
