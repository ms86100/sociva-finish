/**
 * Keep the Capacitor-generated iOS Podfile plugin list and inject the extras
 * Codemagic needs (static linkage, Firebase, Xcode 16 post_install).
 *
 * Historically ios-release overwrote Podfile with a hardcoded plugin list that
 * omitted TransistorsoftCapacitorBackgroundGeolocation. The App Store binary
 * then had no BackgroundGeolocation native class, so sellers saw:
 *   "BackgroundGeolocation" Plugin is not implemented on iOS
 */
const fs = require('fs');
const path = require('path');

function findRepoRoot(startDir) {
  let dir = path.resolve(startDir);
  for (let i = 0; i < 10; i++) {
    const pkg = path.join(dir, 'package.json');
    const script = path.join(dir, 'scripts', 'patch-ios-podfile.cjs');
    if (fs.existsSync(pkg) && fs.existsSync(script)) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

/**
 * Always resolve from this file's location so `cd ios/App && node ../../scripts/...`
 * cannot nest ios/App/ios/App/Podfile.
 */
function resolvePaths(cwd = process.cwd(), scriptDir = __dirname, argv = process.argv) {
  const repoRoot =
    findRepoRoot(scriptDir) ||
    findRepoRoot(cwd) ||
    cwd;
  const fromArg = argv.find((a) => a.startsWith('--podfile='));
  if (fromArg) {
    return {
      repoRoot,
      podfilePath: path.resolve(cwd, fromArg.slice('--podfile='.length)),
    };
  }
  return {
    repoRoot,
    podfilePath: path.join(repoRoot, 'ios', 'App', 'Podfile'),
  };
}

const REQUIRED_PLUGIN_PODS = [
  [
    'TransistorsoftCapacitorBackgroundGeolocation',
    '../../node_modules/@transistorsoft/capacitor-background-geolocation',
  ],
];

const SKELETON_PLUGIN_PODS = [
  ['Capacitor', '../../node_modules/@capacitor/ios'],
  ['CapacitorCordova', '../../node_modules/@capacitor/ios'],
  ['CapacitorCommunityFcm', '../../node_modules/@capacitor-community/fcm'],
  ['CapacitorApp', '../../node_modules/@capacitor/app'],
  ['CapacitorBrowser', '../../node_modules/@capacitor/browser'],
  ['CapacitorCamera', '../../node_modules/@capacitor/camera'],
  ['CapacitorGeolocation', '../../node_modules/@capacitor/geolocation'],
  ['CapacitorHaptics', '../../node_modules/@capacitor/haptics'],
  ['CapacitorKeyboard', '../../node_modules/@capacitor/keyboard'],
  ['CapacitorLocalNotifications', '../../node_modules/@capacitor/local-notifications'],
  ['CapacitorPreferences', '../../node_modules/@capacitor/preferences'],
  ['CapacitorPushNotifications', '../../node_modules/@capacitor/push-notifications'],
  ['CapacitorSplashScreen', '../../node_modules/@capacitor/splash-screen'],
  ['CapacitorStatusBar', '../../node_modules/@capacitor/status-bar'],
  ...REQUIRED_PLUGIN_PODS,
];

const POST_INSTALL = `post_install do |installer|
  assertDeploymentTarget(installer)
  installer.pods_project.targets.each do |target|
    target.build_configurations.each do |config|
      config.build_settings['IPHONEOS_DEPLOYMENT_TARGET'] = '16.1'
      config.build_settings['SWIFT_ENABLE_EXPLICIT_MODULES'] = 'NO'
      config.build_settings['SKIP_INSTALL'] = 'YES'
    end
    dupes = target.build_phases.select { |p|
      p.respond_to?(:name) && p.name&.include?("AppIntents")
    }
    dupes.drop(1).each { |p| p.remove_from_project }
  end
end
`;

function skeletonPodfile() {
  const pods = SKELETON_PLUGIN_PODS.map(
    ([name, rel]) => `    pod '${name}', :path => '${rel}'`,
  ).join('\n');
  return `require_relative '../../node_modules/@capacitor/ios/scripts/pods_helpers'

platform :ios, '16.1'
use_frameworks! :linkage => :static

install! 'cocoapods', :disable_input_output_paths => true

def capacitor_pods
${pods}
end

target 'App' do
  capacitor_pods
  pod 'FirebaseCore'
  pod 'FirebaseMessaging'
  pod 'FirebaseCrashlytics'
end

${POST_INSTALL}`;
}

function hasPod(content, name) {
  return new RegExp(`pod ['"]${name}['"](?=[,\\s])`).test(content);
}

function ensureLineInCapacitorPods(content, name, rel) {
  if (hasPod(content, name)) return content;
  const podLine = `    pod '${name}', :path => '${rel}'`;
  return content.replace(
    /def capacitor_pods\n([\s\S]*?)\nend/,
    (block) => {
      if (hasPod(block, name)) return block;
      return block.replace(/\nend\s*$/, `\n${podLine}\nend`);
    },
  );
}

function ensureFirebase(content) {
  if (content.includes("pod 'FirebaseCore'")) return content;
  return content.replace(
    /target 'App' do\n([\s\S]*?)capacitor_pods/,
    (m) => {
      if (m.includes("pod 'FirebaseCore'")) return m;
      return m.replace(
        'capacitor_pods',
        `capacitor_pods
    pod 'FirebaseCore'
    pod 'FirebaseMessaging'
    pod 'FirebaseCrashlytics'`,
      );
    },
  );
}

function rewritePlatformAndLinkage(content) {
  let next = content.replace(/platform :ios, ['"][\d.]+['"]/, "platform :ios, '16.1'");
  if (!/platform :ios,/.test(next)) {
    next = next.replace(
      /require_relative[^\n]+\n/,
      (line) => `${line}\nplatform :ios, '16.1'\n`,
    );
  }
  if (/use_frameworks!/.test(next)) {
    next = next.replace(/use_frameworks!(?:[^\n]*)/, 'use_frameworks! :linkage => :static');
  } else {
    next = next.replace(/platform :ios, '16.1'\n/, "platform :ios, '16.1'\nuse_frameworks! :linkage => :static\n");
  }
  return next;
}

function rewritePostInstall(content) {
  if (/post_install do \|installer\|/.test(content)) {
    return content.replace(/post_install do \|installer\|[\s\S]*?\nend\s*$/, POST_INSTALL.trimEnd() + '\n');
  }
  return `${content.trimEnd()}\n\n${POST_INSTALL}`;
}

function patch(content) {
  let next = rewritePlatformAndLinkage(content);
  for (const [name, rel] of REQUIRED_PLUGIN_PODS) {
    next = ensureLineInCapacitorPods(next, name, rel);
  }
  next = ensureFirebase(next);
  next = rewritePostInstall(next);
  return next;
}

function main() {
  const { repoRoot, podfilePath } = resolvePaths();
  const expectedPodfile = path.join(repoRoot, 'ios', 'App', 'Podfile');
  if (path.normalize(podfilePath) !== path.normalize(expectedPodfile) && !process.argv.some((a) => a.startsWith('--podfile='))) {
    throw new Error(`patch-ios-podfile: refusing unexpected Podfile path ${podfilePath}`);
  }

  const existing = fs.existsSync(podfilePath) ? fs.readFileSync(podfilePath, 'utf8') : '';
  const source = existing.trim() ? existing : skeletonPodfile();
  const patched = patch(source);

  if (!patched.includes('TransistorsoftCapacitorBackgroundGeolocation')) {
    throw new Error('patch-ios-podfile: Transistorsoft pod missing after patch');
  }

  const tsPath = path.join(
    repoRoot,
    'node_modules',
    '@transistorsoft',
    'capacitor-background-geolocation',
  );
  if (!fs.existsSync(tsPath)) {
    throw new Error(`patch-ios-podfile: Transistorsoft missing at ${tsPath}`);
  }

  const podDir = path.dirname(podfilePath);
  if (!fs.existsSync(podDir)) {
    throw new Error(`patch-ios-podfile: iOS app directory missing: ${podDir}`);
  }
  fs.writeFileSync(podfilePath, patched.endsWith('\n') ? patched : `${patched}\n`, 'utf8');
  console.log(`Patched ${podfilePath}`);
}

module.exports = {
  patch,
  skeletonPodfile,
  REQUIRED_PLUGIN_PODS,
  SKELETON_PLUGIN_PODS,
  resolvePaths,
  findRepoRoot,
};

if (require.main === module) {
  main();
}
