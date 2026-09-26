const ANDROID_PACKAGE = 'app.sociva.community';
const PLAY_STORE_URL = 'https://play.google.com/store/apps/details?id=app.sociva.community&hl=en_IN';

function withStay(pageUrl: string): string {
  if (/[?&]stay=1(?:&|$)/.test(pageUrl)) return pageUrl;
  return `${pageUrl}${pageUrl.includes('?') ? '&' : '?'}stay=1`;
}

function withoutStay(pageUrl: string): string {
  return pageUrl
    .replace(/([?&])stay=1&/g, '$1')
    .replace(/[?&]stay=1$/, '');
}

/** Android intent that targets the installed Sociva app and returns to this page if it is missing. */
export function androidShareIntentUrl(pageUrl: string): string {
  const target = withoutStay(pageUrl).replace(/^https:\/\//i, '');
  const fallback = encodeURIComponent(withStay(pageUrl));
  return `intent://${target}#Intent;scheme=https;package=${ANDROID_PACKAGE};S.browser_fallback_url=${fallback};end`;
}

/**
 * Share pages keep the same URL for every platform.
 * iOS and desktop still jump into the hash app.
 * Android tries the installed app first, then stays on this preview with store buttons.
 */
export function buildShareOpenScript(pageUrl: string, deepLink: string): string {
  return `(function(){
    var ua = navigator.userAgent || '';
    var android = /Android/i.test(ua);
    var inApp = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
    var deepLink = ${JSON.stringify(deepLink)};
    var play = ${JSON.stringify(PLAY_STORE_URL)};
    var intent = ${JSON.stringify(androidShareIntentUrl(pageUrl))};
    var stay = /[?&]stay=1(?:&|$)/.test(location.search);
    var actions = document.getElementById('sociva-android-actions');
    var openBtn = document.getElementById('sociva-open-app');
    var storeBtn = document.getElementById('sociva-store');
    if (storeBtn) storeBtn.setAttribute('href', play);
    if (openBtn) openBtn.setAttribute('href', intent);
    if (!android || inApp) {
      location.replace(deepLink);
      return;
    }
    if (actions) actions.style.display = 'flex';
    if (!stay) location.href = intent;
  })();`;
}
