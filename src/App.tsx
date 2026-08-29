// @ts-nocheck
import React, { useState, useEffect, lazy, Suspense, ComponentType, useRef } from "react";

// Fallback component shown when a lazy page fails to resolve
function LazyLoadFailed() {
  return (
    <div className="min-h-[60vh] flex flex-col items-center justify-center p-6">
      <div className="w-16 h-16 rounded-full bg-destructive/10 flex items-center justify-center mb-4">
        <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-destructive"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>
      </div>
      <h2 className="text-lg font-semibold text-center mb-1">Page failed to load</h2>
      <p className="text-sm text-muted-foreground text-center mb-6 max-w-xs">This page could not be loaded. Please reload to try again.</p>
      <button onClick={() => window.location.reload()} className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium">Reload App</button>
    </div>
  );
}

// Retry wrapper for lazy imports — handles stale chunks AND undefined exports (React #306)
function lazyWithRetry<T extends ComponentType<any>>(
  factory: () => Promise<{ default: T }>,
  retries = 2,
): React.LazyExoticComponent<T> {
  return lazy(async () => {
    let lastError: unknown;
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const mod = await factory();
        // Guard against React error #306: module loaded but default export is undefined/null
        if (!mod || typeof mod.default !== 'function') {
          console.error('[lazyWithRetry] Module loaded but default export is invalid:', mod);
          return { default: LazyLoadFailed as unknown as T };
        }
        return mod;
      } catch (err) {
        lastError = err;
        const canRetry =
          attempt < retries &&
          String(err).includes('Failed to fetch dynamically imported module');
        if (!canRetry) break;
        await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
      }
    }
    console.error('[lazyWithRetry] Import failed:', lastError);
    return { default: LazyLoadFailed as unknown as T };
  });
}
import { supabase } from "@/integrations/supabase/client";
import { IdentityContext as IdentityCtx, SellerContext as SellerCtx } from "@/contexts/auth/contexts";

import { ThemeProvider, useTheme } from "next-themes";
import { toast } from "sonner";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { ActionBlockedDialog } from "@/components/feedback/ActionBlockedDialog";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider, QueryCache, MutationCache } from "@tanstack/react-query";
import { HashRouter, Routes, Route, Navigate, useNavigate } from "react-router-dom";
import { Capacitor } from "@capacitor/core";
import { syncStatusBarForTheme } from "@/lib/capacitor";

/** Keeps native status-bar icon contrast aligned with app theme. */
function ThemeStatusBarSync() {
  const { resolvedTheme, theme } = useTheme();
  useEffect(() => {
    syncStatusBarForTheme(resolvedTheme || theme || 'dark');
  }, [resolvedTheme, theme]);
  return null;
}
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { CartProvider } from "@/hooks/useCart";
import { CartPopupProvider } from "@/components/CartPopupProvider";
import { BrowsingLocationProvider } from "@/contexts/BrowsingLocationContext";
import { OfflineBanner } from "@/components/network/OfflineBanner";
import { PushNotificationProvider } from "@/components/notifications/PushNotificationProvider";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { RouteErrorBoundary } from "@/components/RouteErrorBoundary";
import { GlobalHapticListener } from "@/components/haptics/GlobalHapticListener";
import { KeyboardAwareInputs } from "@/components/haptics/KeyboardAwareInputs";
import { initializeMedianBridge } from "@/lib/median";
import { useDeepLinks, consumePendingDeepLink } from "@/hooks/useDeepLinks";
import { useAndroidBackButton } from "@/hooks/useAndroidBackButton";
import { useSecurityOfficer } from "@/hooks/useSecurityOfficer";
import { useAppLifecycle } from "@/hooks/useAppLifecycle";
import { useReorderInterceptor } from "@/hooks/useReorderInterceptor";
import { useNewOrderAlert } from "@/hooks/useNewOrderAlert";
import { useSellerStatusNudge } from "@/hooks/useSellerStatusNudge";
import { useChatAlerts } from "@/hooks/useSellerChatAlerts";
import { NewOrderAlertProvider, useNewOrderAlertContext } from "@/contexts/NewOrderAlertContext";
import { NewOrderAlertOverlay } from "@/components/seller/NewOrderAlertOverlay";
import { FeedbackPopupProvider } from "@/components/FeedbackPopupProvider";
import { Skeleton } from "@/components/ui/skeleton";
import { PageTransitionWrapper } from "@/components/layout/PageTransitionWrapper";
import { AppShellGate } from "@/components/layout/AppShell";
import { AppSplashScreen } from "@/components/splash/AppSplashScreen";

// Cold-start guard: module-level flag resets only on full page reload
let splashShown = false;

// PERF: Only Home is eager — Cart/Orders/etc pull Razorpay, calendars, wallets into
// the main chunk and delay first paint. Idle prefetch warms them after paint.
import HomePage from "./pages/HomePage";
const CartPage = lazyWithRetry(() => import("./pages/CartPage"));
const OrdersPage = lazyWithRetry(() => import("./pages/OrdersPage"));
const ProfilePage = lazyWithRetry(() => import("./pages/ProfilePage"));
const SocietyDashboardPage = lazyWithRetry(() => import("./pages/SocietyDashboardPage"));
const SearchPage = lazyWithRetry(() => import("./pages/SearchPage"));

// Lazy-loaded pages for code splitting (secondary / infrequent routes)
const AuthPage = lazyWithRetry(() => import("./pages/AuthPage"));
const ResetPasswordPage = lazyWithRetry(() => import("./pages/ResetPasswordPage"));
const LandingPage = lazyWithRetry(() => import("./pages/LandingPage"));
const WelcomeCarousel = lazyWithRetry(() => import("./pages/WelcomeCarousel"));
const RefundPolicyPage = lazyWithRetry(() => import("./pages/RefundPolicyPage"));

