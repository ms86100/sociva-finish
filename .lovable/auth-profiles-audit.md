# Auth & Profiles Module — Feature & Rule Inventory

> Generated: 2026-02-22 | Source: Code analysis only (no assumptions)

## 1. Authentication Flows

### 1.1 Login (Email/Password)
- **Validation**: Zod `loginSchema` — email trimmed, 1-255 chars, valid format; password 6-128 chars
- **Flow**: `signInWithPassword()` → profile lookup → navigate or orphan handling
- **Orphan handling**: If auth succeeds but no profile exists → sign out + error toast (8s duration)
- **Email not confirmed**: Specific error message guiding to verify email
- **Invalid credentials**: Combined error mentioning both wrong password AND unverified email possibility
- **Error mapping**: `friendlyError()` utility for all other errors

### 1.2 Signup (4-Step Flow)
- **Steps**: Credentials → Society → Profile → Verification
- **Step 1 (Credentials)**:
  - Email + password validated via `loginSchema`
  - Password strength indicator: 4 checks (6+ chars, uppercase, number, special char)
  - Age confirmation checkbox (18+) — **REQUIRED** to proceed
  - Terms & Privacy Policy consent implied
- **Step 2 (Society Selection)**:
  - Fetches active+verified societies on mount
  - Local DB search (≥2 chars) by name/pincode/city/address
  - Google Places autocomplete (≥3 chars, 300ms debounce)
  - Google Place → checks DB for name match → auto-selects if found
  - Unmatched Google Place → creates pending society object (id='pending')
  - Request form sub-step for manual society submission
  - **Invite code enforcement**: If society has `invite_code`, user must enter matching code (case-insensitive)
  - GPS verification available but optional
- **Step 3 (Profile)**:
  - Validated via `profileDataSchema`: name (1-100), flat (1-20), block (1-20), phase (optional, ≤20), phone (exactly 10 digits)
  - Phone formatted to strip non-digits, capped at 10
  - Phone stored with `+91` prefix
- **Step 4 (Completion)**:
  - `signUp()` with `emailRedirectTo` to `/auth`
  - **Duplicate email detection**: checks `identities.length === 0`
  - **Pending society flow**: calls `validate-society` edge function to create society FIRST, gets real ID
  - **Guard**: if finalSocietyId is still 'pending' or falsy → abort + sign out
  - Profile INSERT with user ID, email, phone (+91 prefix), name, flat, block, phase, society_id
  - **Duplicate email error**: Caught via `idx_profiles_email_unique` constraint → redirect to login
  - **Duplicate phone error**: Caught via `idx_profiles_phone_unique` constraint → specific error
  - **Profile insert failure**: Signs out orphaned auth user + error toast (8s)
  - Role INSERT: `buyer` role assigned
  - Society validation (for existing societies) called AFTER profile insert to avoid JWT race conditions
  - Redirects to verification step

### 1.3 Password Reset
- Email validated via `emailSchema` (trimmed)
- `resetPasswordForEmail()` with `redirectTo: ${origin}/auth`
- ⚠️ **FINDING F1**: redirectTo points to `/auth` but there's no dedicated `/reset-password` page — user lands on login page after clicking reset link. Password update may not work correctly.

### 1.4 Session Management
- `onAuthStateChange` listener set up BEFORE `getSession()`
- Session expiry: If `SIGNED_OUT` event fires without explicit sign out → toast "session expired" + redirect to `#/auth`
- Explicit sign out tracked via `isExplicitSignOut` ref to prevent double toast

### 1.5 Auto-Profile Recovery
- If `get_user_auth_context` returns null profile for authenticated user:
  - Attempts to create profile from `user_metadata`
  - Inserts `buyer` role
  - Retries auth context fetch

## 2. Authorization Model

