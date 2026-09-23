// @ts-nocheck
import { Button } from '@/components/ui/button';
import { ArrowRight } from 'lucide-react';
import { motion, useInView } from 'framer-motion';
import { useRef } from 'react';
import { scrollToDownload } from '@/components/landing/scrollToDownload';

export function LandingFinalCTA() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: '-80px' });

  return (
    <section ref={ref} className="py-24 lg:py-32 relative overflow-hidden">
      <div className="absolute inset-0 bg-gradient-to-br from-primary/8 via-primary/4 to-background" />

      <motion.div
        initial={{ opacity: 0, y: 24 }}
        animate={inView ? { opacity: 1, y: 0 } : {}}
        transition={{ duration: 0.6 }}
        className="container relative mx-auto px-4 lg:px-8 text-center"
      >
        <h2 className="text-3xl md:text-4xl lg:text-5xl font-extrabold text-foreground mb-6 leading-tight">
          The Best Things in Your Society<br className="hidden sm:block" /> Aren't on Any App. Until Now.
        </h2>
        <p className="text-lg md:text-xl text-muted-foreground max-w-xl mx-auto mb-10 leading-relaxed">
          Home-cooked meals, trusted services, hidden talents - discover what your neighbors have been making all along.
        </p>

        <Button
          size="lg"
          className="font-bold px-10 h-14 text-base shadow-cta rounded-2xl"
          onClick={scrollToDownload}
        >
          Join Your Society <ArrowRight size={18} className="ml-2" />
        </Button>

        <p className="mt-6 text-sm text-muted-foreground">
          Get Sociva on the App Store or Google Play to join your society
        </p>
      </motion.div>
    </section>
  );
}