const SellerDetailPage = lazyWithRetry(() => import("./pages/SellerDetailPage"));
const OrderDetailPage = lazyWithRetry(() => import("./pages/OrderDetailPage"));
const CheckoutDetailPage = lazyWithRetry(() => import("./pages/CheckoutDetailPage"));
const ProfileEditPage = lazyWithRetry(() => import("./pages/ProfileEditPage"));
const FavoritesPage = lazyWithRetry(() => import("./pages/FavoritesPage"));
const BecomeSellerPage = lazyWithRetry(() => import("./pages/BecomeSellerPage"));
const SellerDashboardPage = lazyWithRetry(() => import("./pages/SellerDashboardPage"));
const SellerProductsPage = lazyWithRetry(() => import("./pages/SellerProductsPage"));
const SellerCategoryRequestsPage = lazyWithRetry(() => import("./pages/SellerCategoryRequestsPage"));
const SellerProductFormPage = lazyWithRetry(() => import("./pages/SellerProductFormPage"));
const SellerSettingsPage = lazyWithRetry(() => import("./pages/SellerSettingsPage"));
const SellerEarningsPage = lazyWithRetry(() => import("./pages/SellerEarningsPage"));
const SellerWalletPage = lazyWithRetry(() => import("./pages/SellerWalletPage"));
const SellerCreditsPage = lazyWithRetry(() => import("./pages/SellerCreditsPage"));
const SellerPayoutsPage = lazyWithRetry(() => import("./pages/SellerPayoutsPage"));
const SellerMessagesPage = lazyWithRetry(() => import("./pages/SellerMessagesPage"));
const AdminPage = lazyWithRetry(() => import("./pages/AdminPage"));
const AdminFinancialTracePage = lazyWithRetry(() => import("./pages/AdminFinancialTracePage"));
const AdminFinancialControlsPage = lazyWithRetry(() => import("./pages/AdminFinancialControlsPage"));
const AdminRefundsPage = lazyWithRetry(() => import("./pages/AdminRefundsPage"));
const AdminSellerPayoutsPage = lazyWithRetry(() => import("./pages/AdminSellerPayoutsPage"));
const AdminSellerCreditsPage = lazyWithRetry(() => import("./pages/AdminSellerCreditsPage"));
const AdminCommandCenterPage = lazyWithRetry(() => import("./pages/AdminCommandCenterPage"));
const NotFound = lazyWithRetry(() => import("./pages/NotFound"));
const ProductDeepLinkPage = lazyWithRetry(() => import("./pages/ProductDeepLinkPage"));
const PrivacyPolicyPage = lazyWithRetry(() => import("./pages/PrivacyPolicyPage"));
const DeleteAccountPage = lazyWithRetry(() => import("./pages/DeleteAccountPage"));
const TermsPage = lazyWithRetry(() => import("./pages/TermsPage"));
const CategoryGroupPage = lazyWithRetry(() => import("./pages/CategoryGroupPage"));
const CategoriesPage = lazyWithRetry(() => import("./pages/CategoriesPage"));
const DiscoveryListingsPage = lazyWithRetry(() => import("./pages/DiscoveryListingsPage"));
const PricingPage = lazyWithRetry(() => import("./pages/PricingPage"));
const HelpPage = lazyWithRetry(() => import("./pages/HelpPage"));
const NotificationsPage = lazyWithRetry(() => import("./pages/NotificationsPage"));
const CommunityRulesPage = lazyWithRetry(() => import("./pages/CommunityRulesPage"));
const PushDebugPage = lazyWithRetry(() => import("./pages/PushDebugPage"));
const LiveActivityDebugPage = lazyWithRetry(() => import("./pages/LiveActivityDebugPage"));
const BulletinPage = lazyWithRetry(() => import("./pages/BulletinPage"));
const MySubscriptionsPage = lazyWithRetry(() => import("./pages/MySubscriptionsPage"));
const TrustDirectoryPage = lazyWithRetry(() => import("./pages/TrustDirectoryPage"));
const DisputesPage = lazyWithRetry(() => import("./pages/DisputesPage"));
const SocietyFinancesPage = lazyWithRetry(() => import("./pages/SocietyFinancesPage"));
const SocietyProgressPage = lazyWithRetry(() => import("./pages/SocietyProgressPage"));
const SnagListPage = lazyWithRetry(() => import("./pages/SnagListPage"));
const NotificationInboxPage = lazyWithRetry(() => import("./pages/NotificationInboxPage"));
const MaintenancePage = lazyWithRetry(() => import("./pages/MaintenancePage"));
const SocietyReportPage = lazyWithRetry(() => import("./pages/SocietyReportPage"));
const SocietyAdminPage = lazyWithRetry(() => import("./pages/SocietyAdminPage"));
const BuilderDashboardPage = lazyWithRetry(() => import("./pages/BuilderDashboardPage"));
const FestivalCollectionPage = lazyWithRetry(() => import("./pages/FestivalCollectionPage"));
const BuilderAnalyticsPage = lazyWithRetry(() => import("./pages/BuilderAnalyticsPage"));
const VehicleParkingPage = lazyWithRetry(() => import("./pages/VehicleParkingPage"));
const VisitorManagementPage = lazyWithRetry(() => import("./pages/VisitorManagementPage"));
const PaymentMilestonesPage = lazyWithRetry(() => import("./pages/PaymentMilestonesPage"));
const InspectionChecklistPage = lazyWithRetry(() => import("./pages/InspectionChecklistPage"));

