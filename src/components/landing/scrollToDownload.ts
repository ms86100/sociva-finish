/** Smooth-scroll to App Store / Play Store section on the landing page. */
export function scrollToDownload() {
  const el = document.getElementById('download');
  if (el) {
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}
