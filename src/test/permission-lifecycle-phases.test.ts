import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const root = resolve(__dirname, '../..');
const read = (rel: string) => readFileSync(resolve(root, rel), 'utf8');

describe('permission lifecycle phases 2-4 (source)', () => {
  it('stops surprise OS notification prompts after login and checkout', () => {
    const auth = read('src/hooks/useAuthPage.ts');
    const authState = read('src/contexts/auth/useAuthState.ts');
    const cart = read('src/hooks/useCartPage.ts');
    expect(auth).toMatch(/markPostLoginPermissionSheet/);
    expect(authState).toMatch(/event === 'SIGNED_IN'/);
    expect(authState).toMatch(/markPostLoginPermissionSheet/);
    expect(auth).not.toMatch(/requestFullPermission\(\)/);
    expect(cart).not.toMatch(/requestFullPermission/);
  });

  it('exposes a single Permission Center for profile, home banner, and post-login sheet', () => {
    const center = read('src/components/permissions/PermissionCenter.tsx');
    const banner = read('src/components/notifications/EnableNotificationsBanner.tsx');
    const profile = read('src/pages/ProfilePage.tsx');
    const shell = read('src/components/layout/AppShell.tsx');
    const sheet = read('src/components/permissions/PostLoginPermissionSheet.tsx');

    expect(center).toMatch(/Get the most from Sociva/);
    expect(center).toMatch(/Open Settings/);
    expect(center).toMatch(/Maybe later/);
    expect(center).toMatch(/usePermissionLifecycle/);
    expect(banner).toMatch(/PermissionCenter/);
    expect(profile).toMatch(/PermissionCenter/);
    expect(shell).toMatch(/PostLoginPermissionSheet/);
    expect(sheet).toMatch(/shouldDeferPostLoginPermissionSheet/);
    expect(sheet).toMatch(/peekPostLoginPermissionSheet/);
    expect(sheet).toMatch(/pathname !== '\/'/);
    expect(sheet).not.toMatch(/consumePostLoginPermissionSheet/);
    const homeCard = read('src/components/notifications/HomePushEnableCard.tsx');
    expect(homeCard).toMatch(/shouldShowHomePushEnableCard/);
    expect(homeCard).toMatch(/Stay in the Loop|STAY_IN_THE_LOOP_COPY|notificationAskCopy/);
    expect(homeCard).toMatch(/hasSeenOnboarding/);
    expect(sheet).toMatch(/hasSeenOnboarding/);
  });

  it('defers post-login sheet on checkout and keeps home notif ask after Maybe later', () => {
    const hook = read('src/hooks/usePermissionLifecycle.ts');
    const rules = read('src/lib/permission-prompt-rules.ts');
    const center = read('src/components/permissions/PermissionCenter.tsx');
    expect(hook).toMatch(/shouldDeferPostLoginPermissionSheet/);
    expect(rules).toMatch(/path === '\/cart'/);
    expect(rules).toMatch(/shouldShowHomePushEnableCard/);
    // Close UI first; do not cool down notifications - reopen home ask
    expect(center).toMatch(/onDismissed\?\.\(\)/);
    expect(center).toMatch(/reopenNotificationAsk/);
    expect(center).toMatch(/void dismissLocPrompt/);
    expect(center).not.toMatch(/void dismissAll/);
    // Sheet stays interactive - toast, not notify.block for enable failure
    expect(center).toMatch(/toast\.(success|error)/);
    expect(center).not.toMatch(/notify\.block/);
    expect(center).toMatch(/z-\[260\]/);
  });

  it('enable notifications returns settings when OS still not granted', () => {
    const hook = read('src/hooks/usePermissionLifecycle.ts');
    expect(hook).toMatch(/void setPushStage\('full'\)/);
    expect(hook).toMatch(/return 'settings'/);
  });

  it('keeps the home precise-location card and does not repeat Enable Location in the shell', () => {
    const shell = read('src/components/layout/AppShell.tsx');
    const layout = read('src/components/layout/AppLayout.tsx');
    const home = read('src/pages/HomePage.tsx');
    expect(shell).not.toMatch(/EnableNotificationsBanner/);
    expect(layout).not.toMatch(/EnableNotificationsBanner/);
    expect(home).toMatch(/PreciseLocationRequiredCard/);
    expect(shell).toMatch(/PostLoginPermissionSheet/);
  });

  it('uses Open Settings for denied location and notifications', () => {
    const loc = read('src/lib/location-settings.ts');
    const hook = read('src/hooks/usePermissionLifecycle.ts');
    const native = read('src/lib/native-location.ts');
    expect(loc).toMatch(/openLocationSettings/);
    expect(hook).toMatch(/settings/);
    expect(hook).toMatch(/COOLDOWN_MS/);
    expect(native).toMatch(/coarseLocation/);
    expect(native).toMatch(/return 'unavailable'/);
    expect(native).toMatch(/read\(false\)/);
  });

  it('admin diagnostics include permission health summary RPC', () => {
    const admin = read('src/components/admin/NotificationDiagnostics.tsx');
    expect(admin).toMatch(/admin_permission_health_summary/);
    expect(admin).toMatch(/Permission Health/);
  });

  it('onboarding never requests notification permission', () => {
    const walkthrough = read('src/components/onboarding/OnboardingWalkthrough.tsx');
    const home = read('src/pages/HomePage.tsx');
    expect(walkthrough).not.toMatch(/requestPermissions|requestFullPermission|PushNotifications/);
    expect(home).not.toMatch(/completeOnboarding[\s\S]{0,200}request(FullPermission|Permissions)/);
  });

  it('soft update banner uses version gate and dismiss memory', () => {
    const banner = read('src/components/home/AppUpdateBanner.tsx');
    const gate = read('src/components/system/MinVersionGate.tsx');
    const policy = read('src/lib/app-update-policy.ts');
    expect(banner).toMatch(/shouldShowSoftUpdate|latest_version/);
    expect(banner).toMatch(/dismissUpdateVersion/);
    expect(gate).toMatch(/openAppStoreUrl/);
    expect(policy).toMatch(/isVersionBelow|shouldShowSoftUpdate/);
    expect(policy).toMatch(/Wait for App\.getInfo|if \(!installed\) return false/);
  });

  it('OS deny keeps Stay in the Loop card for Settings (does not card_dismiss)', () => {
    const homeCard = read('src/components/notifications/HomePushEnableCard.tsx');
    expect(homeCard).toMatch(/Declined OS dialog/);
    expect(homeCard).toMatch(/void refreshFromOs\(\)/);
    const denyBlock = homeCard.split('Declined OS dialog')[1]?.slice(0, 280) || '';
    expect(denyBlock).not.toMatch(/dismissNotifCard\(\)/);
  });

  it('Playwright defaults to local preview and refuses lovable.app without override', () => {
    const config = read('e2e/playwright.config.ts');
    expect(config).toMatch(/127\.0\.0\.1:4173/);
    expect(config).toMatch(/E2E_ALLOW_REMOTE/);
    expect(config).toMatch(/Refusing E2E against/);
    expect(config).not.toMatch(/BASE_URL \|\| 'https:\/\/sociva\.lovable\.app'/);
  });

  it('share helpers use OG /api/share paths for WhatsApp', () => {
    const share = read('src/lib/sociva-share.ts');
    const productApi = read('api/share/product/[id].ts');
    const storeApi = read('api/share/store/[id].ts');
    const productSheet = read('src/components/product/ProductDetailSheet.tsx');
    const storeShare = read('src/components/seller/ShareMyStore.tsx');

    expect(share).toMatch(/\/api\/share\/product\//);
    expect(share).toMatch(/\/api\/share\/store\//);
    expect(share).toMatch(/Found this on Sociva/);
    expect(productApi).toMatch(/og:image/);
    expect(productApi).toMatch(/og:image:secure_url/);
    expect(storeApi).toMatch(/og:image:secure_url/);
    expect(productSheet).toMatch(/shareSocivaContent/);
    expect(storeShare).toMatch(/shareSocivaContent/);
  });
});
