const fs = require('fs');
const path = require('path');
const root = path.join(process.cwd(), 'src');

// Candidates flagged as orphans — verify zero basename import references
const candidates = [
  'components/NavLink.tsx',
  'components/activity/ActivityFeed.tsx',
  'components/admin/ApiKeySettings.tsx',
  'components/admin/LicenseManager.tsx',
  'components/booking/BookingSheet.tsx',
  'components/category/CategoryBrowseGrid.tsx',
  'components/category/CategoryGrid.tsx',
  'components/category/CategoryGroupGrid.tsx',
  'components/collective/CreateGroupBuySheet.tsx',
  'components/dashboard/SocietyHealthDashboard.tsx',
  'components/home/ReorderLastOrder.tsx',
  'components/home/TrendingInSociety.tsx',
  'components/listing/ListingCard.tsx',
  'components/product/ProductCarousel.tsx',
  'components/product/ProductGridCard.tsx',
  'components/seller/SellerDayAgenda.tsx',
  'components/seller/SellerReputationTab.tsx',
  'components/subscription/SubscriptionSheet.tsx',
  'components/trust/SellerRecommendButton.tsx',
  'hooks/queries/useTrendingProducts.ts',
  'hooks/queries/useSellersByCategory.ts',
  'hooks/useWorkflowMap.ts',
  'hooks/useFirstOrderCheck.ts',
  'hooks/useAppRating.ts',
  'hooks/useLoginThrottle.ts',
  'lib/notifications.ts',
  'lib/format-price.ts',
  'services/notificationService.ts',
  'pages/AdminServiceBookingsPage.tsx',
  'types/service.ts',
];

function walk(dir, acc = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === 'node_modules') continue;
      walk(p, acc);
    } else if (/\.(ts|tsx|md)$/.test(e.name)) acc.push(p);
  }
  return acc;
}

const files = walk(root);
const texts = files.map((f) => ({
  f,
  t: fs.readFileSync(f, 'utf8'),
  rel: path.relative(root, f).split(path.sep).join('/'),
}));

for (const c of candidates) {
  const base = path.basename(c).replace(/\.(tsx?)$/, '');
  const refs = [];
  for (const { rel, t } of texts) {
    if (rel === c) continue;
    // import path or JSX tag or identifier usage
    const patterns = [
      new RegExp(`from\\s+['\"][^'\"]*${base}['\"]`),
      new RegExp(`import\\(['\"][^'\"]*${base}['\"]`),
      new RegExp(`<${base}\\b`),
    ];
    if (patterns.some((p) => p.test(t))) refs.push(rel);
  }
  console.log((refs.length ? 'USED' : 'ORPHAN') + '\t' + c + (refs.length ? '\t-> ' + refs.slice(0, 5).join(', ') : ''));
}
