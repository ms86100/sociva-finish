import { test, expect, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const BASE = process.env.BASE_URL || 'http://127.0.0.1:4173';
const EVIDENCE = path.resolve(process.cwd(), 'qa-evidence/green-city-e2e-cert');
const GREENFIELD = {
  id: 'e2e-cert-greenfield',
  label: 'Shriram Greenfield',
  fullAddress: 'Shriram Greenfield Amenities',
  lat: 13.071288775343321,
  lng: 77.75139142429262,
  source: 'address' as const,
};

const ROUTES = [
  { hash: '#/cleaner-city', name: 'home' },
  { hash: '#/cleaner-city/find', name: 'find' },
  { hash: '#/cleaner-city/offer', name: 'offer' },
  { hash: '#/cleaner-city/route', name: 'route' },
  { hash: '#/cleaner-city/rides', name: 'rides' },
  { hash: '#/cleaner-city/vehicle', name: 'vehicle' },
  { hash: '#/cleaner-city/schedule', name: 'schedule' },
  { hash: '#/cleaner-city/setup', name: 'setup' },
  { hash: '#/cleaner-city/profile', name: 'profile' },
  { hash: '#/cleaner-city/safety', name: 'safety' },
  { hash: '#/cleaner-city/circles', name: 'circles' },
  { hash: '#/cleaner-city/chat', name: 'chat' },
] as const;

type Finding = {
  id: string;
  status: 'PASS' | 'FAIL' | 'BLOCKED' | 'PARTIAL';
  detail: string;
};

const findings: Finding[] = [];

function record(id: string, status: Finding['status'], detail: string) {
  findings.push({ id, status, detail });
}

async function seedLocation(page: Page) {
  await page.addInitScript((loc) => {
    try {
      localStorage.setItem('sociva_browsing_location', JSON.stringify({ ...loc, _user_id: null }));
      localStorage.setItem(
        'sociva_last_browsing_coords',
        JSON.stringify({ id: loc.id, label: loc.label, lat: loc.lat, lng: loc.lng, source: loc.source }),
      );
    } catch {
      /* ignore */
    }
  }, GREENFIELD);
}

async function dismissWalkthrough(page: Page) {
  const skip = page.getByRole('button', { name: /^Skip/i }).first();
  if (await skip.isVisible({ timeout: 5_000 }).catch(() => false)) {
    await skip.click();
    await expect(skip).toBeHidden({ timeout: 8_000 }).catch(() => undefined);
  }
}

async function goHash(page: Page, hash: string) {
  const normalized = hash.startsWith('#') ? hash : `#${hash}`;
  await page.goto(`${BASE}/${normalized}`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(900);
  // Soft assert: allow auth/feature redirects but record actual landing hash.
  await page.waitForLoadState('networkidle').catch(() => undefined);
}

async function loginPhone(page: Page) {
  await seedLocation(page);
  await page.goto(`${BASE}/#/auth`);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(700);
  if (!page.url().includes('/auth')) {
    await page.goto(`${BASE}/#/auth`);
    await page.waitForTimeout(700);
  }

  const phoneInput = page
    .locator('input[type="tel"], input[placeholder*="phone" i], input[name="phone"]')
    .first();
  await phoneInput.waitFor({ state: 'visible', timeout: 25_000 });
  await phoneInput.fill('0123456789');

  const age = page.locator('button[role="checkbox"]').first();
  if (await age.isVisible({ timeout: 2_000 }).catch(() => false)) {
    if ((await age.getAttribute('data-state')) !== 'checked') await age.click();
  }

  await page
    .locator('button:has-text("Send OTP"), button:has-text("Get OTP"), button:has-text("Continue")')
    .first()
    .click();
  await page.waitForTimeout(1000);

  const otpInputs = page.locator('input[maxlength="1"]');
  const count = await otpInputs.count();
  if (count >= 4) {
    for (let i = 0; i < 4 && i < count; i++) {
      await otpInputs.nth(i).click();
      await otpInputs.nth(i).fill('');
      await otpInputs.nth(i).pressSequentially(String(1234)[i], { delay: 40 });
    }
  } else {
    await page
      .locator('input[inputmode="numeric"], input[autocomplete="one-time-code"]')
      .first()
      .fill('1234');
  }

  const verify = page.locator('button:has-text("Verify")').first();
  if (await verify.isVisible({ timeout: 2_000 }).catch(() => false)) {
    await verify.click({ timeout: 5_000 }).catch(() => undefined);
  }
  await page.waitForURL((u) => !u.hash.includes('/auth'), { timeout: 45_000 });
  await dismissWalkthrough(page);
}

async function shot(page: Page, name: string) {
  fs.mkdirSync(EVIDENCE, { recursive: true });
  await page.screenshot({
    path: path.join(EVIDENCE, `${name}.png`),
    fullPage: true,
  });
}

function pageBodyText(page: Page) {
  return page.locator('main, [data-testid], body').first().innerText().catch(() => '');
}

test('GC00 login with Apple-review phone bypass @green-city @critical', async ({ page }) => {
  fs.mkdirSync(EVIDENCE, { recursive: true });
  try {
    await loginPhone(page);
    await shot(page, '00-after-login');
    record('GC00', 'PASS', `Logged in; url=${page.url()}`);
  } catch (e: any) {
    await shot(page, '00-login-fail');
    record('GC00', 'FAIL', e?.message || String(e));
    throw e;
  }
});

test('GC01 route inventory smoke @green-city @critical', async ({ page }) => {
  await loginPhone(page);

  const hardFails: string[] = [];
  for (const route of ROUTES) {
    await goHash(page, route.hash);
    await shot(page, `01-${route.name}`);
    const text = await pageBodyText(page);
    const blocked =
      /Feature Not Available|Something went wrong|ErrorBoundary|Application error|Route Error/i.test(
        text,
      );
    const urlOk = page.url().includes(route.hash.replace('#', ''));
    if (blocked) {
      record(`GC01-${route.name}`, 'FAIL', `Blocked or error on ${route.hash} → ${page.url()}`);
      hardFails.push(route.name);
    } else if (!urlOk) {
      record(`GC01-${route.name}`, 'PARTIAL', `Navigated but landed on ${page.url()}`);
    } else {
      record(`GC01-${route.name}`, 'PASS', `Opened ${route.hash}`);
    }
  }
  expect(hardFails, `Fatal UI on routes: ${hardFails.join(', ')}`).toEqual([]);
});

test('GC02 Offer underline tabs and vehicle seed @green-city @critical', async ({ page }) => {
  await loginPhone(page);
  await goHash(page, '#/cleaner-city/offer');
  await shot(page, '02-offer-landing');

  const tabLabels = ['Vehicle', 'Route', 'My week', 'This ride', 'My rides'];
  for (const label of tabLabels) {
    const tab = page.getByRole('tab', { name: label }).or(page.getByText(label, { exact: true })).first();
    const visible = await tab.isVisible({ timeout: 8_000 }).catch(() => false);
    if (!visible) {
      record(`GC02-tab-${label}`, 'FAIL', `Tab "${label}" not visible`);
      continue;
    }
    await tab.click({ timeout: 8_000 }).catch(() => undefined);
    await page.waitForTimeout(500);
    await shot(page, `02-tab-${label.toLowerCase().replace(/\s+/g, '-')}`);
    record(`GC02-tab-${label}`, 'PASS', `Opened ${label}`);
  }

  await page.getByText('Vehicle', { exact: true }).first().click().catch(() => undefined);
  await page.waitForTimeout(400);
  const body = await pageBodyText(page);
  if (/CERT KA01 TEST|CERT Sedan|No active vehicle|Add a vehicle/i.test(body)) {
    record('GC02-vehicle-seed', 'PASS', 'Vehicle tab shows seeded or empty-state CTA');
  } else {
    record('GC02-vehicle-seed', 'PARTIAL', 'Vehicle tab loaded without clear CERT plate text');
  }

  await page.getByText('This ride', { exact: true }).first().click().catch(() => undefined);
  await page.waitForTimeout(500);
  await shot(page, '02-this-ride');
  const thisRide = await pageBodyText(page);
  if (/Estimated fuel share|fuel share|petrol/i.test(thisRide)) {
    record('GC02-fuel-readonly', 'PASS', 'This ride shows automatic fuel copy');
  } else {
    record('GC02-fuel-readonly', 'PARTIAL', 'Fuel estimate copy not found on This ride');
  }
  expect(thisRide).not.toMatch(/Propose fuel|Enter fuel amount/i);
});

test('GC03 Find / Home discoverability @green-city', async ({ page }) => {
  await loginPhone(page);
  await goHash(page, '#/cleaner-city/find');
  await shot(page, '03-find');
  const findText = await pageBodyText(page);
  if (/Feature Not Available/i.test(findText)) {
    record('GC03-find', 'FAIL', 'cleaner_city feature gate blocked Find');
    expect(findText).not.toMatch(/Feature Not Available/i);
  } else {
    record('GC03-find', 'PASS', 'Find page rendered behind feature gate');
  }

  await goHash(page, '#/cleaner-city');
  await shot(page, '03-home');
  const homeText = await pageBodyText(page);
  record(
    'GC03-home',
    /Offer|Find|seat|ride|commute/i.test(homeText) ? 'PASS' : 'PARTIAL',
    'Home commute hub content check',
  );
});

test('GC04 My week spacing regression @green-city', async ({ page }) => {
  await loginPhone(page);
  await goHash(page, '#/cleaner-city/offer');
  const weekTab = page.getByText('My week', { exact: true }).first();
  await weekTab.click();
  await page.waitForTimeout(600);
  await shot(page, '04-my-week');

  const continueBtn = page.getByRole('button', { name: /Continue to this ride/i }).first();
  const weekCard = page.getByTestId('cleaner-city-weekly-plan').first();
  if (
    (await continueBtn.isVisible().catch(() => false)) &&
    (await weekCard.isVisible().catch(() => false))
  ) {
    const a = await weekCard.boundingBox();
    const b = await continueBtn.boundingBox();
    if (a && b) {
      const gap = b.y - (a.y + a.height);
      if (gap >= 12) {
        record('GC04-week-gap', 'PASS', `Gap between week card and Continue = ${Math.round(gap)}px`);
      } else {
        record('GC04-week-gap', 'FAIL', `Cards still attached; gap=${Math.round(gap)}px`);
        expect(gap, 'My week card must not sit flush on Continue').toBeGreaterThanOrEqual(12);
      }
    }
  } else {
    record('GC04-week-gap', 'BLOCKED', 'Week card or Continue button not visible');
  }
});

test.afterAll(async () => {
  fs.mkdirSync(EVIDENCE, { recursive: true });
  const summary = {
    generated_at: new Date().toISOString(),
    base_url: BASE,
    sha_hint: 'local-workspace',
    findings,
    pass: findings.filter((f) => f.status === 'PASS').length,
    fail: findings.filter((f) => f.status === 'FAIL').length,
    partial: findings.filter((f) => f.status === 'PARTIAL').length,
    blocked: findings.filter((f) => f.status === 'BLOCKED').length,
  };
  fs.writeFileSync(path.join(EVIDENCE, 'findings.json'), JSON.stringify(summary, null, 2));
});
