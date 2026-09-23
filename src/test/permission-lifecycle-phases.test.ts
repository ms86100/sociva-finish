import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const root = resolve(__dirname, '../..');
const read = (rel: string) => readFileSync(resolve(root, rel), 'utf8');

describe('permission lifecycle phases 2–4 (source)', () => {
  it('stops surprise OS notification prompts after login and checkout', () => {
    const auth = read('src/hooks/useAuthPage.ts');
    const cart = read('src/hooks/useCartPage.ts');
    expect(auth).toMatch(/markPostLoginPermissionSheet/);
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
    expect(sheet).toMatch(/consumePostLoginPermissionSheet/);
    expect(sheet).toMatch(/shouldDeferPostLoginPermissionSheet/);
    expect(sheet).toMatch(/peekPostLoginPermissionSheet/);
  });

  it('defers post-login sheet on checkout and dismisses without awaiting Preferences', () => {
    const hook = read('src/hooks/usePermissionLifecycle.ts');
    const rules = read('src/lib/permission-prompt-rules.ts');
    const center = read('src/components/permissions/PermissionCenter.tsx');
    expect(hook).toMatch(/shouldDeferPostLoginPermissionSheet/);
    expect(rules).toMatch(/path === '\/cart'/);
    // Close UI first, then fire-and-forget dismiss
    expect(center).toMatch(/onDismissed\?\.\(\)/);
    expect(center).toMatch(/void dismissAll/);
    // Sheet stays interactive — toast, not notify.block for enable failure
    expect(center).toMatch(/toast\.(success|error)/);
    expect(center).not.toMatch(/notify\.block/);
    expect(center).toMatch(/z-\[260\]/);
  });

  it('enable notifications returns settings when OS still not granted', () => {
    const hook = read('src/hooks/usePermissionLifecycle.ts');
    expect(hook).toMatch(/void setPushStage\('full'\)/);
    expect(hook).toMatch(/return 'settings'/);
  });

  it('keeps home soft banner location-only (notifications via profile/sheet)', () => {
    const center = read('src/components/permissions/PermissionCenter.tsx');
    const bannerBranch = center.slice(center.indexOf("variant === 'banner'"));
    expect(bannerBranch).toMatch(/Discover more around you/);
    expect(bannerBranch).toMatch(/showLocSoftPrompt/);
    expect(bannerBranch).not.toMatch(/Don't miss what's happening nearby/);
  });

  it('uses Open Settings for denied location and notifications', () => {
    const loc = read('src/lib/location-settings.ts');
    const hook = read('src/hooks/usePermissionLifecycle.ts');
    expect(loc).toMatch(/openLocationSettings/);
    expect(hook).toMatch(/settings/);
    expect(hook).toMatch(/COOLDOWN_MS/);
  });

  it('admin diagnostics include permission health summary RPC', () => {
    const admin = read('src/components/admin/NotificationDiagnostics.tsx');
    expect(admin).toMatch(/admin_permission_health_summary/);
    expect(admin).toMatch(/Permission Health/);
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