const WorkforceManagementPage = lazyWithRetry(() => import("./pages/WorkforceManagementPage"));
const ParcelManagementPage = lazyWithRetry(() => import("./pages/ParcelManagementPage"));
const GuardKioskPage = lazyWithRetry(() => import("./pages/GuardKioskPage"));
const GateEntryPage = lazyWithRetry(() => import("./pages/GateEntryPage"));

const SecurityAuditPage = lazyWithRetry(() => import("./pages/SecurityAuditPage"));
const WorkerJobsPage = lazyWithRetry(() => import("./pages/WorkerJobsPage"));
const WorkerMyJobsPage = lazyWithRetry(() => import("./pages/WorkerMyJobsPage"));
const WorkerHirePage = lazyWithRetry(() => import("./pages/WorkerHirePage"));
const CreateJobRequestPage = lazyWithRetry(() => import("./pages/CreateJobRequestPage"));
const SocietyNoticesPage = lazyWithRetry(() => import("./pages/SocietyNoticesPage"));
const SocietyDeliveriesPage = lazyWithRetry(() => import("./pages/SocietyDeliveriesPage"));
const DeliveryPartnerManagementPage = lazyWithRetry(() => import("./pages/DeliveryPartnerManagementPage"));
const DeliveryPartnerDashboardPage = lazyWithRetry(() => import("./pages/DeliveryPartnerDashboardPage"));
const WorkerAttendancePage = lazyWithRetry(() => import("./pages/WorkerAttendancePage"));
const MyWorkersPage = lazyWithRetry(() => import("./pages/MyWorkersPage"));
const WorkerLeavePage = lazyWithRetry(() => import("./pages/WorkerLeavePage"));
const WorkerSalaryPage = lazyWithRetry(() => import("./pages/WorkerSalaryPage"));
const AuthorizedPersonsPage = lazyWithRetry(() => import("./pages/AuthorizedPersonsPage"));
const BuilderInspectionsPage = lazyWithRetry(() => import("./pages/BuilderInspectionsPage"));
const TestResultsPage = lazyWithRetry(() => import("./pages/TestResultsPage"));
const CollectiveBuyPage = lazyWithRetry(() => import("./pages/CollectiveBuyPage"));
const ApiDocsPage = lazyWithRetry(() => import("./pages/ApiDocsPage"));
const DocumentationPage = lazyWithRetry(() => import("./pages/DocumentationPage"));

/**
 * Detect if an error is caused by an expired/invalid auth session.
 * Covers Supabase JWT errors, PostgREST 401s, and common auth error messages.
 */
function isAuthSessionError(error: unknown): boolean {
  if (!error) return false;
  const msg = error instanceof Error ? error.message : String(error);
  const authPatterns = [
    'JWT expired', 'jwt expired', 'invalid claim', 'token is expired',
    'not authenticated', 'Invalid Refresh Token', 'Refresh Token Not Found',
    'Auth session missing', 'session_not_found',
  ];
  if (authPatterns.some(p => msg.toLowerCase().includes(p.toLowerCase()))) return true;
  if ((error as any)?.code === 'PGRST301') return true;
  if ((error as any)?.status === 401) return true;
  return false;
}

let authRedirectScheduled = false;
async function handleAuthError() {
  if (authRedirectScheduled) return;
  authRedirectScheduled = true;
  try {
    const { data, error } = await supabase.auth.refreshSession();
    if (!error && data.session) {
      console.log('[Auth] Recovered session after 401 via refreshSession');
      authRedirectScheduled = false;
      return;
    }
  } catch (e) {
    console.warn('[Auth] refreshSession after 401 failed:', e);
  }
  toast.error('Your session has expired. Please log in again.');
  supabase.auth.signOut().finally(() => {
    window.location.hash = '#/auth';
    setTimeout(() => { authRedirectScheduled = false; }, 3000);
  });
}

const queryClient = new QueryClient({
  queryCache: new QueryCache({
    onError: (error) => {
      console.error('[Query Error]', error);
      if (isAuthSessionError(error)) {
        handleAuthError();
      }
    },
  }),
  mutationCache: new MutationCache({
    onError: (error) => {
      console.error('[Mutation Error]', error);
      if (isAuthSessionError(error)) {
        handleAuthError();
        return;
      }
      const message = error instanceof Error ? error.message : 'Something went wrong';
      toast.error(message);
    },
  }),
  defaultOptions: {
    queries: {
      retry: (failureCount, error) => {
        if (isAuthSessionError(error)) return false;
        return failureCount < 1;
      },
      // Cap retry delay so a single network blip doesn't lock the UI for 20–30s.
      retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 4000),
      // If we're retrying because Supabase is unreachable, don't pile up requests.
      networkMode: 'online',
      staleTime: 10 * 60 * 1000,
      gcTime: 60 * 60 * 1000,
      refetchOnWindowFocus: false,
      refetchOnReconnect: true,
    },
    mutations: {
      retry: 0,
      networkMode: 'online',
    },
  },
});

