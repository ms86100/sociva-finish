// @ts-nocheck
import { motion, useInView } from 'framer-motion';
import { useRef } from 'react';
import { Quote } from 'lucide-react';

const TESTIMONIALS = [
  {
    quote: "My son is allergic to nuts. Mrs. Patel on the 5th floor makes his tiffin every day — she knows exactly what to avoid. No Swiggy filter can replace that.",
    name: 'Priya M.',
    role: 'Working Parent',
    society: 'Prestige Lakeside',
  },
  {
    quote: "I tried Zomato for my baking business — 30% commission killed my margins. Here I keep everything. 22 repeat customers, all from my own society.",
    name: 'Anita K.',
    role: 'Home Baker & Seller',
    society: 'Brigade Gateway',
  },
  {
    quote: "The retired engineer in C-block fixed our AC in 20 minutes. We'd been waiting 3 days for the UrbanClap guy who never showed up.",
    name: 'Rajesh S.',
    role: 'Resident',
    society: 'Sobha Dream Acres',
  },
];

export function LandingTestimonials() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: '-80px' });

  return (
    <section ref={ref} className="py-20 lg:py-28">
      <div className="container mx-auto px-4 lg:px-8">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={inView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.5 }}
          className="text-center mb-14"
        >
          <h2 className="text-3xl md:text-4xl font-bold text-foreground mb-4">
            Your Neighbors Are Already Here
          </h2>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
            Real stories from families using the platform every day.
          </p>
        </motion.div>

        <div className="grid md:grid-cols-3 gap-6 max-w-4xl mx-auto">
          {TESTIMONIALS.map(({ quote, name, role, society }, i) => (
            <motion.div
              key={name}
              initial={{ opacity: 0, y: 24 }}
              animate={inView ? { opacity: 1, y: 0 } : {}}
              transition={{ duration: 0.5, delay: i * 0.12 }}
              className="p-6 rounded-2xl bg-card border border-border"
            >
              <Quote className="text-primary/30 mb-3" size={24} />
              <p className="text-sm text-foreground leading-relaxed mb-5 italic">"{quote}"</p>
              <div>
                <p className="font-semibold text-foreground text-sm">{name}</p>
                <p className="text-xs text-muted-foreground">{role} · {society}</p>
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}