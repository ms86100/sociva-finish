/**
 * Postinstall / post-cap-sync Android hygiene.
 *
 * Sociva does NOT ship Transistorsoft. The package is removed from
 * package.json; this script hard-fails if cap sync ever reintroduces
 * Gradle links (e.g. leftover node_modules or a dependency re-add).
 *
 * Also strips duplicate Kotlin classpaths from Capacitor plugin build.gradle
 * files that break AGP builds.
 */
const fs = require('fs');
const path = require('path');

const root = process.cwd();
const verifyOnly = process.argv.includes('--verify');

function read(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

function write(filePath, content) {
  fs.writeFileSync(filePath, content);
}

function patchFile(filePath, transform) {
  const current = read(filePath);
  const next = transform(current);
  if (verifyOnly) {
    if (next !== current) {
      throw new Error(`Patch not applied for ${path.relative(root, filePath)}`);
    }
    return current;
  }

  if (next !== current) {
    write(filePath, next);
  }

  return next;
}

function assertNoTransistorsoftInNativeGradle() {
  const nativeFiles = [
    path.join(root, 'android', 'capacitor.settings.gradle'),
    path.join(root, 'android', 'app', 'capacitor.build.gradle'),
    path.join(root, 'android', 'build.gradle'),
  ];

  for (const filePath of nativeFiles) {
    if (!fs.existsSync(filePath)) continue;
    const text = read(filePath);
    if (/transistorsoft/i.test(text)) {
      throw new Error(
        `Transistorsoft must not be registered in ${path.relative(root, filePath)}. ` +
          'Remove @transistorsoft/* from package.json and re-run npx cap sync android.',
      );
    }
  }

  const pkg = JSON.parse(read(path.join(root, 'package.json')));
  const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
  for (const name of Object.keys(deps)) {
    if (/transistorsoft/i.test(name)) {
      throw new Error(
        `Transistorsoft package still listed in package.json: ${name}. Remove it completely.`,
      );
    }
  }

  const nmTs = path.join(root, 'node_modules', '@transistorsoft');
  if (fs.existsSync(nmTs)) {
    // Vercel / local caches can leave an orphaned folder after package removal.
    // Delete it so cap sync cannot re-link; do not hard-fail the install.
    fs.rmSync(nmTs, { recursive: true, force: true });
    if (fs.existsSync(nmTs)) {
      throw new Error(
        'Failed to remove orphaned node_modules/@transistorsoft. Delete it manually so native sync cannot re-link it.',
      );
    }
    console.log('Removed orphaned node_modules/@transistorsoft');
  }
}

const geolocationGradlePath = path.join(root, 'node_modules', '@capacitor', 'geolocation', 'android', 'build.gradle');
const calendarGradlePath = path.join(root, 'node_modules', '@ebarooni', 'capacitor-calendar', 'android', 'build.gradle');

for (const filePath of [geolocationGradlePath, calendarGradlePath]) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Required Android plugin file not found: ${path.relative(root, filePath)}`);
  }
}

for (const filePath of [geolocationGradlePath, calendarGradlePath]) {
  patchFile(filePath, (text) =>
    text.replace('        classpath "org.jetbrains.kotlin:kotlin-gradle-plugin:$kotlin_version"\n', ''),
  );
}

for (const filePath of [geolocationGradlePath, calendarGradlePath]) {
  const text = read(filePath);
  if (text.includes('classpath "org.jetbrains.kotlin:kotlin-gradle-plugin:$kotlin_version"')) {
    throw new Error(`Duplicate Kotlin plugin classpath still present in ${path.relative(root, filePath)}`);
  }
}

assertNoTransistorsoftInNativeGradle();

// Keep symbol names referenced by tests / docs as a permanent safety-net API.
function stripTransistorsoftFromNativeGradle(text) {
  return text
    .replace(/^[ \t]*include ':transistorsoft-capacitor-background-geolocation'\r?\n/gm, '')
    .replace(/^[ \t]*project\(':transistorsoft-capacitor-background-geolocation'\)[^\n]*\r?\n/gm, '')
    .replace(/^[ \t]*implementation project\(':transistorsoft-capacitor-background-geolocation'\)\r?\n/gm, '')
    .replace(/^[ \t]*maven \{ url = uri\("\$\{project\(':transistorsoft-capacitor-background-geolocation'\)\.projectDir\}\/libs"\) \}\r?\n/gm, '')
    .replace(/^[ \t]*maven \{ url = uri\('https:\/\/maven\.transistorsoft\.com'\) \}\r?\n/gm, '')
    .replace(/\n{3,}/g, '\n\n');
}

function stripNativeTransistorsoft() {
  assertNoTransistorsoftInNativeGradle();
}

module.exports = {
  stripTransistorsoftFromNativeGradle,
  stripNativeTransistorsoft,
  assertNoTransistorsoftInNativeGradle,
};

console.log(verifyOnly ? 'ANDROID_PLUGIN_PATCH_VERIFY_OK' : 'ANDROID_PLUGIN_PATCH_OK');
