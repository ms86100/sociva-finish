// @ts-nocheck
import { useState, useEffect, useCallback, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import useEmblaCarousel from 'embla-carousel-react';
import { supabase } from '@/integrations/supabase/client';
import { useParentGroups } from '@/hooks/useParentGroups';
import { useSystemSettings } from '@/hooks/useSystemSettings';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Utensils, ShoppingBag, Wrench, GraduationCap, Package,
  Star, Shield, MapPin, Users, ChevronRight, Sparkles,
  TrendingUp, BadgeCheck, Lock, Ticket, Heart, Clock,
  ArrowRight, CheckCircle2,
  type LucideIcon,
} from 'lucide-react';

const AUTOPLAY_INTERVAL = 7000;

function useAutoplay(emblaApi: any, interval: number) {
  useEffect(() => {
    if (!emblaApi) return;
    let id: ReturnType<typeof setInterval>;
    const start = () => { id = setInterval(() => emblaApi.scrollNext(), interval); };
    const stop = () => clearInterval(id);
    start();
    emblaApi.on('pointerDown', stop);
    emblaApi.on('pointerUp', () => { stop(); start(); });
    return () => { stop(); emblaApi.off('pointerDown', stop); };
  }, [emblaApi, interval]);
}

const ICON_MAP: Record<string, LucideIcon> = {
  Utensils, ShoppingBag, Wrench, GraduationCap, Package, Ticket, Users, Star, Shield,
};

const GROUP_COLORS = [
  'bg-primary/10 text-primary',
  'bg-accent/20 text-accent-foreground',
  'bg-secondary/30 text-secondary-foreground',
  'bg-muted text-muted-foreground',
  'bg-primary/15 text-primary',
  'bg-warning/10 text-warning',
];

