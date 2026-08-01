// @ts-nocheck
import { z } from 'zod';

/**
 * Shared validation schemas for critical forms.
 * Client-side validation to reduce failed API calls and improve UX.
 */

// Auth schemas
export const emailSchema = z
  .string()
  .trim()
  .min(1, 'Email is required')
  .email('Please enter a valid email address')
  .max(255, 'Email must be less than 255 characters');

export const passwordSchema = z
  .string()
  .min(6, 'Password must be at least 6 characters')
  .max(128, 'Password must be less than 128 characters');

export const loginSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
});

export const profileDataSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(100, 'Name must be less than 100 characters'),
  flat_number: z.string().trim().min(1, 'Flat number is required').max(20, 'Flat number too long'),
  block: z.string().trim().min(1, 'Block/Tower is required').max(20, 'Block too long'),
  phase: z.string().max(20, 'Phase too long').optional().or(z.literal('')),
  phone: z.string().regex(/^\d{10}$/, 'Please enter a valid 10-digit phone number'),
});

export const signupSchema = loginSchema.extend({
  profile: profileDataSchema,
});

// Dispute schema
const VALID_DISPUTE_CATEGORIES = [
  'noise', 'parking', 'pet', 'maintenance',
  'quality', 'delivery', 'payment', 'behaviour', 'other',
] as const;

export const disputeSchema = z.object({
  category: z.enum(VALID_DISPUTE_CATEGORIES, { errorMap: () => ({ message: 'Please select a valid category' }) }),
  description: z.string().trim().min(10, 'Description must be at least 10 characters').max(2000, 'Description too long'),
  is_anonymous: z.boolean().optional(),
});

// Worker registration schema
export const workerRegistrationSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(100, 'Name too long'),
  phone: z.string().regex(/^(\+?\d{10,13})?$/, 'Invalid phone number').optional().or(z.literal('')),
  workerType: z.string().min(1, 'Worker type is required'),
  shiftStart: z.string().regex(/^\d{2}:\d{2}$/, 'Invalid time'),
  shiftEnd: z.string().regex(/^\d{2}:\d{2}$/, 'Invalid time'),
  entryFrequency: z.enum(['daily', 'occasional', 'per_visit']),
  emergencyPhone: z.string().regex(/^(\+?\d{10,13})?$/, 'Invalid phone number').optional().or(z.literal('')),
  flatNumbers: z.string().max(500, 'Too many flats').optional().or(z.literal('')),
  preferredLanguage: z.string().min(2, 'Language is required').max(10),
}).refine(data => data.shiftStart < data.shiftEnd, {
  message: 'Shift end must be after shift start',
  path: ['shiftEnd'],
});

// Job request schema
export const jobRequestSchema = z.object({
  job_type: z.string().min(1, 'Please select a job type'),
  description: z.string().max(1000, 'Description too long').optional().or(z.literal('')),
  price: z.number().positive('Budget must be positive').optional().nullable(),
  duration_hours: z.number().int().min(1, 'Minimum 1 hour').max(24, 'Maximum 24 hours'),
  urgency: z.enum(['flexible', 'normal', 'urgent']),
  visibility_scope: z.enum(['society', 'nearby']).default('society'),
  target_society_ids: z.array(z.string().uuid()).default([]),
}).refine(data => {
  if (data.visibility_scope === 'nearby' && data.target_society_ids.length === 0) {
    return false;
  }
  return true;
}, {
  message: 'Select at least one nearby society',
  path: ['target_society_ids'],
});

/**
 * Validates data against a zod schema and returns parsed data or error messages.
 */
export function validateForm<T>(
  schema: z.ZodSchema<T>,
  data: unknown
): { success: true; data: T } | { success: false; errors: Record<string, string> } {
  const result = schema.safeParse(data);
  if (result.success) {
    return { success: true, data: result.data };
  }

  const errors: Record<string, string> = {};
  for (const issue of result.error.issues) {
    const key = issue.path.join('.');
    if (!errors[key]) {
      errors[key] = issue.message;
    }
  }
  return { success: false, errors };
}
