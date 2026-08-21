// @ts-nocheck
import { useRef } from 'react';
import { Button } from '@/components/ui/button';
import { motion, useInView } from 'framer-motion';
import { Apple, Smartphone } from 'lucide-react';

const IOS_APP_STORE_URL = 'https://apps.apple.com/in/app/sociva/id6759218504';
/** Vercel serving URL — serves the APK from the public directory. */
export const ANDROID_APK_URL = '/downloads/sociva-android.apk';

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
            Download Sociva for your phone
          </h2>
          <p className="text-muted-foreground text-base md:text-lg leading-relaxed">
            Order from neighbors, sell from your society, and stay in the loop — on iPhone or Android.
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

        <p className="text-center text-xs text-muted-foreground mt-8 max-w-lg mx-auto">
          Android APK is for sideload testing and early access. Prefer Play Store when available for automatic updates.
        </p>
      </motion.div>
    </section>
  );
}
