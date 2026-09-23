'use strict';
const fs = require('fs');
const { execSync } = require('child_process');
const yaml = require('js-yaml');

const clean = execSync('git show 473e596:codemagic.yaml', {
  encoding: 'utf8',
  maxBuffer: 20 * 1024 * 1024,
});

const markerAndroid = '\n  android-release:';
const androidAt = clean.indexOf(markerAndroid);
if (androidAt < 0) throw new Error('android-release not found');

const beforeAndroid = clean.slice(0, androidAt); // ends at end of ios-release workflow
const fromAndroid = clean.slice(androidAt); // starts with \n  android-release:

function patchProduction(src) {
  let b = src;
  if (!b.includes('VITE_APP_ENV:')) {
    b = b.replace(
      '        CAPACITOR_ENV: "production"\n',
      '        CAPACITOR_ENV: "production"\n        VITE_APP_ENV: "production"\n',
    );
  }
  if (!b.includes('assert-supabase-env.cjs --require-production')) {
    b = b.replace(
      '      - name: Build web app\n        script: npm run build\n',
      [
        '      - name: Build web app',
        '        script: |',
        '          # Fail closed: production IPA must never embed staging Supabase.',
        '          node scripts/assert-supabase-env.cjs --require-production',
        '          npm run build',
        '',
      ].join('\n'),
    );
  }
  return b;
}

function makeStagingFromProdFile(prodFile) {
  // Extract only the ios-release workflow body from patched production file
  const iosStart = prodFile.indexOf('  ios-release:');
  const androidStart = prodFile.indexOf('\n  android-release:');
  if (iosStart < 0 || androidStart < 0) throw new Error('cannot slice ios for staging');
  let b = prodFile.slice(iosStart, androidStart);

  b = b.replace('ios-release:', 'ios-testflight-staging:');
  b = b.replace('name: iOS Release', 'name: iOS TestFlight (Staging Supabase)');
  b = b.replace('APP_NAME: "Sociva"', 'APP_NAME: "Sociva Staging"');
  b = b.replace('CAPACITOR_ENV: "production"', 'CAPACITOR_ENV: "staging"');
  b = b.replace('VITE_APP_ENV: "production"', 'VITE_APP_ENV: "staging"');
  b = b.replace(
    'https://kkzkuyhgdvyecmxtmkpy.supabase.co',
    'https://wwuanzbusxoyzixuprxs.supabase.co',
  );
  b = b.replace(
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imtremt1eWhnZHZ5ZWNteHRta3B5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM4MzIyMTEsImV4cCI6MjA4OTQwODIxMX0.-dmjGjRYs7u8TkR14oPwOXWipNXgSxZRjuwc6q98VkA',
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Ind3dWFuemJ1c3hveXppeHVwcnhzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODkzMTY2OTAsImV4cCI6MjEwNDg5MjY5MH0.TVZ3pwFUGpnnp4C4xhLgYZXljvAsM5V0GJziuz4hFqc',
  );
  b = b.replace(
    'node scripts/assert-supabase-env.cjs --require-production',
    'node scripts/assert-supabase-env.cjs --require-staging',
  );
  b = b.replace(
    '# Fail closed: production IPA must never embed staging Supabase.',
    '# Fail closed: staging TestFlight must NEVER embed production Supabase.',
  );

  const sync = '          npx cap sync ios\n';
  if (!b.includes(sync)) throw new Error('cap sync missing');
  b = b.replace(
    sync,
    sync +
      '          # Visible on home screen so testers never confuse with production\n' +
      '          /usr/libexec/PlistBuddy -c "Set :CFBundleDisplayName Sociva Staging" ios/App/App/Info.plist 2>/dev/null || \\\n' +
      '            /usr/libexec/PlistBuddy -c "Add :CFBundleDisplayName string Sociva Staging" ios/App/App/Info.plist\n' +
      '          echo "=== CFBundleDisplayName set to Sociva Staging ==="\n',
  );

  return (
    '\n# ---------------------------------------------------------------------------\n' +
    '# STAGING ONLY -- TestFlight builds for isolation testing.\n' +
    '# NEVER use this workflow for App Store production releases.\n' +
    '# Production users: ios-release -> kkzkuyhgdvyecmxtmkpy (untouched).\n' +
    '# ---------------------------------------------------------------------------\n' +
    b
  );
}

const patchedProdFull = patchProduction(clean);
// Rebuild: take patched file's content before android, insert staging, then android+
const patchedAndroidAt = patchedProdFull.indexOf(markerAndroid);
if (patchedAndroidAt < 0) throw new Error('android marker missing after patch');

const staging = makeStagingFromProdFile(patchedProdFull);
const out =
  patchedProdFull.slice(0, patchedAndroidAt) + staging + patchedProdFull.slice(patchedAndroidAt);

const parsed = yaml.load(out);
const keys = Object.keys(parsed.workflows);
console.log('workflows', keys);
if (!keys.includes('ios-testflight-staging')) throw new Error('staging workflow missing');
const s = parsed.workflows['ios-testflight-staging'].environment.vars;
const p = parsed.workflows['ios-release'].environment.vars;
console.log('staging', s.VITE_APP_ENV, s.VITE_SUPABASE_URL);
console.log('prod', p.VITE_APP_ENV, p.VITE_SUPABASE_URL);
if (s.VITE_SUPABASE_URL.includes('kkzkuyhgdvyecmxtmkpy')) throw new Error('bad staging url');
if (!p.VITE_SUPABASE_URL.includes('kkzkuyhgdvyecmxtmkpy')) throw new Error('bad prod url');

fs.writeFileSync('codemagic.yaml', out, 'utf8');
console.log('Wrote codemagic.yaml bytes', out.length);
