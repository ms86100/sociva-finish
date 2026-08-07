import type { CapacitorConfig } from '@capacitor/cli';

/**
 * Capacitor Configuration for Sociva App
 * 
 * SAFE DEFAULT: Production mode (bundled assets) unless explicitly opted into dev.
 * 
 * DEVELOPMENT (set CAPACITOR_ENV=development before `npx cap sync`):
 *   - Live reload from sandbox URL
 *   - Mixed content allowed for local testing
 * 
 * PRODUCTION (default — no env var needed):
 *   - Loads from bundled local assets (no server block)
 *   - WebView debugging disabled
 *   - Splash auto-hides as safety net
 */

const isDev = process.env.CAPACITOR_ENV === 'development';

const config: CapacitorConfig = {
  appId: 'app.sociva.community',
  appName: 'Sociva',
  webDir: 'dist',

  // Dev server only when explicitly in development
  ...(isDev && {
    server: {
      url: 'https://b3f6efce-9b8e-4071-b39d-b038b9b1adf4.lovableproject.com?forceHideBadge=true',
      cleartext: true,
      hostname: 'www.sociva.in',
      androidScheme: 'https',
    },
  }),

  // Production: minimal server config with allowNavigation for Supabase/app domains
  ...(!isDev && {
    server: {
      hostname: 'www.sociva.in',
      androidScheme: 'https',
      allowNavigation: [
        'kkzkuyhgdvyecmxtmkpy.supabase.co',
        'www.sociva.in',
        'sociva.in',
        '*.razorpay.com',
        '*.razorpay.in',
      ],
    },
  }),

  plugins: {
    SplashScreen: {
      launchShowDuration: 2500,
      // Always auto-hide — slow emulators / large bundles can delay JS boot;
      // without this, launchAutoHide:false leaves the native splash forever.
      launchAutoHide: true,
      backgroundColor: '#1a1a2e',
      androidSplashResourceName: 'splash',
      iosSplashResourceName: 'LaunchScreen',
      showSpinner: false,
    },
    StatusBar: {
      // LIGHT = light icons for dark chrome (app default theme is dark).
      // Overlay + CSS --app-safe-top padding.
      style: 'LIGHT',
      overlaysWebView: true,
    },
    PushNotifications: {
      presentationOptions: ['badge', 'sound', 'alert'],
    },
    LocalNotifications: {
      smallIcon: 'ic_stat_sociva',
      sound: 'order_ring.mp3',
    },
    Keyboard: {
      resize: 'body',
      resizeOnFullScreen: true,
    },
  },

  // iOS-specific configuration
  ios: {
    scheme: 'sociva',
    contentInset: 'never',
    // Force CocoaPods so Firebase pod injection scripts work
    packageManager: 'cocoapods' as any,
    preferredContentMode: 'mobile',
    plistOverrides: {
      ITSAppUsesNonExemptEncryption: false,
      NSLocationWhenInUseUsageDescription: 'Sociva uses your location to verify your residential society membership and show nearby sellers.',
      NSCameraUsageDescription: 'Sociva needs camera access to let you photograph products for listing and upload profile pictures.',
      NSPhotoLibraryUsageDescription: 'Sociva needs photo library access to let you select images for product listings and your profile.',
      NSPhotoLibraryAddUsageDescription: 'Sociva needs permission to save images to your photo library.',
      NSLocationAlwaysAndWhenInUseUsageDescription: 'Sociva uses your location in the background to provide real-time delivery tracking when you are making deliveries as a seller.',
      // Calendar — required for @ebarooni/capacitor-calendar (iOS 13–16 + write-only / full on iOS 17+)
      NSCalendarsUsageDescription: 'Sociva needs calendar access so you can save service bookings to your calendar.',
      NSCalendarsWriteOnlyAccessUsageDescription: 'Sociva needs calendar access so you can save service bookings to your calendar.',
      NSCalendarsFullAccessUsageDescription: 'Sociva needs calendar access so you can save service bookings to your calendar.',
    },
  },

  // Android-specific configuration
  android: {
    allowMixedContent: isDev,
    captureInput: true,
    // Keep true through Play internal testing so WebView console is visible in chrome://inspect
    webContentsDebuggingEnabled: true,
    // Allow UPI intent:// and upi:// deep links from Razorpay
    allowIntentUrls: true,
  },
};

export default config;
