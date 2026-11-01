import { test, expect, type Page } from '@playwright/test';

/**
 * Today's buyer-facing changes, in headless Chrome.
 *
 * The website sends guests to the marketing page before React boots unless
 * window.Capacitor.isNativePlatform() is already true. These tests set that
 * the same way the installed app does, then check the screens.
 *
 * This does not grant OS location or push permission, and it does not invent
 * a device token. Those only exist on a phone.
 */

const NEAR_SALON = {
  id: 'gps',
  label: 'Test pin',
  lat: 13.0716,
  lng: 77.753,
  source: 'gps',
};

async function pretendNativeApp(page: Page, platform: 'ios' | 'android') {
  await page.addInitScript((nativePlatform) => {
    const win = window as unknown as {
      CapacitorCustomPlatform?: { name: string };
      Capacitor?: {
        isNativePlatform?: () => boolean;
        getPlatform?: () => string;
        convertFileSrc?: (url: string) => string;
        Plugins?: Record<string, unknown>;
      };
    };
    // Preferred Capacitor test hook - read by @capacitor/core on boot.
    win.CapacitorCustomPlatform = { name: nativePlatform };
    // index.html also checks window.Capacitor before the bundle loads.
    // Keep a bridge-friendly stub; do not wipe Plugins if Capacitor already exists.
    const existing = win.Capacitor;
    if (existing) {
      existing.isNativePlatform = () => true;
      existing.getPlatform = () => nativePlatform;
      if (!existing.convertFileSrc) existing.convertFileSrc = (url: string) => url;
      if (!existing.Plugins) existing.Plugins = {};
    } else {
      win.Capacitor = {
        isNativePlatform: () => true,
        getPlatform: () => nativePlatform,
        convertFileSrc: (url: string) => url,
        Plugins: {},
      };
    }
  }, platform);
}

/** Wait until HTML boot splash is gone and the app shell is interactive. */
async function waitForAppShell(page: Page) {
  await expect(page.locator('#boot-splash')).toBeHidden({ timeout: 45_000 });
  await expect(page.getByRole('button', { name: 'Home' })).toBeVisible({ timeout: 30_000 });
}

async function pinNearSalon(page: Page) {
  await page.addInitScript((pin) => {
    localStorage.setItem('sociva_location_onboarding_done_v1', '1');
    localStorage.setItem('sociva_browsing_location', JSON.stringify(pin));
    localStorage.setItem(
      'sociva_last_browsing_coords',
      JSON.stringify({ lat: pin.lat, lng: pin.lng, label: pin.label }),
    );
    // Soft-update dismiss memory must not leak across E2E tests on this origin.
    for (let i = localStorage.length - 1; i >= 0; i -= 1) {
      const key = localStorage.key(i);
      if (key && key.startsWith('sociva_update_dismissed_')) localStorage.removeItem(key);
    }
  }, NEAR_SALON);
}

async function mockEnabledAppUpdate(page: Page) {
  await page.route('**/app_update_notices**', async (route) => {
    if (route.request().method() === 'OPTIONS') {
      await route.fulfill({ status: 204, body: '' });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: {
        'Content-Range': '0-0/1',
        Prefer: 'return=representation',
      },
      body: JSON.stringify({
        enabled: true,
        title: 'A better Sociva is ready',
        message: 'Update the app to see the latest menus, orders, and delivery updates.',
        latest_version: null,
      }),
    });
  });
}