function PageLoadingFallback() {
  return (
    <div className="min-h-[100dvh] bg-background p-4 space-y-4">
      <Skeleton className="h-14 w-full rounded-xl" />
      <Skeleton className="h-40 w-full rounded-xl" />
      <Skeleton className="h-24 w-full rounded-xl" />
      <Skeleton className="h-24 w-full rounded-xl" />
    </div>
  );
}

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, isSessionRestored } = useAuth();
  const [bootGaveUp, setBootGaveUp] = useState(false);

  // Only gate on session restore — profile fetch must not blank the shell again
  // after SplashGate (isLoading stays false after markBootComplete).
  useEffect(() => {
    if (isSessionRestored) return;
    const t = setTimeout(() => setBootGaveUp(true), 7000);
    return () => clearTimeout(t);
  }, [isSessionRestored]);

  if (!isSessionRestored && !bootGaveUp) {
    return null; // SplashGate overlay covers boot; avoid a second spinner
  }
  if (!user) {
    return <Navigate to="/auth" replace />;
  }
  return <>{children}</>;
}

function SocietyMemberRoute({ children }: { children: React.ReactNode }) {
  const { effectiveSocietyId, isAdmin, isLoading } = useAuth();
  if (isLoading) {
    return (
      <div className="min-h-[100dvh] flex items-center justify-center bg-background">
        <Skeleton className="h-6 w-32 rounded-lg" />
      </div>
    );
  }
  if (!effectiveSocietyId && !isAdmin) return <Navigate to="/" replace />;
  return <>{children}</>;
}

function AdminRoute({ children }: { children: React.ReactNode }) {
  const { isAdmin, isLoading } = useAuth();
  if (isLoading) {
    return (
      <div className="min-h-[100dvh] flex items-center justify-center bg-background">
        <Skeleton className="h-6 w-32 rounded-lg" />
      </div>
    );
  }
  if (!isAdmin) return <Navigate to="/" replace />;
  return <>{children}</>;
}

function SecurityRoute({ children }: { children: React.ReactNode }) {
  const { isSocietyAdmin, isAdmin, isLoading: authLoading } = useAuth();
  const { isSecurityOfficer, isLoading: officerLoading } = useSecurityOfficer();
  if (authLoading || officerLoading) {
    return (
      <div className="min-h-[100dvh] flex items-center justify-center bg-background">
        <Skeleton className="h-6 w-32 rounded-lg" />
      </div>
    );
  }
  if (!isSocietyAdmin && !isAdmin && !isSecurityOfficer) {
    return <Navigate to="/" replace />;
  }
  return <>{children}</>;
}

function SocietyAdminRoute({ children }: { children: React.ReactNode }) {
  const { isSocietyAdmin, isAdmin, isLoading } = useAuth();
  if (isLoading) return <div className="min-h-[100dvh] flex items-center justify-center bg-background"><Skeleton className="h-6 w-32 rounded-lg" /></div>;
  if (!isSocietyAdmin && !isAdmin) return <Navigate to="/" replace />;
  return <>{children}</>;
}

function BuilderRoute({ children }: { children: React.ReactNode }) {
  const { isBuilderMember, isAdmin, isLoading } = useAuth();
  if (isLoading) return <div className="min-h-[100dvh] flex items-center justify-center bg-background"><Skeleton className="h-6 w-32 rounded-lg" /></div>;
  if (!isBuilderMember && !isAdmin) return <Navigate to="/" replace />;
  return <>{children}</>;
}

function ManagementRoute({ children }: { children: React.ReactNode }) {
  const { isSocietyAdmin, isBuilderMember, isAdmin, isLoading } = useAuth();
  if (isLoading) return <div className="min-h-[100dvh] flex items-center justify-center bg-background"><Skeleton className="h-6 w-32 rounded-lg" /></div>;
  if (!isSocietyAdmin && !isBuilderMember && !isAdmin) return <Navigate to="/" replace />;
  return <>{children}</>;
}

function SellerRoute({ children }: { children: React.ReactNode }) {
  const { hasSellerProfile, isAdmin, isLoading } = useAuth();
  if (isLoading) return <div className="min-h-[100dvh] flex items-center justify-center bg-background"><Skeleton className="h-6 w-32 rounded-lg" /></div>;
  if (!hasSellerProfile && !isAdmin) return <Navigate to="/" replace />;
  return <>{children}</>;
}

function WorkerRoute({ children }: { children: React.ReactNode }) {
  const { roles, isAdmin, isLoading } = useAuth();
  if (isLoading) return <div className="min-h-[100dvh] flex items-center justify-center bg-background"><Skeleton className="h-6 w-32 rounded-lg" /></div>;
  if (!roles.includes('worker') && !isAdmin) return <Navigate to="/" replace />;
  return <>{children}</>;
}

function NavigationHandler() {
  const navigate = useNavigate();
  const { user, isSessionRestored } = useAuth();
  useEffect(() => {
    const cleanup = initializeMedianBridge(navigate);
    return cleanup;
  }, [navigate]);
  useDeepLinks();
  useAppLifecycle();
  useAndroidBackButton();

  // Warm bottom-nav + secondary chunks after session restore (idle).
  useEffect(() => {
    if (!isSessionRestored || !user) return;
    import('@/lib/route-prefetch').then(m => m.prefetchBuyerRoutes()).catch(() => {});
  }, [isSessionRestored, user]);

  return null;
}

/** Chat bell/toast for any authenticated user (buyer or seller). Single mount — avoid pairing with seller-only alerts. */
function GlobalChatAlerts() {
  const identity = React.useContext(IdentityCtx);
  const userId = identity?.user?.id ?? null;
  useChatAlerts(userId, !!userId);
  return null;
}

function GlobalSellerAlert() {
  const identity = React.useContext(IdentityCtx);
  const seller = React.useContext(SellerCtx);
  const isSeller = seller?.isSeller ?? false;
  // Buyers: skip order-alert polling + 600KB sound preload entirely.
  if (!identity || !isSeller) return null;
  return <GlobalSellerAlertActive />;
}

