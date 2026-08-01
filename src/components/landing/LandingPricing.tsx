// @ts-nocheck
import { Check } from 'lucide-react';
import { motion, useInView } from 'framer-motion';
import { useRef } from 'react';

const PLANS = [
  {
    name: 'Buyers',
    price: 'Free',
    period: 'forever',
    desc: 'Browse, order, and connect — always free.',
    features: [
      'Browse all listings in your society',
      'Place unlimited orders',
      'Chat with sellers directly',
      'Leave reviews & ratings',
      'Real-time order tracking',
    ],
  },
  {
    name: 'Sellers',
    price: 'Free',
    period: 'to start',
    desc: "Your kitchen, craft studio, or skill — finally has a storefront. Zero commission. Zero listing fees.",
    badge: 'Most Popular',
    features: [
      'List products, food, or services',
      'Accept UPI & Cash on Delivery',
      'Order management dashboard',
      'Create promotional coupons',
      'Customer reviews and analytics',
    ],
  },
];

export function LandingPricing() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: '-80px' });

  return (
    <section id="pricing" ref={ref} className="py-20 lg:py-28 bg-muted/30">
      <div className="container mx-auto px-4 lg:px-8">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={inView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.5 }}
          className="text-center mb-14"
        >
          <h2 className="text-3xl md:text-4xl font-bold text-foreground mb-4">
            Free for Buyers. Zero Listing Fees for Sellers.
          </h2>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
            No credit card required. No hidden charges. No surprises.
          </p>
        </motion.div>

        <div className="grid md:grid-cols-2 gap-8 max-w-3xl mx-auto">
          {PLANS.map((plan, i) => (
            <motion.div
              key={plan.name}
              initial={{ opacity: 0, y: 24 }}
              animate={inView ? { opacity: 1, y: 0 } : {}}
              transition={{ duration: 0.5, delay: i * 0.12 }}
              className={`p-8 rounded-2xl bg-card border ${plan.badge ? 'border-primary shadow-md' : 'border-border'}`}
            >
              {plan.badge && (
                <span className="inline-block text-xs font-bold text-primary-foreground bg-primary px-3 py-1 rounded-full mb-4">{plan.badge}</span>
              )}
              <h3 className="text-xl font-bold text-foreground mb-1">{plan.name}</h3>
              <div className="flex items-baseline gap-1 mb-2">
                <span className="text-3xl font-bold text-foreground">{plan.price}</span>
                <span className="text-sm text-muted-foreground">{plan.period}</span>
              </div>
              <p className="text-sm text-muted-foreground mb-6">{plan.desc}</p>
              <ul className="space-y-3">
                {plan.features.map(f => (
                  <li key={f} className="flex items-start gap-2 text-sm">
                    <Check className="text-primary shrink-0 mt-0.5" size={16} />
                    <span className="text-foreground">{f}</span>
                  </li>
                ))}
              </ul>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
