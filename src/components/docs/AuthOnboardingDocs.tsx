// @ts-nocheck
import { DocHero, DocSection, DocSubSection, DocStep, DocInfoCard, DocList, DocTable } from './DocPrimitives';
import { LogIn } from 'lucide-react';

export function AuthOnboardingDocs() {
  return (
    <div>
      <DocHero
        icon={LogIn}
        title="Authentication & Onboarding"
        subtitle="Multi-step signup with society search (Google Maps integration), admin-controlled verification, password reset, welcome carousel, public landing page, and profile management."
      />

      {/* ─── AuthPage ─── */}
      <DocSection title="AuthPage — Login & Signup" id="auth-page">
        <p>The AuthPage (/auth) is the primary authentication screen. It features a hero banner with the platform branding, a trust badge ("Exclusively for verified residential society members"), and animated step transitions using Framer Motion.</p>

        <DocSubSection title="Login Mode">
          <DocList items={[
            'Email input with inline validation checkmark (green circle appears when email format is valid)',
            'Password input with show/hide toggle (Eye/EyeOff icon button)',
            '"Forgot password?" link switches to password reset mode',
            'Rate limiting: After too many failed attempts, a lockout timer displays "Too many attempts. Try again in Xs" with countdown',
            'Sign In button — disabled until both email and password are filled; shows spinner during loading',
            '"New here? Create an account" link switches to signup mode',
            'On successful login, redirects to Home (/). If user has profile but no society, shows society setup step',
          ]} />
        </DocSubSection>

        <DocSubSection title="Signup Mode — 4-Step Wizard">
          <p>A progress bar at the top shows steps: Account → Society → Profile → Verify. Each step uses animated slide transitions.</p>

          <DocStep number={1} title="Account (Credentials)">
            <DocList items={[
              'Email input with format validation checkmark',
              'Password input with show/hide toggle and PasswordStrengthIndicator component (shows weak/fair/strong/excellent with color bar)',
              'Minimum 6 characters required for password',
              'Age confirmation checkbox: "I confirm that I am 18 years of age or older" — required, with links to Terms & Conditions and Privacy Policy',
              'Compliance note: "Required to comply with marketplace regulations"',
              'Continue button — disabled until email valid, password ≥ 6 chars, and age confirmed',
              '"Already have an account? Sign in" link to switch to login mode',
            ]} />
          </DocStep>

          <DocStep number={2} title="Society Selection">
            <p>This step has multiple sub-steps with animated transitions:</p>

            <DocSubSection title="Sub-step: Search">
              <DocList items={[
                'Google Maps autocomplete integration — loads Google Maps JS SDK for place search',
                'Search input: "Search society, area, landmark, pincode..." with auto-focus',
                'Loading indicator while Google Maps loads',
                'Two result sections appear as you type:',
                '  → "Registered Societies" — matches from the societies database table, shown with building icon and checkmark when selected',
                '  → "Google Maps Results" — Google Places autocomplete results with map pin icon',
                'Selecting a registered society highlights it with primary border and checkmark',
                'Selecting a Google Maps result calls Places API to resolve details and may trigger the "Request Society" sub-step',
                'If no results: "No results found for [query]" message',
                'If search < 2 chars: prompt "Start typing to search for your society"',
                'Back button returns to credentials step',
                'Continue button — disabled until a society is selected; if society has invite_code, invite code input appears',
              ]} />
            </DocSubSection>

            <DocSubSection title="Sub-step: Request New Society">
              <DocList items={[
                'Appears when user selects a Google Maps result that doesn\'t match any registered society',
                'Fields: Society Name (required), Full Address, Landmark, City (required), Pincode (required, 6-digit numeric only), Contact Number (required, 10-digit with country code prefix)',
                'Info box: "Your request will be reviewed by our team. We\'ll contact you once the society is approved and activated."',
                'Submit Request button — creates a society request for admin review',
                'Back button returns to search sub-step',
              ]} />
            </DocSubSection>
          </DocStep>

          <DocStep number={3} title="Profile Details">
            <DocList items={[
              'Society confirmation badge — shows selected society name with "Change" link',
              'Full Name input (required)',
              'Phone Number input with country code prefix (configurable via system settings), 10-digit validation',
              'Phase / Wing input (optional) — "e.g., Phase 1, Wing A"',
              'Block/Tower input (required) — label configurable via system settings (addressBlockLabel)',
              'Flat/Unit Number input (required) — label configurable via system settings (addressFlatLabel)',
              'Helper text: "Used for delivery and identity verification within your society"',
              'Create Account button — disabled until name, flat, block filled and phone is 10 digits; shows spinner during account creation',
            ]} />
          </DocStep>

          <DocStep number={4} title="Email Verification">
            <DocList items={[
              'Success animation with mail icon',
              '"Check Your Inbox!" heading with the submitted email displayed',
              'Step-by-step instructions: 1) Open email inbox (check spam), 2) Click "Confirm your email" link, 3) Come back and log in',
              'Warning box: "You won\'t be able to log in until you verify your email" (red destructive styling)',
              '"I\'ve Verified — Go to Login" button returns to login mode',
              '"Didn\'t receive it? Get help" link shows toast with troubleshooting tips',
            ]} />
          </DocStep>
        </DocSubSection>

        <DocSubSection title="Password Reset Mode">
          <DocList items={[
            'Email input field',
            '"Send Reset Link" button — calls resetPasswordForEmail with redirect URL',
            'After sending: confirmation screen shows "Check your email" with the submitted email',
            'Instructions: check inbox/spam, click link, link expires in 1 hour',
            '"Didn\'t receive it? Resend" button to retry',
            '"Back to Login" button',
          ]} />
        </DocSubSection>

        <DocInfoCard variant="info" title="Security Features">
          <DocList items={[
            'Login rate limiting with lockout timer',
            'Password strength indicator with 4 levels',
            'Age confirmation requirement (18+)',
            'Email verification required before first login (auto-confirm disabled by default)',
            'Society invite codes supported for private communities',
            'Legal footer with Terms of Service and Privacy Policy links',
          ]} />
        </DocInfoCard>
      </DocSection>

      {/* ─── ResetPasswordPage ─── */}
      <DocSection title="ResetPasswordPage — Password Recovery" id="reset-password">
        <p>The /reset-password route handles the password reset flow after the user clicks the email link.</p>
        <DocList items={[
          'Detects recovery token from URL hash parameters (type=recovery)',
          'Shows a "Set New Password" form with password input and strength indicator',
          'Calls supabase.auth.updateUser({ password }) to update the password',
          'On success, redirects to login page',
          'Public route — not behind authentication middleware',
        ]} />
      </DocSection>

      {/* ─── WelcomeCarousel ─── */}
      <DocSection title="WelcomeCarousel — First-Time Introduction" id="welcome-carousel">
        <p>The /welcome route shows an auto-playing carousel introduction for first-time visitors (unauthenticated users).</p>
        <DocList items={[
          'Uses Embla Carousel with loop mode and 8-second autoplay interval',
          'Autoplay pauses on user interaction (pointer down) and resumes on release',
          'Fetches live statistics: active societies count, approved sellers count, active category groups count',
          'Slides are CMS-configurable via system_settings (landingSlidesJson) — admin can define custom headings, subheadings, highlights, bullets, and CTAs',
          'If no CMS slides configured, falls back to default slides',
          'Displays parent group category cards (up to 6) with icons from the parent_groups table',
          'Slide indicator dots at bottom track active slide',
          'Navigation: "Get Started" button links to /auth, "Explore" button links to /landing',
          'If user is already authenticated with a profile, automatically redirects to Home (/)',
        ]} />
      </DocSection>

      {/* ─── LandingPage ─── */}
      <DocSection title="LandingPage — Public Marketing Page" id="landing-page">
        <p>The /landing route is the public-facing marketing page composed of modular sections:</p>
        <DocTable
          headers={['Section Component', 'Content']}
          rows={[
            ['LandingNav', 'Top navigation bar with platform logo and sign-in/get-started buttons'],
            ['LandingHero', 'Hero section with headline, subtext, and primary CTA'],
            ['LandingTrustBar', 'Social proof — live stats (societies, sellers, categories)'],
            ['LandingFeatures', 'Feature grid: Browse & Order, Home-Cooked Food, Local Services, UPI & COD, Reviews & Ratings'],
            ['LandingHowItWorks', 'Step-by-step guide showing the user journey'],
            ['LandingPricing', 'Pricing information (links to /pricing)'],
            ['LandingAbout', 'About the platform — mission and values'],
            ['LandingContact', 'Contact information and support channels'],
            ['LandingFooter', 'Footer with legal links, social links, and copyright'],
          ]}
        />
        <DocInfoCard variant="tip" title="Redirect Behavior">
          If a user is already authenticated with a profile, visiting /landing automatically redirects to Home (/).
        </DocInfoCard>
      </DocSection>

      {/* ─── ProfilePage ─── */}
      <DocSection title="ProfilePage — User Profile Management" id="profile-page">
        <p>The /profile route is the user's personal hub, showing account info, quick actions, and app settings.</p>

        <DocSubSection title="Profile Header">
          <DocList items={[
            'Tappable avatar — click to enter edit mode with ImageUpload component (upload new photo, stored in profiles.avatar_url)',
            'Cancel button to exit avatar edit mode',
            'Display name from profile.name',
            'Society name badge in primary color',
            'Address line: flat number, block, phase (from profile data)',
            'Phone number display',
            '"Verified Resident" badge — shown only when profile.verification_status is "approved"',
            'Skill badges row — up to 5 badges from skill_listings table, showing skill name and trust score (cached 15 min)',
          ]} />
        </DocSubSection>

        <DocSubSection title="Quick Actions Grid (3 columns)">
          <DocTable
            headers={['Icon', 'Label', 'Navigates to']}
            rows={[
              ['Package', 'Orders', '/orders'],
              ['Heart', 'Favorites', '/favorites'],
              ['Repeat', 'Order Again', '/orders'],
            ]}
          />
        </DocSubSection>

        <DocSubSection title="Quick Access Cards">
          <DocList items={[
            'Gate Entry card — "Show QR code to security" (only visible when resident_identity_verification feature is enabled for society)',
            'Start Selling card — "Start selling to your community" (only visible when user is NOT already a seller); green accent background',
          ]} />
        </DocSubSection>

        <DocSubSection title="Accessibility">
          <DocList items={[
            'Larger Text toggle (Switch) — adds large-font class to html element',
            'Persisted via app_large_font flag in local storage',
          ]} />
        </DocSubSection>

        <DocSubSection title="Menu Items">
          <p>Split into two sections: "Your Information" and "Legal & Support"</p>
          <DocTable
            headers={['Icon', 'Label', 'Route', 'Condition']}
            rows={[
              ['Award', 'Community Directory', '/directory', 'Always'],
              ['Building2', 'Builder Dashboard', '/builder', 'Only if user is builder member'],
              ['Store', 'Seller Dashboard', '/seller', 'Only if user is seller'],
              ['Bell', 'Notifications', '/notifications', 'Always'],
              ['HelpCircle', 'Help & Guide', '/help', 'Always'],
              ['Shield', 'Admin Panel', '/admin', 'Only if user is admin'],
              ['BookOpen', 'Platform Docs', '/platform-docs', 'Only if user is admin'],
              ['Bug', 'Push Debug', '/push-debug', 'Only if user is admin'],
              ['FileText', 'Privacy Policy', '/privacy-policy', 'Always (Legal section)'],
              ['FileText', 'Terms & Conditions', '/terms', 'Always (Legal section)'],
              ['FileText', 'Community Rules', '/community-rules', 'Always (Legal section)'],
            ]}
          />
        </DocSubSection>

        <DocSubSection title="Other Elements">
          <DocList items={[
            'NotificationHealthCheck component — monitors push notification registration status, shows warnings if notifications are not properly configured',
            'FeedbackSheet — triggered after seller onboarding completion (checks seller_onboarding_completed flag)',
            'Sign Out button — calls signOut, clears cache, navigates to /auth',
            'Delete Account section (Danger Zone) — DeleteAccountDialog component for permanent account deletion',
            'App version display: "{platformName} v{appVersion}" at the bottom',
          ]} />
        </DocSubSection>
      </DocSection>

      {/* ─── Verification Flow ─── */}
      <DocSection title="Verification & Approval Flow" id="verification">
        <DocList items={[
          'After signup and email verification, user\'s verification_status is "pending" by default',
          'If society has auto_approve_residents = true, status is set to "approved" immediately via database trigger',
          'Otherwise, user sees VerificationPendingScreen — explains account is under admin review',
          'Admin approves/rejects users from Admin Panel → Users tab',
          'Once approved, user sees OnboardingWalkthrough on first visit — multi-step carousel introducing features',
          'Walkthrough completion stored per-user to prevent repeat display',
          'Incomplete profile banner appears on Home page if flat_number is missing: "Complete your profile to enable delivery orders" with link to /profile',
        ]} />
      </DocSection>

      {/* ─── Database ─── */}
      <DocSection title="Database & Security Architecture" id="database">
        <DocTable
          headers={['Table', 'Key Fields', 'Purpose']}
          rows={[
            ['profiles', 'id, email, name, phone, flat_number, block, phase, society_id, verification_status, avatar_url', 'User profile with society association'],
            ['societies', 'id, name, address, city, state, pincode, latitude, longitude, auto_approve_residents, is_active, invite_code', 'Residential society/community'],
            ['user_roles', 'user_id, role', 'Role assignments (buyer, seller, admin, security_officer)'],
            ['society_requests', 'name, address, city, pincode, contact, status', 'New society registration requests'],
          ]}
        />
        <DocInfoCard variant="warning" title="Security">
          <DocList items={[
            'RLS policies ensure users can only read/update their own profile',
            'handle_new_user() trigger creates profile and buyer role on signup',
            'auto_approve_resident() trigger handles automatic verification for configured societies',
            'Roles stored in separate user_roles table (never on profiles) to prevent privilege escalation',
            'Route guards: ProtectedRoute, AdminRoute, SellerRoute, SecurityRoute, BuilderRoute, SocietyAdminRoute, ManagementRoute',
          ]} />
        </DocInfoCard>
      </DocSection>
    </div>
  );
}
