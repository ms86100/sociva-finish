// @ts-nocheck
import { useRef } from 'react';
import { Button } from '@/components/ui/button';
import { motion, useInView } from 'framer-motion';
import { Apple, Smartphone, Monitor, Laptop } from 'lucide-react';

const IOS_APP_STORE_URL = 'https://apps.apple.com/in/app/sociva/id6759218504';
/** Vercel serving URL — serves the APK from the public directory. */
export const ANDROID_APK_URL = '/downloads/sociva-android.apk';
/** Stable Windows installer alias (Vercel public/downloads). */
export const WINDOWS_SETUP_URL = '/downloads/sociva-windows-setup.exe';
/**
 * macOS DMG via GitHub Releases (built by Actions on macos-latest).
 * Prefer a promoted `desktop-v*` release; falls back to latest matching asset name.
 */
export const MACOS_DMG_URL =
  'https://github.com/ms86100/sociva-finish/releases/latest/download/Sociva-mac.dmg';
/** Set true after the first successful macOS Actions release exists. */
const MACOS_DMG_AVAILABLE = true;

export function LandingDownload() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: '-80px' });

  return (
    <section id="download" ref={ref} className="py-20 lg:py-28 relative overflow-hidden">
      <div className="absolute inset-0 bg-gradient-to-b from-background via-primary/[0.04] to-background" />
      <div className="absolute -top-24 right-0 w-72 h-72 rounded-full bg-primary/10 blur-[90px]" />
      <div className="absolute bottom-0 left-0 w-64 h-64 rounded-full bg-accent/10 blur-[80px]" />

      <motion.div
        initial={{ opacity: 0, y: 24 }}
        animate={inView ? { opacity: 1, y: 0 } : {}}
        transition={{ duration: 0.55 }}
        className="container relative mx-auto px-4 lg:px-8"
      >
        <div className="max-w-2xl mx-auto text-center mb-12">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary mb-3">
            Get the app
          </p>
          <h2 className="text-3xl md:text-4xl font-extrabold text-foreground mb-4 tracking-tight">
            Download Sociva
          </h2>
          <p className="text-muted-foreground text-base md:text-lg leading-relaxed">
            Same account, same orders, same cloud store — on your phone or your PC.
          </p>
        </div>

        <div className="grid sm:grid-cols-2 gap-4 max-w-3xl mx-auto">
          <motion.a
            href={IOS_APP_STORE_URL}
            target="_blank"
            rel="noopener noreferrer"
            initial={{ opacity: 0, y: 16 }}
            animate={inView ? { opacity: 1, y: 0 } : {}}
            transition={{ delay: 0.1, duration: 0.45 }}
            className="group flex flex-col items-start gap-4 rounded-2xl border border-border bg-card/80 backdrop-blur-sm p-6 hover:border-primary/40 hover:bg-card transition-colors text-left"
          >
            <div className="w-12 h-12 rounded-xl bg-foreground text-background flex items-center justify-center">
              <Apple size={24} />
            </div>
            <div className="space-y-1 flex-1">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">iPhone &amp; iPad</p>
              <h3 className="text-lg font-bold text-foreground">App Store</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">
                Install Sociva from the Apple App Store.
              </p>
            </div>
            <Button className="w-full rounded-xl font-semibold group-hover:shadow-cta" size="lg">
              Download on the App Store
            </Button>
          </motion.a>

          <motion.a
            href={ANDROID_APK_URL}
            download="sociva-android.apk"
            initial={{ opacity: 0, y: 16 }}
            animate={inView ? { opacity: 1, y: 0 } : {}}
            transition={{ delay: 0.18, duration: 0.45 }}
            className="group flex flex-col items-start gap-4 rounded-2xl border border-border bg-card/80 backdrop-blur-sm p-6 hover:border-primary/40 hover:bg-card transition-colors text-left"
          >
            <div className="w-12 h-12 rounded-xl bg-primary text-primary-foreground flex items-center justify-center">
              <Smartphone size={24} />
            </div>
            <div className="space-y-1 flex-1">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Android</p>
              <h3 className="text-lg font-bold text-foreground">Download APK</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">
                Direct install for Android devices. Enable “Install unknown apps” if prompted.
              </p>
            </div>
            <Button variant="outline" className="w-full rounded-xl font-semibold border-primary/30" size="lg">
              Download Android APK
            </Button>
          </motion.a>
        </div>

        {/* Desktop */}
        <div className="max-w-3xl mx-auto mt-14 mb-6 text-center">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary mb-2">
            Desktop
          </p>
          <h3 className="text-xl md:text-2xl font-extrabold text-foreground mb-2 tracking-tight">
            Sociva for Windows &amp; Mac
          </h3>
          <p className="text-sm text-muted-foreground leading-relaxed max-w-xl mx-auto">
            Run Sociva as a native desktop app for sellers and buyers. Connects to the same live cloud — no separate database to install.
          </p>
        </div>

        <div className="grid sm:grid-cols-2 gap-4 max-w-3xl mx-auto">
          <motion.a
            href={WINDOWS_SETUP_URL}
            download="Sociva-Setup.exe"
            initial={{ opacity: 0, y: 16 }}
            animate={inView ? { opacity: 1, y: 0 } : {}}
            transition={{ delay: 0.22, duration: 0.45 }}
            className="group flex flex-col items-start gap-4 rounded-2xl border border-border bg-card/80 backdrop-blur-sm p-6 hover:border-primary/40 hover:bg-card transition-colors text-left overflow-hidden relative"
          >
            <div
              className="pointer-events-none absolute inset-0 opacity-[0.07]"
              style={{
                backgroundImage:
                  'linear-gradient(135deg, hsl(var(--primary)) 0%, transparent 55%), radial-gradient(circle at 90% 10%, hsl(var(--accent)) 0%, transparent 40%)',
              }}
              aria-hidden
            />
            <img
              src="/landing/desktop-windows.svg"
              alt=""
              className="absolute right-3 bottom-3 w-28 h-auto opacity-90 pointer-events-none select-none"
              width={160}
              height={100}
            />
            <div className="relative w-12 h-12 rounded-xl bg-[#0078D4] text-white flex items-center justify-center shadow-sm">
              <Monitor size={24} />
            </div>
            <div className="relative space-y-1 flex-1 pr-24">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Windows PC</p>
              <h3 className="text-lg font-bold text-foreground">Windows Installer</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">
                Install Sociva on your PC — Start Menu &amp; desktop shortcut. Same login, same orders, same cloud store.
              </p>
            </div>
            <Button className="relative w-full rounded-xl font-semibold group-hover:shadow-cta" size="lg">
              Download for Windows
            </Button>
          </motion.a>

          {MACOS_DMG_AVAILABLE ? (
            <motion.a
              href={MACOS_DMG_URL}
              download="Sociva.dmg"
              initial={{ opacity: 0, y: 16 }}
              animate={inView ? { opacity: 1, y: 0 } : {}}
              transition={{ delay: 0.28, duration: 0.45 }}
              className="group flex flex-col items-start gap-4 rounded-2xl border border-border bg-card/80 backdrop-blur-sm p-6 hover:border-primary/40 hover:bg-card transition-colors text-left overflow-hidden relative"
            >
              <div
                className="pointer-events-none absolute inset-0 opacity-[0.07]"
                style={{
                  backgroundImage:
                    'linear-gradient(135deg, hsl(var(--foreground)) 0%, transparent 55%), radial-gradient(circle at 90% 10%, hsl(var(--primary)) 0%, transparent 40%)',
                }}
                aria-hidden
              />
              <img
                src="/landing/desktop-macos.svg"
                alt=""
                className="absolute right-3 bottom-3 w-28 h-auto opacity-90 pointer-events-none select-none"
                width={160}
                height={100}
              />
              <div className="relative w-12 h-12 rounded-xl bg-foreground text-background flex items-center justify-center shadow-sm">
                <Laptop size={24} />
              </div>
              <div className="relative space-y-1 flex-1 pr-24">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">MacBook &amp; Mac</p>
                <h3 className="text-lg font-bold text-foreground">macOS Download</h3>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  Native Mac app for your MacBook — same Sociva account and live cloud backend. First open: right-click → Open (unsigned BAT build).
                </p>
              </div>
              <Button variant="outline" className="relative w-full rounded-xl font-semibold border-primary/30" size="lg">
                Download for Mac
              </Button>
            </motion.a>
          ) : (
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={inView ? { opacity: 1, y: 0 } : {}}
              transition={{ delay: 0.28, duration: 0.45 }}
              className="flex flex-col items-start gap-4 rounded-2xl border border-dashed border-border bg-muted/30 p-6 text-left overflow-hidden relative"
            >
              <img
                src="/landing/desktop-macos.svg"
                alt=""
                className="absolute right-3 bottom-3 w-28 h-auto opacity-40 pointer-events-none select-none grayscale"
                width={160}
                height={100}
              />
              <div className="relative w-12 h-12 rounded-xl bg-foreground/80 text-background flex items-center justify-center">
                <Laptop size={24} />
              </div>
              <div className="relative space-y-1 flex-1 pr-24">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">MacBook &amp; Mac</p>
                <h3 className="text-lg font-bold text-foreground">macOS Download</h3>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  Native Mac installer is in final packaging. Use the web app or iPhone App Store until the DMG is published.
                </p>
              </div>
              <Button variant="outline" className="relative w-full rounded-xl font-semibold" size="lg" disabled>
                Coming soon
              </Button>
            </motion.div>
          )}
        </div>

        <p className="text-center text-xs text-muted-foreground mt-8 max-w-lg mx-auto">
          Mobile APK is for sideload testing and early access. Desktop apps connect to the same Sociva cloud — internet required.
        </p>
      </motion.div>
    </section>
  );
}