### 2.1 Roles (from `user_roles` table)
- Types: `buyer`, `seller`, `admin`, `worker`
- RLS: Users can only insert their own `buyer` role; admins can manage all
- Derived flags:
  - `isApproved`: `profile.verification_status === 'approved'`
  - `isSeller`: has `seller` role AND at least one seller profile with `verification_status === 'approved'`
  - `isAdmin`: has `admin` role
  - `isSocietyAdmin`: has `society_admins` entry OR isAdmin
  - `isBuilderMember`: has entries in `builder_members`

### 2.2 Realtime Role Updates
- Subscribes to changes on: `user_roles`, `security_staff`, `society_admins`, `builder_members`
- Any change triggers full `get_user_auth_context` refresh

### 2.3 Society Context Switching
- `effectiveSocietyId`: viewAsSocietyId || profile.society_id
- `setViewAsSociety(id)`: Fetches society and sets viewAs context
- Read operations use effectiveSocietyId; writes use profile.society_id

## 3. Profile Management

### 3.1 Profile Page
- Avatar upload via `ImageUpload` component → updates `profiles.avatar_url`
- Verification badge shown when `verification_status === 'approved'`
- Skill badges from `skill_listings` table (top 5 by trust_score)
- Large font accessibility toggle (persisted in localStorage)
- Links to: Orders, Favorites, Seller Dashboard (if seller), Become Seller (if not)
- Gate Entry link gated by `resident_identity_verification` feature flag

### 3.2 Account Deletion
- `DeleteAccountDialog`: requires typing "DELETE" (case-insensitive, auto-uppercased)
- Calls `delete-user-account` edge function
- Edge function: rate-limited (3/hour), deletes from 20+ tables, then `auth.admin.deleteUser()`
- Cleanup order: cart → favorites → reviews → bulletin data → help data → notifications → disputes → seller data → roles → profile → auth user

## 4. RLS Policies (profiles table)

| Operation | Policy |
|-----------|--------|
| SELECT | Own profile, approved profiles, or admin |
| INSERT | `id = auth.uid()` |
| UPDATE | Own profile, admin, or society admin of same society |
| DELETE | None (no delete policy) |

## 5. Database Constraints

- `idx_profiles_email_unique`: Unique email (partial index, allows NULL/empty)
- `idx_profiles_phone_unique`: Unique phone (partial index, allows NULL/empty)
- `auto_approve_resident` trigger: Sets `verification_status = 'approved'` on INSERT

## 6. Edge Functions

### 6.1 `validate-society`
- Creates new societies or validates existing ones
- New: requires name + slug, creates with `is_verified: false, is_active: true`
- Existing: validates UUID format, checks existence
- Auth: Bearer token required, JWT verified

### 6.2 `delete-user-account`
- Auth: `withAuth()` middleware
- Rate limit: 3 per hour per user
- Service role used for deletions
- Cascade cleanup across all tables

## 7. Discovered Issues

### F1 — Password Reset Missing Reset Page — ✅ FIXED
Created `/reset-password` page with `supabase.auth.updateUser({ password })`. Updated `redirectTo` to `/#/reset-password`. Page handles `PASSWORD_RECOVERY` auth event, validates password with strength indicator, confirms match, and shows success state.

### F2 — Profile INSERT Race Condition Window (LOW)
Between `signUp()` and profile INSERT, there's a brief window where the user exists in auth but has no profile. The auto-recovery in `useAuthState` handles this, but if the user refreshes during this window, they could see the orphan error.

### F3 — Society SELECT Policy is Fully Public (INFO)
`societies` table has `SELECT` policy with `qual: true` — all society data is readable by anyone, including unauthenticated users. This is by design for the signup flow but exposes all society names, addresses, coordinates.

### F4 — No Profile DELETE RLS Policy (INFO)
Profiles can only be deleted via the edge function (service role). No direct delete policy exists, which is correct for data integrity.

### F5 — Password Reset redirectTo Inconsistency — ✅ FIXED (merged with F1)
Now correctly points to `/#/reset-password` which handles the recovery token.