export default function WelcomeCarousel() {
  const [emblaRef, emblaApi] = useEmblaCarousel({ loop: true });
  const [activeSlide, setActiveSlide] = useState(0);
  const [stats, setStats] = useState({ societies: 0, sellers: 0, orders: 0 });
  const { parentGroupInfos } = useParentGroups();
  const settings = useSystemSettings();
  const { platformName } = settings;

  const displayGroups = useMemo(() => {
    const active = parentGroupInfos.filter(g => g.label);
    return active.slice(0, 6).map((g, i) => ({
      icon: ICON_MAP[g.icon] || Package,
      title: g.label,
      desc: g.description || '',
      color: GROUP_COLORS[i % GROUP_COLORS.length],
    }));
  }, [parentGroupInfos]);

  useAutoplay(emblaApi, AUTOPLAY_INTERVAL);

  useEffect(() => {
    if (!emblaApi) return;
    const onSelect = () => setActiveSlide(emblaApi.selectedScrollSnap());
    emblaApi.on('select', onSelect);
    return () => { emblaApi.off('select', onSelect); };
  }, [emblaApi]);

  useEffect(() => {
    async function fetchStats() {
      const [{ count: sCount }, { count: selCount }, { count: ordCount }] = await Promise.all([
        supabase.from('societies').select('*', { count: 'exact', head: true }).eq('is_active', true),
        supabase.from('seller_profiles').select('*', { count: 'exact', head: true }).eq('verification_status', 'approved'),
        supabase.from('orders').select('*', { count: 'exact', head: true }),
      ]);
      setStats({ societies: sCount || 0, sellers: selCount || 0, orders: ordCount || 0 });
    }
    fetchStats();
  }, []);

  const TOTAL_SLIDES = 5;

  const slides = [
    // ── Slide 1: Hero ──
    <div key="hero" className="min-h-[100dvh] flex flex-col justify-center items-center text-center px-6 relative overflow-hidden">
      <div className="absolute inset-0 bg-gradient-to-b from-primary/8 via-background to-primary/4" />
      <div className="absolute top-20 -right-20 w-72 h-72 rounded-full bg-primary/6 blur-[80px]" />
      <div className="absolute bottom-20 -left-20 w-60 h-60 rounded-full bg-accent/8 blur-[60px]" />

      <div className="relative z-10 max-w-sm mx-auto">
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.15, duration: 0.4 }}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-primary/12 border border-primary/20 mb-6"
        >
          <Shield className="text-primary" size={14} />
          <span className="text-xs font-semibold text-primary tracking-wide">Only From Verified Neighbors</span>
        </motion.div>

        <motion.h1
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.25, duration: 0.5 }}
          className="text-[2.5rem] leading-[1.1] font-extrabold mb-5 text-foreground tracking-tight"
        >
          What Your Neighbor Makes,{' '}
          <span className="text-primary">No App Can Deliver</span>
        </motion.h1>

        <motion.p
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.35, duration: 0.4 }}
          className="text-muted-foreground text-base leading-relaxed mb-8 px-2"
        >
          Home-cooked meals, trusted tutors, skilled handymen — the best things in your society aren't on any delivery app. Until now.
        </motion.p>

        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.45, duration: 0.4 }}
          className="space-y-3"
        >
          <Link to="/auth" className="block">
            <Button size="lg" className="w-full h-14 text-base font-bold shadow-cta rounded-2xl">
              Join Your Society <ArrowRight size={18} className="ml-2" />
            </Button>
          </Link>
          <Link to="/auth" className="block">
            <Button variant="outline" size="lg" className="w-full h-12 text-sm font-semibold rounded-2xl">
              Already a member? Sign In
            </Button>
          </Link>
        </motion.div>

        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.6, duration: 0.4 }}
          className="mt-5 text-xs text-muted-foreground"
        >
          Free forever for buyers · No strangers allowed
        </motion.p>
      </div>
    </div>,

    // ── Slide 2: Trust & Safety ──
    <div key="trust" className="min-h-[100dvh] flex flex-col justify-center px-6 relative overflow-hidden">
      <div className="absolute inset-0 bg-gradient-to-br from-secondary/40 via-background to-primary/5" />

      <div className="relative z-10 max-w-sm mx-auto">
        <div className="w-16 h-16 rounded-2xl bg-primary/12 flex items-center justify-center mb-6">
          <Shield className="text-primary" size={32} />
        </div>

        <h2 className="text-3xl font-extrabold mb-3 text-foreground leading-tight">
          No Strangers.<br />Only <span className="text-primary">Neighbors.</span>
        </h2>
        <p className="text-muted-foreground text-sm mb-8 leading-relaxed">
          Every person on this platform lives in your society. GPS-verified. Code-protected. You'll never interact with someone you couldn't knock on the door of.
        </p>

        <div className="space-y-3">
          {[
            { icon: MapPin, title: 'GPS-Verified Residents', desc: 'Proof of residence at signup — no faking it' },
            { icon: Lock, title: 'Gated Community, Gated App', desc: 'Society code required — your world stays private' },
            { icon: BadgeCheck, title: 'Reputation You Can See', desc: 'Trust scores built from real neighbor interactions' },
          ].map(({ icon: Icon, title, desc }) => (
            <div key={title} className="flex items-start gap-3.5 bg-card/80 backdrop-blur-sm p-4 rounded-2xl border border-border">
              <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
                <Icon className="text-primary" size={18} />
              </div>
              <div>
                <p className="text-sm font-semibold text-foreground">{title}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{desc}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>,

    // ── Slide 3: What You Can Do ──
    <div key="categories" className="min-h-[100dvh] flex flex-col justify-center px-6 relative overflow-hidden">
      <div className="absolute inset-0 bg-gradient-to-br from-accent/8 via-background to-primary/4" />

      <div className="relative z-10 max-w-sm mx-auto">
        <span className="text-xs font-bold text-primary uppercase tracking-widest mb-3 block">Hidden in Plain Sight</span>
        <h2 className="text-3xl font-extrabold mb-2 text-foreground leading-tight">
          The Best Things Were<br />Always Next Door
        </h2>
        <p className="text-muted-foreground text-sm mb-6">Homemade pickles, birthday cakes, AC repairs, yoga classes — all from people who live where you live.</p>

        <div className="grid grid-cols-2 gap-3">
          {displayGroups.map(({ icon: Icon, title, desc, color }) => (
            <div key={title} className="p-4 rounded-2xl bg-card/80 backdrop-blur-sm border border-border hover:shadow-sm transition-shadow">
              <div className={`w-10 h-10 rounded-xl flex items-center justify-center mb-2.5 ${color}`}>
                <Icon size={20} />
              </div>
              <h3 className="font-semibold text-sm text-foreground">{title}</h3>
              <p className="text-[11px] text-muted-foreground mt-0.5 leading-snug">{desc}</p>
            </div>
          ))}
        </div>

        <p className="text-xs text-muted-foreground text-center mt-5">
          + More categories added every week
        </p>
      </div>
    </div>,

    // ── Slide 4: For Sellers ──
    <div key="sellers" className="min-h-[100dvh] flex flex-col justify-center px-6 relative overflow-hidden">
      <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-background to-accent/8" />

      <div className="relative z-10 max-w-sm mx-auto">
        <div className="w-16 h-16 rounded-2xl bg-primary/12 flex items-center justify-center mb-6">
          <TrendingUp className="text-primary" size={32} />
        </div>

        <h2 className="text-3xl font-extrabold mb-3 text-foreground leading-tight">
          Your Skill Deserves<br /><span className="text-primary">An Audience.</span>
        </h2>
        <p className="text-muted-foreground text-sm mb-7 leading-relaxed">
          You cook, bake, teach, repair, or create something wonderful. Your neighbors just don't know yet. Give your talent a storefront — zero commission, zero risk.
        </p>

        <div className="space-y-3 mb-7">
          {[
            { icon: Sparkles, text: 'Zero commission — you keep every rupee' },
            { icon: Clock, text: 'Set up in 2 minutes, start earning today' },
            { icon: Heart, text: 'Repeat customers who live in your building' },
            { icon: CheckCircle2, text: 'Orders, payments, reviews — all handled' },
          ].map(({ icon: Icon, text }) => (
            <div key={text} className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                <Icon className="text-primary" size={15} />
              </div>
              <span className="text-sm font-medium text-foreground">{text}</span>
            </div>
          ))}
        </div>

        <Link to="/auth" className="block">
          <Button size="lg" className="w-full h-14 text-base font-bold shadow-cta rounded-2xl">
            Start Selling Today <ArrowRight size={18} className="ml-2" />
          </Button>
        </Link>
      </div>
    </div>,

    // ── Slide 5: Social Proof + Final CTA ──
    <div key="social" className="min-h-[100dvh] flex flex-col justify-center px-6 relative overflow-hidden">
      <div className="absolute inset-0 bg-gradient-to-br from-primary/6 via-background to-secondary/20" />

      <div className="relative z-10 max-w-sm mx-auto">
        <h2 className="text-3xl font-extrabold mb-6 text-foreground text-center leading-tight">
          Your Neighbors Are<br />Already <span className="text-primary">Here</span>
        </h2>

        {/* Testimonial Card */}
        <div className="bg-card rounded-2xl p-5 border border-border shadow-sm mb-5">
          <div className="flex gap-1 mb-3">
            {[...Array(5)].map((_, i) => (
              <Star key={i} className="fill-warning text-warning" size={16} />
            ))}
          </div>
          <p className="text-sm text-foreground leading-relaxed italic mb-4">
            "My son is allergic to nuts. Mrs. Patel makes his tiffin every day — she knows exactly what to avoid. No Swiggy filter can replace a neighbor who cares."
          </p>
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center">
              <span className="text-sm font-bold text-primary">PM</span>
            </div>
            <div>
              <p className="font-semibold text-foreground text-sm">Priya M.</p>
              <p className="text-[11px] text-muted-foreground">Working Parent · Prestige Lakeside</p>
            </div>
          </div>
        </div>

        {/* Live Stats */}
        <div className="flex justify-around bg-card rounded-2xl p-4 border border-border mb-6">
          <div className="text-center">
            <p className="text-2xl font-bold text-primary tabular-nums">{stats.societies > 0 ? `${stats.societies}+` : '—'}</p>
            <p className="text-[10px] text-muted-foreground font-medium mt-0.5">Societies</p>
          </div>
          <div className="w-px bg-border" />
          <div className="text-center">
            <p className="text-2xl font-bold text-primary tabular-nums">{stats.sellers > 0 ? `${stats.sellers}+` : '—'}</p>
            <p className="text-[10px] text-muted-foreground font-medium mt-0.5">Verified Sellers</p>
          </div>
          <div className="w-px bg-border" />
          <div className="text-center">
            <p className="text-2xl font-bold text-primary tabular-nums">{stats.orders > 0 ? `${stats.orders}+` : '—'}</p>
            <p className="text-[10px] text-muted-foreground font-medium mt-0.5">Orders Placed</p>
          </div>
        </div>

        {/* Final CTA */}
        <Link to="/auth" className="block">
          <Button size="lg" className="w-full h-14 text-base font-bold shadow-cta rounded-2xl">
            Discover Your Society <ArrowRight size={18} className="ml-2" />
          </Button>
        </Link>
        <p className="text-center mt-4">
          <Link to="/auth" className="text-sm text-primary font-medium hover:underline">
            Already have an account? Sign in
          </Link>
        </p>
      </div>
    </div>,
  ];

  return (
    <div className="min-h-[100dvh] bg-background">
      {/* Carousel */}
      <div className="relative overflow-hidden" ref={emblaRef}>
        <div className="flex">
          {slides.map((slide, i) => (
            <div key={i} className="min-w-0 shrink-0 grow-0 basis-full">
              {slide}
            </div>
          ))}
        </div>
      </div>

      {/* Bottom fixed area: dots + legal links */}
      <div className="fixed bottom-[env(safe-area-inset-bottom,0px)] left-0 right-0 z-50 flex flex-col items-center gap-2 pb-3 pointer-events-none">
        {/* Dot Indicators */}
        <div className="flex gap-2 bg-card/90 backdrop-blur-md px-5 py-3 rounded-full border border-border shadow-lg pointer-events-auto">
          {slides.map((_, i) => (
            <button
              key={i}
              onClick={() => emblaApi?.scrollTo(i)}
              aria-label={`Go to slide ${i + 1}`}
              className={`h-2.5 rounded-full transition-all duration-300 ${
                activeSlide === i ? 'bg-primary w-7' : 'bg-muted-foreground/25 w-2.5 hover:bg-muted-foreground/40'
              }`}
            />
          ))}
        </div>

        {/* Legal links below dots */}
        <div className="flex gap-4 text-[10px] text-muted-foreground/60 pointer-events-auto">
          <Link to="/privacy-policy" className="hover:text-foreground transition-colors">Privacy</Link>
          <span>·</span>
          <Link to="/terms" className="hover:text-foreground transition-colors">Terms</Link>
          <span>·</span>
          <Link to="/pricing" className="hover:text-foreground transition-colors">Pricing</Link>
        </div>
      </div>
    </div>
  );
}