test('location discovery keeps Use my location and drops the extra Enable Location card', async ({ page }) => {
  await pretendNativeApp(page, 'ios');
  await page.goto('/#/discover-location');

  await expect(page.getByRole('heading', { name: /Discover what's available near you/ })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Use my location' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Select my location manually' })).toBeVisible();
  await expect(page.getByText('Discover more around you')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Enable Location' })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: /What Your Neighbor Makes/ })).toHaveCount(0);
});

test('home with a saved pin does not repeat the location card or an update banner', async ({ page }) => {
  await pretendNativeApp(page, 'android');
  await pinNearSalon(page);
  await page.goto('/#/');
  await waitForAppShell(page);

  await expect(page.getByRole('heading', { name: /What Your Neighbor Makes/ })).toHaveCount(0);
  await expect(page.getByText('Discover more around you')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Enable Location' })).toHaveCount(0);
  await expect(page.getByText('Precise location required')).toHaveCount(0);
  // Stay in the Loop is signed-in only - guests must not see a notification soft-ask.
  await expect(page.getByText('Stay in the Loop!')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Turn On Notifications' })).toHaveCount(0);
  await expect(page.getByText('Hear it when your order moves')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'iOS - Update' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Android - Update' })).toHaveCount(0);
});

test('an enabled app update on Android offers only Google Play', async ({ page }) => {
  await pretendNativeApp(page, 'android');
  await pinNearSalon(page);
  await mockEnabledAppUpdate(page);
  await page.goto('/#/');
  await waitForAppShell(page);

  await expect(page.getByText('A better Sociva is ready')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole('button', { name: 'Android - Update' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'iOS - Update' })).toHaveCount(0);
});

test('an enabled app update on iOS offers only the App Store', async ({ page }) => {
  await pretendNativeApp(page, 'ios');
  await pinNearSalon(page);
  await mockEnabledAppUpdate(page);
  await page.goto('/#/');
  await waitForAppShell(page);

  await expect(page.getByText('A better Sociva is ready')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole('button', { name: 'iOS - Update' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Android - Update' })).toHaveCount(0);
});

test('the public website stays on the marketing page without the app prompts', async ({ page }) => {
  await page.goto('/#/');

  await expect(page.getByRole('button', { name: 'Join Your Society' }).first()).toBeVisible();
  await expect(page.getByText('Discover more around you')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Enable Location' })).toHaveCount(0);
  await expect(page.getByText('Hear it when your order moves')).toHaveCount(0);
  await expect(page.getByText('Stay in the Loop!')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Android - Update' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'iOS - Update' })).toHaveCount(0);
});

test('an old what is new store link opens the store page', async ({ page }) => {
  await pretendNativeApp(page, 'ios');
  await pinNearSalon(page);
  const id = '11111111-1111-4111-8111-111111111111';
  await page.goto(`/#/sellers/${id}`);
  await expect(page.locator('#boot-splash')).toBeHidden({ timeout: 45_000 });
  await expect(page).toHaveURL(new RegExp(`#/seller/${id}`), { timeout: 15_000 });
  await expect(page.getByRole('heading', { name: 'Page not found' })).toHaveCount(0);
  await expect(page.getByText('Seller not found')).toBeVisible();
});

test('search shows the priced gentleman package', async ({ page }) => {
  await pretendNativeApp(page, 'android');
  await pinNearSalon(page);
  const crashes: string[] = [];
  page.on('pageerror', (err) => crashes.push(err.message));
  await page.goto('/#/search');
  const crashed = page.getByRole('heading', { name: 'Error loading Search' });
  const box = page.getByRole('textbox').first();
  await expect(box.or(crashed)).toBeVisible();
  if (await crashed.isVisible()) {
    await page.getByText('Error Details (Dev)').click();
    const detail = await page.locator('pre').first().innerText();
    throw new Error(`${detail}\n${crashes.join('\n')}`);
  }

  await box.fill('Gentleman');

  const row = page.getByRole('button', { name: /Classic Gentleman/ });
  await expect(row.or(crashed)).toBeVisible();
  if (await crashed.isVisible()) {
    await page.getByText('Error Details (Dev)').click();
    const detail = await page.locator('pre').first().innerText();
    throw new Error(`${detail}\n${crashes.join('\n')}`);
  }
  await expect(row).toBeVisible();
  await expect(row).toContainText('₹849');
});