function GlobalSellerAlertActive() {
  const seller = React.useContext(SellerCtx);
  const { registerDismissById, registerDismissAll } = useNewOrderAlertContext();
  const sellerIds = React.useMemo(
    () => (seller?.sellerProfiles ? seller.sellerProfiles.map(p => p.id) : []),
    [seller?.sellerProfiles]
  );
  const { pendingAlerts, dismiss, dismissById, dismissAll, snooze } = useNewOrderAlert(sellerIds);
  const incomingActive = pendingAlerts.length > 0;
  const {
    pendingNudges,
    dismiss: dismissNudge,
    dismissById: dismissNudgeById,
    dismissAll: dismissAllNudges,
    snooze: snoozeNudge,
  } = useSellerStatusNudge(sellerIds, incomingActive);

  const overlayOrders = React.useMemo(() => {
    const incomingIds = new Set(pendingAlerts.map(o => o.id));
    const nudges = pendingNudges.filter(n => !incomingIds.has(n.id));
    return [...pendingAlerts, ...nudges];
  }, [pendingAlerts, pendingNudges]);

  const dismissTop = React.useCallback(() => {
    const top = overlayOrders[0];
    if (top?.alertKind === 'status_nudge') dismissNudge();
    else dismiss();
  }, [overlayOrders, dismiss, dismissNudge]);

  const dismissAllTop = React.useCallback(() => {
    dismissAll();
    dismissAllNudges();
  }, [dismissAll, dismissAllNudges]);

  const snoozeTop = React.useCallback((minutes?: number) => {
    const top = overlayOrders[0];
    if (top?.alertKind === 'status_nudge') snoozeNudge(minutes ?? 5);
    else snooze(minutes);
  }, [overlayOrders, snooze, snoozeNudge]);

  React.useEffect(() => {
    registerDismissById((orderId: string) => {
      dismissById(orderId);
      dismissNudgeById(orderId);
    });
    registerDismissAll(dismissAllTop);
  }, [dismissById, dismissNudgeById, dismissAllTop, registerDismissById, registerDismissAll]);

  return (
    <NewOrderAlertOverlay
      orders={overlayOrders}
      onDismiss={dismissTop}
      onDismissAll={dismissAllTop}
      onSnooze={snoozeTop}
      sellerProfiles={seller?.sellerProfiles || []}
    />
  );
}

class SafeSellerAlert extends React.Component<
  { children: React.ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(e: Error) { console.error('[SafeSellerAlert] Contained crash:', e); }
  render() { return this.state.failed ? null : this.props.children; }
}

