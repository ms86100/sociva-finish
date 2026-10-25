import { useEffect, useState } from 'react';
import { ArrowRight } from 'lucide-react';
import { hapticSelection } from '@/lib/haptics';
import { cn } from '@/lib/utils';
import { optimizedImageUrl, handleImageError } from '@/utils/imageHelpers';

const LINE_1 = 'What Your Neighbor Makes,';
const LINE_2 = 'No App Can Deliver.';
export const NEIGHBOR_HEADLINE = 'What Your Neighbor Makes, No App Can Deliver.';

function useNeighborTypewriter() {
  const [line1, setLine1] = useState('');
  const [line2, setLine2] = useState('');
  const [cursor, setCursor] = useState<'line1' | 'line2' | 'done'>('line1');

  useEffect(() => {
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
    if (reduced) {
      setLine1(LINE_1);
      setLine2(LINE_2);
      setCursor('done');
      return;
    }

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let phase: 'line1' | 'gap' | 'line2' | 'hold' = 'line1';
    let index = 0;

    const schedule = (ms: number, fn: () => void) => {
      timer = setTimeout(() => {
        if (!cancelled) fn();
      }, ms);
    };

    const tick = () => {
      if (phase === 'line1') {
        index += 1;
        setLine1(LINE_1.slice(0, index));
        setCursor('line1');
        if (index >= LINE_1.length) {
          phase = 'gap';
          index = 0;
          schedule(260, tick);
          return;
        }
        schedule(38, tick);
        return;
      }
      if (phase === 'gap') {
        phase = 'line2';
        schedule(40, tick);
        return;
      }
      if (phase === 'line2') {
        index += 1;
        setLine2(LINE_2.slice(0, index));
        setCursor('line2');
        if (index >= LINE_2.length) {
          phase = 'hold';
          setCursor('done');
          schedule(4800, tick);
          return;
        }
        schedule(38, tick);
        return;
      }
      setLine1('');
      setLine2('');
      index = 0;
      phase = 'line1';
      setCursor('line1');
      schedule(180, tick);
    };

    schedule(280, tick);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, []);

  return { line1, line2, cursor };
}

function TypeCursor() {
  return <span className="neighbor-type-cursor" aria-hidden />;
}

export function NeighborMakesBanner({
  imageUrl,
  onOrderNow,
  className,
}: {
  imageUrl: string | null;
  onOrderNow: () => void;
  className?: string;
}) {
  const { line1, line2, cursor } = useNeighborTypewriter();

  return (
    <div className={cn('px-4 mt-2', className)}>
      <button
        type="button"
        onClick={() => {
          hapticSelection();
          onOrderNow();
        }}
        className="relative w-full overflow-hidden rounded-[22px] aspect-[2.15/1] bg-zinc-900 text-left active:scale-[0.99] transition-transform"
        data-testid="guided-discovery-home-food-hero"
      >
        {imageUrl && (
          <img
            src={optimizedImageUrl(imageUrl, { width: 640, quality: 70 })}
            alt=""
            className="absolute inset-0 h-full w-full object-cover object-[70%_center]"
            onError={handleImageError}
          />
        )}
        <div className="absolute inset-0 bg-gradient-to-r from-black via-black/75 to-black/20" />
        <div className="neighbor-banner-sheen" aria-hidden />
        <div className="relative z-10 flex h-full max-w-[62%] flex-col justify-center px-4 py-3">
          <p className="neighbor-banner-headline text-[18px] font-extrabold leading-tight text-white" aria-label={NEIGHBOR_HEADLINE}>
            <span className="neighbor-banner-line">
              {line1}
              {cursor === 'line1' ? <TypeCursor /> : null}
            </span>
            <span className={cn('neighbor-banner-punch', cursor === 'done' && 'neighbor-banner-punch-ready')}>
              {line2}
              {cursor === 'line2' ? <TypeCursor /> : null}
            </span>
          </p>
          <span className="mt-3 inline-flex w-fit items-center gap-1 rounded-full bg-amber-400 px-3.5 py-1.5 text-[12px] font-extrabold text-zinc-900">
            Order Now
            <ArrowRight size={13} />
          </span>
        </div>
      </button>
    </div>
  );
}
