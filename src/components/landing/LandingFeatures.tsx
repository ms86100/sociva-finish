// @ts-nocheck
import {
  ShoppingBag, Utensils, Wrench, MessageSquare, CreditCard, Star,
} from 'lucide-react';
import { motion, useInView } from 'framer-motion';
import { useRef } from 'react';

const BENEFITS = [
  { icon: Utensils, title: 'Home Kitchens, Not Cloud Kitchens', desc: "Your neighbor's rajma chawal, the aunt who makes birthday cakes to order, the uncle who pickles mangoes every summer. Food you literally can't find on any delivery app." },
  { icon: Wrench, title: 'Services From People You See Every Day', desc: "When the plumber lives in B-block, he can't ghost you. Proximity creates accountability that no rating system can match." },
  { icon: ShoppingBag, title: 'Know the Maker, Not Just the Rating', desc: "You've seen her kids play in the park. You know he walks his dog at 7 AM. When you know the person, you trust the product." },
  { icon: MessageSquare, title: 'Custom Orders, Just Ask', desc: "\"Can you make it without onion?\" \"Can you come at 4 PM instead?\" Chat directly with your neighbor — no call center, no chatbot." },
  { icon: CreditCard, title: 'No Surge Pricing, No Algorithms', desc: "Prices set by real people, not demand curves. Pay via UPI, GPay, PhonePe, or cash. No subscriptions, no hidden fees." },
  { icon: Star, title: "Reviews From People You'll Meet in the Elevator", desc: "Every review is from a verified resident. You can't fake a review when the reviewer lives two floors above you." },
];

export function LandingFeatures() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: '-80px' });

  return (
    <section id="features" ref={ref} className="py-20 lg:py-28">
      <div className="container mx-auto px-4 lg:px-8">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={inView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.5 }}
          className="text-center mb-14"
        >
          <h2 className="text-3xl md:text-4xl font-bold text-foreground mb-4">
            Things No Delivery App Can Offer
          </h2>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
            Speed is Blinkit's game. Exclusivity is ours. Here's what only your neighbors can give you.
          </p>
        </motion.div>

        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6 max-w-5xl mx-auto">
          {BENEFITS.map(({ icon: Icon, title, desc }, i) => (
            <motion.div
              key={title}
              initial={{ opacity: 0, y: 24 }}
              animate={inView ? { opacity: 1, y: 0 } : {}}
              transition={{ duration: 0.45, delay: i * 0.08 }}
              className="group p-6 rounded-2xl bg-card border border-border hover:shadow-md hover:-translate-y-1 transition-all duration-200"
            >
              <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center mb-4 group-hover:bg-primary/15 transition-colors">
                <Icon className="text-primary" size={22} />
              </div>
              <h4 className="font-semibold text-foreground mb-2">{title}</h4>
              <p className="text-sm text-muted-foreground leading-relaxed">{desc}</p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
