// @ts-nocheck
import { useRef, useState, useEffect, ReactNode } from 'react';

/**
 * Defers rendering of children until the wrapper scrolls into view.
 * No enter animation — motion was costing main-thread time on mobile.
 */
export function LazySection({ children, className }: { children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: '120px 0px' }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  if (!visible) {
    return <div ref={ref} className={className} />;
  }

  return (
    <div ref={ref} className={className}>
      {children}
    </div>
  );
}
