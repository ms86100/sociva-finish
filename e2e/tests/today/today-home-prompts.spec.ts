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
      CapacitorCustomPlatform: { name: string };
      Capacitor: { isNativePlatform: () => boolean; getPlatform: () => string };
    };
    // index.html checks Capacitor before the library loads. The library then
    // reads CapacitorCustomPlatform and keeps that platform.
    win.CapacitorCustomPlatform = { name: nativePlatform };
    win.Capacitor = {
      isNativePlatform: () => true,
      getPlatform: () => nativePlatform,
    };
  }, platform);
}

async function pinNearSalon(page: Page) {
  await page.addInitScript((pin) => {
    localStorage.setItem('sociva_location_onboarding_done_v1', '1');
    localStorage.setItem('sociva_browsing_location', JSON.stringify(pin));
    localStorage.setItem(
      'sociva_last_browsing_coords',
      JSON.stringify({ lat: pin.lat, lng: pin.lng, label: pin.label }),
    );
  }, NEAR_SALON);
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

  await expect(page.getByRole('button', { name: 'Home' })).toBeVisible();
  await expect(page.getByRole('heading', { name: /What Your Neighbor Makes/ })).toHaveCount(0);
  await expect(page.getByText('Discover more around you')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Enable Location' })).toHaveCount(0);
  await expect(page.getByText('Precise location required')).toHaveCount(0);
  await expect(page.getByText('Hear it when your order moves')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Turn on notifications' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'iOS - Update' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Android - Update' })).toHaveCount(0);
});

test('an enabled app update on Android offers only Google Play', async ({ page }) => {
  await pretendNativeApp(page, 'android');
  await pinNearSalon(page);
  await page.route('**/rest/v1/app_update_notices*', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        enabled: true,
        title: 'A better Sociva is ready',
        message: 'Update the app to see the latest menus, orders, and delivery updates.',
      }),
    });
  });
  await page.goto('/#/');

  await expect(page.getByRole('button', { name: 'Home' })).toBeVisible();
  await expect(page.getByText('A better Sociva is ready')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Android - Update' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'iOS - Update' })).toHaveCount(0);
});

test('an enabled app update on iOS offers only the App Store', async ({ page }) => {
  await pretendNativeApp(page, 'ios');
  await pinNearSalon(page);
  await page.route('**/rest/v1/app_update_notices*', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        enabled: true,
        title: 'A better Sociva is ready',
        message: 'Update the app to see the latest menus, orders, and delivery updates.',
      }),
    });
  });
  await page.goto('/#/');

  await expect(page.getByRole('button', { name: 'Home' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'iOS - Update' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Android - Update' })).toHaveCount(0);
});

test('the public website stays on the marketing page without the app prompts', async ({ page }) => {
  await page.goto('/#/');

  await expect(page.getByRole('button', { name: 'Join Your Society' }).first()).toBeVisible();
  await expect(page.getByText('Discover more around you')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Enable Location' })).toHaveCount(0);
  await expect(page.getByText('Hear it when your order moves')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Android - Update' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'iOS - Update' })).toHaveCount(0);
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
