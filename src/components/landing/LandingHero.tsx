// @ts-nocheck
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { useSystemSettings } from '@/hooks/useSystemSettings';
import { ArrowRight, Shield } from 'lucide-react';
import { motion } from 'framer-motion';

export function LandingHero() {
  const { platformName } = useSystemSettings();

  return (
    <section className="relative overflow-hidden py-24 lg:py-36">
      {/* Background */}
      <div className="absolute inset-0 bg-gradient-to-br from-primary/6 via-background to-accent/4" />
      <div className="absolute top-10 right-10 w-[500px] h-[500px] rounded-full bg-primary/5 blur-[100px]" />
      <div className="absolute bottom-0 left-0 w-80 h-80 rounded-full bg-accent/5 blur-[80px]" />

      <div className="container relative mx-auto px-4 lg:px-8">
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: 'easeOut' }}
          className="max-w-3xl mx-auto text-center"
        >
          {/* Badge */}
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.2, duration: 0.4 }}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-primary/10 border border-primary/20 mb-8"
          >
            <Shield className="text-primary" size={14} />
            <span className="text-xs font-semibold text-primary">Only from verified neighbors</span>
          </motion.div>

          <h1 className="text-4xl md:text-5xl lg:text-6xl font-extrabold leading-[1.1] mb-6 text-foreground tracking-tight">
            What Your Neighbor Makes,{' '}
            <br className="hidden sm:block" />
            <span className="text-primary">No App Can Deliver.</span>
          </h1>

          <p className="text-lg md:text-xl text-muted-foreground max-w-2xl mx-auto mb-10 leading-relaxed">
            Home-cooked meals, trusted tutors, skilled handymen — the best things in your society aren't on any delivery app. {platformName} brings them to your doorstep.
          </p>

          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.35, duration: 0.5 }}
            className="flex flex-col sm:flex-row gap-4 justify-center"
          >
            <Link to="/auth">
              <Button size="lg" className="font-bold px-10 h-14 text-base shadow-cta rounded-2xl">
                Join Your Society <ArrowRight size={18} className="ml-2" />
              </Button>
            </Link>
          </motion.div>

          <p className="mt-6 text-sm text-muted-foreground">
            No credit card required · Takes 30 seconds
          </p>
        </motion.div>
      </div>
    </section>
  );
}
