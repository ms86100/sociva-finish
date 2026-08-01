// @ts-nocheck
import { MapPin, Search, ShoppingBag } from 'lucide-react';
import { motion, useInView } from 'framer-motion';
import { useRef } from 'react';

const STEPS = [
  {
    icon: MapPin,
    step: '1',
    title: 'Prove You Live Here',
    desc: "GPS verifies you're a real resident. No outsiders, no fake profiles — just families who share your compound.",
  },
  {
    icon: Search,
    step: '2',
    title: 'Discover Hidden Gems',
    desc: "Find the home baker in Tower B, the yoga teacher in A-block, the uncle who repairs everything. They've always been here — now you can find them.",
  },
  {
    icon: ShoppingBag,
    step: '3',
    title: 'Order From Someone You Trust',
    desc: "No anonymous rider. No mystery kitchen. Your neighbor makes it, your neighbor delivers it. You'll probably thank them in the elevator.",
  },
];

export function LandingHowItWorks() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: '-80px' });

  return (
    <section id="how-it-works" ref={ref} className="py-20 lg:py-28 bg-muted/30">
      <div className="container mx-auto px-4 lg:px-8">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={inView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.5 }}
          className="text-center mb-14"
        >
          <h2 className="text-3xl md:text-4xl font-bold text-foreground mb-4">
            From Stranger-Free to Stress-Free
          </h2>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
            Three steps between you and the best-kept secrets of your society.
          </p>
        </motion.div>

        <div className="grid md:grid-cols-3 gap-8 max-w-3xl mx-auto">
          {STEPS.map(({ icon: Icon, step, title, desc }, i) => (
            <motion.div
              key={step}
              initial={{ opacity: 0, y: 24 }}
              animate={inView ? { opacity: 1, y: 0 } : {}}
              transition={{ duration: 0.5, delay: i * 0.15 }}
              className="text-center"
            >
              <div className="w-16 h-16 rounded-2xl bg-primary flex items-center justify-center mx-auto mb-4 shadow-cta">
                <Icon className="text-primary-foreground" size={28} />
              </div>
              <span className="text-xs font-bold text-primary uppercase tracking-wider">Step {step}</span>
              <h3 className="text-lg font-bold text-foreground mt-1 mb-2">{title}</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">{desc}</p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
