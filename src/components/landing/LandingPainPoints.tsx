// @ts-nocheck
import { ShieldAlert, Truck, ChefHat } from 'lucide-react';
import { motion, useInView } from 'framer-motion';
import { useRef } from 'react';

const PAINS = [
  {
    icon: ChefHat,
    pain: "Mrs. Sharma's dal makhani is legendary. But she's not on Zomato.",
    solution: "The best home-cooked food in your society has no delivery app listing. Here, every home kitchen finally has a storefront — and you're the first customer.",
    color: 'bg-primary/10 text-primary',
  },
  {
    icon: Truck,
    pain: "You've called 5 plumbers from Google. None showed up.",
    solution: "The electrician in A-block and the carpenter in Tower 3 are verified residents. They live 2 minutes away. They can't ghost you — you'll see them in the elevator.",
    color: 'bg-warning/10 text-warning',
  },
  {
    icon: ShieldAlert,
    pain: 'Your kid needs math help. The retired professor lives in C-block.',
    solution: "Tutors, yoga instructors, music teachers — they're already your neighbors. No strangers entering your home. No background-check anxiety.",
    color: 'bg-destructive/10 text-destructive',
  },
];

export function LandingPainPoints() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: '-80px' });

  return (
    <section ref={ref} className="py-20 lg:py-28 bg-muted/30">
      <div className="container mx-auto px-4 lg:px-8">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={inView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.5 }}
          className="text-center mb-14"
        >
          <h2 className="text-3xl md:text-4xl font-bold text-foreground mb-4">
            You're Missing Out on What's Right Next Door
          </h2>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
            The best food, services, and skills in your society have no app — until now.
          </p>
        </motion.div>

        <div className="grid md:grid-cols-3 gap-6 max-w-4xl mx-auto">
          {PAINS.map(({ icon: Icon, pain, solution, color }, i) => (
            <motion.div
              key={pain}
              initial={{ opacity: 0, y: 24 }}
              animate={inView ? { opacity: 1, y: 0 } : {}}
              transition={{ duration: 0.5, delay: i * 0.12 }}
              className="p-6 rounded-2xl bg-card border border-border hover:shadow-md transition-shadow"
            >
              <div className={`w-12 h-12 rounded-xl ${color} flex items-center justify-center mb-4`}>
                <Icon size={22} />
              </div>
              <h3 className="font-bold text-foreground mb-2 text-base">{pain}</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">{solution}</p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}