function AppRoutes() {
  const { user, profile, isSessionRestored, isSigningOut } = useAuth();
  const deferredNavigate = useNavigate();
  useReorderInterceptor();

  // Consume pending deep link after auth hydration completes
  useEffect(() => {
    if (!user || !profile) return; // Wait for full auth + profile hydration
    const timer = setTimeout(() => {
      const pendingPath = consumePendingDeepLink();
      if (pendingPath) {
        // Deduplicate: skip if we're already on the target path
        const currentHash = window.location.hash.replace(/^#/, '') || '/';
        if (currentHash === pendingPath) {
          console.log('[AppRoutes] Already on deep link path, skipping:', pendingPath);
          return;
        }
        console.log('[AppRoutes] Navigating to deferred deep link:', pendingPath);
        deferredNavigate(pendingPath, { state: { from: 'deeplink' } });
      }
    }, 300); // Allow more time for context providers to initialize
    return () => clearTimeout(timer);
  }, [user, profile, deferredNavigate]);

  // Session restore only for splash — do not wait on profile for the shell.
  // Incomplete users (profile loaded, no society_id) complete delivery-address onboarding.
  // Require `profile` so a null hydration state does not bounce returning users to edit.
  const sessionPending = !isSessionRestored;
  const authedHome = !!(user && profile?.society_id && !isSigningOut);
  const needsSocietyOnboarding = !!(user && !isSigningOut && profile && !profile.society_id);

  return (
    <PageTransitionWrapper>
    <Suspense fallback={<PageLoadingFallback />}>
      <Routes>
        {/* Native apps: never show marketing welcome/landing — fixed login only */}
        <Route
          path="/welcome"
          element={
            sessionPending ? (
              <PageLoadingFallback />
            ) : authedHome ? (
              <Navigate to="/" replace />
            ) : needsSocietyOnboarding ? (
              <Navigate to="/profile/edit" replace />
            ) : Capacitor.isNativePlatform() ? (
              <Navigate to="/auth" replace />
            ) : (
              <WelcomeCarousel />
            )
          }
        />
        <Route
          path="/landing"
          element={
            sessionPending ? (
              <PageLoadingFallback />
            ) : authedHome ? (
              <Navigate to="/" replace />
            ) : needsSocietyOnboarding ? (
              <Navigate to="/profile/edit" replace />
            ) : Capacitor.isNativePlatform() ? (
              <Navigate to="/auth" replace />
            ) : (
              <LandingPage />
            )
          }
        />
        <Route
          path="/auth"
          element={
            sessionPending ? (
              <PageLoadingFallback />
            ) : authedHome ? (
              <Navigate to="/" replace />
            ) : needsSocietyOnboarding ? (
              <Navigate to="/profile/edit" replace />
            ) : (
              <RouteErrorBoundary sectionName="Authentication"><AuthPage /></RouteErrorBoundary>
            )
          }
        />
        <Route path="/reset-password" element={<RouteErrorBoundary sectionName="Reset Password"><ResetPasswordPage /></RouteErrorBoundary>} />
        <Route path="/privacy-policy" element={<PrivacyPolicyPage />} />
        <Route path="/delete-account" element={<DeleteAccountPage />} />
        <Route path="/terms" element={<TermsPage />} />
        <Route path="/pricing" element={<PricingPage />} />
        <Route path="/refund-policy" element={<RefundPolicyPage />} />
        <Route path="/help" element={<HelpPage />} />
        <Route path="/community-rules" element={<CommunityRulesPage />} />

        {/* Persistent chrome shell — Header/BottomNav stay mounted across these routes */}
        <Route element={<AppShellGate />}>
          <Route path="/" element={<RouteErrorBoundary sectionName="Home"><HomePage /></RouteErrorBoundary>} />
          <Route path="/search" element={<RouteErrorBoundary sectionName="Search"><SearchPage /></RouteErrorBoundary>} />
          <Route path="/community" element={<RouteErrorBoundary sectionName="Community"><BulletinPage /></RouteErrorBoundary>} />
          <Route path="/categories" element={<RouteErrorBoundary sectionName="Categories"><CategoriesPage /></RouteErrorBoundary>} />
          <Route path="/category/:category" element={<RouteErrorBoundary sectionName="Category"><CategoryGroupPage /></RouteErrorBoundary>} />
          <Route path="/discovery/:type" element={<RouteErrorBoundary sectionName="Discovery"><DiscoveryListingsPage /></RouteErrorBoundary>} />
          <Route path="/seller/:id" element={<RouteErrorBoundary sectionName="Seller Store"><SellerDetailPage /></RouteErrorBoundary>} />
          <Route path="/product/:productId" element={<RouteErrorBoundary sectionName="Product"><ProductDeepLinkPage /></RouteErrorBoundary>} />
          <Route path="/festival-collection/:bannerId/:sectionId" element={<RouteErrorBoundary sectionName="Festival Collection"><FestivalCollectionPage /></RouteErrorBoundary>} />
          <Route path="/cart" element={<RouteErrorBoundary sectionName="Cart"><CartPage /></RouteErrorBoundary>} />
          <Route path="/orders" element={<RouteErrorBoundary sectionName="Orders"><OrdersPage /></RouteErrorBoundary>} />
          <Route path="/checkouts/:groupId" element={<RouteErrorBoundary sectionName="Checkout Details"><CheckoutDetailPage /></RouteErrorBoundary>} />
          <Route path="/orders/:id" element={<RouteErrorBoundary sectionName="Order Details"><OrderDetailPage /></RouteErrorBoundary>} />
          <Route path="/seller/orders" element={<Navigate to="/orders" replace />} />
          <Route path="/seller/orders/:id" element={<RouteErrorBoundary sectionName="Order Details"><OrderDetailPage /></RouteErrorBoundary>} />
          <Route path="/seller/messages" element={<RouteErrorBoundary sectionName="Seller Messages"><SellerMessagesPage /></RouteErrorBoundary>} />
          <Route path="/profile" element={<RouteErrorBoundary sectionName="Profile"><ProfilePage /></RouteErrorBoundary>} />
          <Route path="/profile/edit" element={<RouteErrorBoundary sectionName="Profile Edit"><ProfileEditPage /></RouteErrorBoundary>} />
          <Route path="/favorites" element={<RouteErrorBoundary sectionName="Favorites"><FavoritesPage /></RouteErrorBoundary>} />
          <Route path="/subscriptions" element={<RouteErrorBoundary sectionName="Subscriptions"><MySubscriptionsPage /></RouteErrorBoundary>} />
          <Route path="/directory" element={<RouteErrorBoundary sectionName="Directory"><TrustDirectoryPage /></RouteErrorBoundary>} />
          <Route path="/disputes" element={<RouteErrorBoundary sectionName="Disputes"><DisputesPage /></RouteErrorBoundary>} />
          <Route path="/group-buys" element={<RouteErrorBoundary sectionName="Group Buys"><CollectiveBuyPage /></RouteErrorBoundary>} />
          <Route path="/society/finances" element={<SocietyMemberRoute><RouteErrorBoundary sectionName="Society Finances"><SocietyFinancesPage /></RouteErrorBoundary></SocietyMemberRoute>} />
          <Route path="/society/progress" element={<SocietyMemberRoute><RouteErrorBoundary sectionName="Construction Progress"><SocietyProgressPage /></RouteErrorBoundary></SocietyMemberRoute>} />
          <Route path="/society/snags" element={<SocietyMemberRoute><RouteErrorBoundary sectionName="Snag List"><SnagListPage /></RouteErrorBoundary></SocietyMemberRoute>} />
          <Route path="/society" element={<SocietyMemberRoute><RouteErrorBoundary sectionName="Society Dashboard"><SocietyDashboardPage /></RouteErrorBoundary></SocietyMemberRoute>} />
          <Route path="/notifications/inbox" element={<RouteErrorBoundary sectionName="Notifications"><NotificationInboxPage /></RouteErrorBoundary>} />
          <Route path="/maintenance" element={<RouteErrorBoundary sectionName="Maintenance"><MaintenancePage /></RouteErrorBoundary>} />
          <Route path="/society/reports" element={<SocietyMemberRoute><RouteErrorBoundary sectionName="Society Reports"><SocietyReportPage /></RouteErrorBoundary></SocietyMemberRoute>} />
          <Route path="/society/admin" element={<SocietyAdminRoute><RouteErrorBoundary sectionName="Society Admin"><SocietyAdminPage /></RouteErrorBoundary></SocietyAdminRoute>} />
          <Route path="/builder" element={<BuilderRoute><RouteErrorBoundary sectionName="Builder Dashboard"><BuilderDashboardPage /></RouteErrorBoundary></BuilderRoute>} />
          <Route path="/builder/analytics" element={<BuilderRoute><RouteErrorBoundary sectionName="Builder Analytics"><BuilderAnalyticsPage /></RouteErrorBoundary></BuilderRoute>} />
          <Route path="/parking" element={<VehicleParkingPage />} />
          <Route path="/visitors" element={<VisitorManagementPage />} />
          <Route path="/payment-milestones" element={<PaymentMilestonesPage />} />
          <Route path="/inspection" element={<InspectionChecklistPage />} />
          <Route path="/domestic-help" element={<Navigate to="/workforce" replace />} />
          <Route path="/workforce" element={<WorkforceManagementPage />} />
          <Route path="/parcels" element={<ParcelManagementPage />} />
          <Route path="/guard-kiosk" element={<SecurityRoute><GuardKioskPage /></SecurityRoute>} />
          <Route path="/gate-entry" element={<GateEntryPage />} />
          <Route path="/security/verify" element={<Navigate to="/guard-kiosk" replace />} />
          <Route path="/security/audit" element={<SecurityRoute><SecurityAuditPage /></SecurityRoute>} />
          <Route path="/worker/jobs" element={<WorkerRoute><WorkerJobsPage /></WorkerRoute>} />
          <Route path="/worker/my-jobs" element={<WorkerRoute><WorkerMyJobsPage /></WorkerRoute>} />
          <Route path="/worker-hire" element={<WorkerHirePage />} />
          <Route path="/worker-hire/create" element={<CreateJobRequestPage />} />
          <Route path="/society/notices" element={<SocietyMemberRoute><SocietyNoticesPage /></SocietyMemberRoute>} />
          <Route path="/society/deliveries" element={<SocietyMemberRoute><SocietyDeliveriesPage /></SocietyMemberRoute>} />
          <Route path="/delivery-partners" element={<ManagementRoute><DeliveryPartnerManagementPage /></ManagementRoute>} />
          <Route path="/my-deliveries" element={<ManagementRoute><DeliveryPartnerDashboardPage /></ManagementRoute>} />
          <Route path="/worker-attendance" element={<ManagementRoute><WorkerAttendancePage /></ManagementRoute>} />
          <Route path="/my-workers" element={<MyWorkersPage />} />
          <Route path="/worker-leave" element={<ManagementRoute><WorkerLeavePage /></ManagementRoute>} />
          <Route path="/worker-salary" element={<ManagementRoute><WorkerSalaryPage /></ManagementRoute>} />
          <Route path="/authorized-persons" element={<AuthorizedPersonsPage />} />
          <Route path="/builder-inspections" element={<BuilderRoute><BuilderInspectionsPage /></BuilderRoute>} />
          <Route path="/become-seller" element={<RouteErrorBoundary sectionName="Seller Onboarding"><BecomeSellerPage /></RouteErrorBoundary>} />
          <Route path="/seller" element={<SellerRoute><RouteErrorBoundary sectionName="Seller Dashboard"><SellerDashboardPage /></RouteErrorBoundary></SellerRoute>} />
          <Route path="/seller/products" element={<SellerRoute><RouteErrorBoundary sectionName="Products"><SellerProductsPage /></RouteErrorBoundary></SellerRoute>} />
          <Route path="/seller/products/new" element={<SellerRoute><RouteErrorBoundary sectionName="Add Product"><SellerProductFormPage /></RouteErrorBoundary></SellerRoute>} />
          <Route path="/seller/products/:productId/edit" element={<SellerRoute><RouteErrorBoundary sectionName="Edit Product"><SellerProductFormPage /></RouteErrorBoundary></SellerRoute>} />
          <Route path="/seller/category-requests" element={<SellerRoute><RouteErrorBoundary sectionName="Category Requests"><SellerCategoryRequestsPage /></RouteErrorBoundary></SellerRoute>} />
          <Route path="/seller/settings" element={<SellerRoute><RouteErrorBoundary sectionName="Seller Settings"><SellerSettingsPage /></RouteErrorBoundary></SellerRoute>} />
          <Route path="/seller/earnings" element={<SellerRoute><RouteErrorBoundary sectionName="Earnings"><SellerEarningsPage /></RouteErrorBoundary></SellerRoute>} />
          <Route path="/seller/wallet" element={<SellerRoute><RouteErrorBoundary sectionName="Seller Wallet"><SellerWalletPage /></RouteErrorBoundary></SellerRoute>} />
          <Route path="/seller/credits" element={<SellerRoute><RouteErrorBoundary sectionName="Sociva Credits"><SellerCreditsPage /></RouteErrorBoundary></SellerRoute>} />
          <Route path="/seller/payouts" element={<SellerRoute><RouteErrorBoundary sectionName="Payouts"><SellerPayoutsPage /></RouteErrorBoundary></SellerRoute>} />
          <Route path="/admin" element={<AdminRoute><RouteErrorBoundary sectionName="Admin"><AdminPage /></RouteErrorBoundary></AdminRoute>} />
          <Route path="/admin/financial-trace" element={<AdminRoute><RouteErrorBoundary sectionName="Financial Trace"><AdminFinancialTracePage /></RouteErrorBoundary></AdminRoute>} />
          <Route path="/admin/financial-controls" element={<AdminRoute><RouteErrorBoundary sectionName="Financial Controls"><AdminFinancialControlsPage /></RouteErrorBoundary></AdminRoute>} />
          <Route path="/admin/refunds" element={<AdminRoute><RouteErrorBoundary sectionName="Refunds"><AdminRefundsPage /></RouteErrorBoundary></AdminRoute>} />
          <Route path="/admin/seller-payouts" element={<AdminRoute><RouteErrorBoundary sectionName="Seller Payouts"><AdminSellerPayoutsPage /></RouteErrorBoundary></AdminRoute>} />
          <Route path="/admin/seller-credits" element={<AdminRoute><RouteErrorBoundary sectionName="Monetization"><AdminSellerCreditsPage /></RouteErrorBoundary></AdminRoute>} />
          <Route path="/admin/command-center" element={<AdminRoute><RouteErrorBoundary sectionName="Command Center"><AdminCommandCenterPage /></RouteErrorBoundary></AdminRoute>} />
          <Route path="/test-results" element={<AdminRoute><TestResultsPage /></AdminRoute>} />
          <Route path="/api-docs" element={<AdminRoute><ApiDocsPage /></AdminRoute>} />
          <Route path="/docs" element={<DocumentationPage />} />
          <Route path="/notifications" element={<RouteErrorBoundary sectionName="Notifications"><NotificationsPage /></RouteErrorBoundary>} />
          <Route path="/push-debug" element={<PushDebugPage />} />
          <Route path="/la-debug" element={<LiveActivityDebugPage />} />
        </Route>

        <Route path="*" element={<NotFound />} />
      </Routes>
    </Suspense>
    </PageTransitionWrapper>
  );
}

function SplashGate({ children }: { children: React.ReactNode }) {
  const { isSessionRestored } = useAuth();
  const [splashDone, setSplashDone] = useState(splashShown);

  useEffect(() => {
    if (splashDone) splashShown = true;
  }, [splashDone]);

  // DEF-011: never leave #root display:none after splash / navigation
  useEffect(() => {
    const root = document.getElementById('root');
    if (!root) return;
    const ensureVisible = () => {
      if (root.style.display === 'none' || root.style.visibility === 'hidden') {
        root.style.display = '';
        root.style.visibility = '';
        root.style.opacity = '';
      }
    };
    ensureVisible();
    const obs = new MutationObserver(ensureVisible);
    obs.observe(root, { attributes: true, attributeFilter: ['style', 'class', 'hidden'] });
    return () => obs.disconnect();
  }, []);

  // Perf: render children IMMEDIATELY behind the splash overlay so the React
  // tree hydrates in parallel with the splash animation. The overlay sits on
  // top via z-index until ready + min-display elapsed.
  return (
    <>
      {children}
      {!splashDone && (
        <AppSplashScreen
          ready={isSessionRestored}
          onComplete={() => {
            const root = document.getElementById('root');
            if (root) {
              root.style.display = '';
              root.style.visibility = '';
              root.style.opacity = '';
            }
            setSplashDone(true);
          }}
        />
      )}
    </>
  );
}

function App() {
  const appStartRef = useRef(0);
  if (appStartRef.current === 0) {
    const now = performance.now();
    appStartRef.current = now;
    console.debug(`[App Perf] App function start: ${now.toFixed(0)}`);
  }

  useEffect(() => {
    const handler = () => queryClient.clear();
    window.addEventListener('app:clear-cache', handler);
    return () => window.removeEventListener('app:clear-cache', handler);
  }, []);

  useEffect(() => {
    const handleRejection = (event: PromiseRejectionEvent) => {
      const reason = event.reason;
      const msg = reason?.message || String(reason || '');
      const benign = [
        'Failed to fetch', 'NetworkError', 'Load failed',
        'JWT expired', 'Auth session missing', 'session_not_found',
        'Invalid Refresh Token', 'AbortError', 'REALTIME',
        'not authenticated', 'AuthRetryableFetchError',
        'AuthSessionMissingError', 'AuthApiError',
      ];
      const isBenign = benign.some(p => msg.includes(p));
      console.error('[Unhandled Rejection]', reason);
      event.preventDefault();
    };

    const handleError = (event: ErrorEvent) => {
      console.error('[Unhandled Error]', event.error || event.message);
    };

    window.addEventListener('unhandledrejection', handleRejection);
    window.addEventListener('error', handleError);
    return () => {
      window.removeEventListener('unhandledrejection', handleRejection);
      window.removeEventListener('error', handleError);
    };
  }, []);

  return (
    <ErrorBoundary>
      <ThemeProvider attribute="class" defaultTheme="dark" enableSystem={false} themes={['light', 'dark']}>
        <ThemeStatusBarSync />
        <QueryClientProvider client={queryClient}>
          <TooltipProvider>
            <OfflineBanner />
            <Sonner />
            <HashRouter>
              <ActionBlockedDialog />
              <GlobalHapticListener />
              <KeyboardAwareInputs />
              <FeedbackPopupProvider>
                <AuthProvider>
                  <SplashGate>
                    <NavigationHandler />
                <BrowsingLocationProvider>
                  <CartPopupProvider>
                    <CartProvider>
                      <NewOrderAlertProvider>
                      <PushNotificationProvider>
                        <GlobalChatAlerts />
                        <SafeSellerAlert><GlobalSellerAlert /></SafeSellerAlert>
                          <AppRoutes />
                      </PushNotificationProvider>
                      </NewOrderAlertProvider>
                    </CartProvider>
                  </CartPopupProvider>
                </BrowsingLocationProvider>
                </SplashGate>
              </AuthProvider>
            </FeedbackPopupProvider>
            </HashRouter>
          </TooltipProvider>
        </QueryClientProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
