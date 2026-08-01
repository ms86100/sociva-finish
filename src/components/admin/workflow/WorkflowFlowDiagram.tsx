// @ts-nocheck
import { useMemo, useRef, useEffect, useState, useCallback } from 'react';
import { type FlowStep, type Transition, formatName } from './types';
import { cn } from '@/lib/utils';
import { CircleStop, Play, Truck, KeyRound, CheckCircle2 } from 'lucide-react';

const ACTOR_COLORS: Record<string, string> = {
  buyer: 'hsl(var(--primary))',
  seller: 'hsl(var(--accent-foreground))',
  delivery: 'hsl(142 71% 45%)',
  system: 'hsl(var(--muted-foreground))',
  admin: 'hsl(0 72% 51%)',
};

interface Edge {
  from: string;
  to: string;
  actors: string[];
  isBidirectional: boolean;
}

interface Props {
  steps: FlowStep[];
  transitions: Transition[];
}

export function WorkflowFlowDiagram({ steps, transitions }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const nodeRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const [positions, setPositions] = useState<Map<string, DOMRect>>(new Map());

  const sortedSteps = useMemo(
    () => [...steps].sort((a, b) => a.sort_order - b.sort_order),
    [steps]
  );

  const edges = useMemo(() => {
    const pairMap = new Map<string, { actors: string[]; reverse: boolean }>();
    for (const t of transitions) {
      const fwd = `${t.from_status}::${t.to_status}`;
      const rev = `${t.to_status}::${t.from_status}`;
      if (!pairMap.has(fwd)) {
        pairMap.set(fwd, { actors: [], reverse: false });
      }
      pairMap.get(fwd)!.actors.push(t.allowed_actor);
    }
    const result: Edge[] = [];
    const visited = new Set<string>();
    for (const [key, val] of pairMap) {
      if (visited.has(key)) continue;
      const [from, to] = key.split('::');
      const revKey = `${to}::${from}`;
      const isBi = pairMap.has(revKey);
      const actors = [...new Set([...val.actors, ...(isBi ? pairMap.get(revKey)!.actors : [])])];
      result.push({ from, to, actors, isBidirectional: isBi });
      visited.add(key);
      if (isBi) visited.add(revKey);
    }
    return result;
  }, [transitions]);

  const measure = useCallback(() => {
    if (!containerRef.current) return;
    const containerRect = containerRef.current.getBoundingClientRect();
    const newPos = new Map<string, DOMRect>();
    for (const [key, el] of nodeRefs.current) {
      const r = el.getBoundingClientRect();
      newPos.set(key, new DOMRect(
        r.left - containerRect.left,
        r.top - containerRect.top,
        r.width,
        r.height
      ));
    }
    setPositions(newPos);
  }, []);

  useEffect(() => {
    const timer = setTimeout(measure, 50);
    return () => clearTimeout(timer);
  }, [sortedSteps, transitions, measure]);

  useEffect(() => {
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [measure]);

  const setNodeRef = useCallback((key: string, el: HTMLDivElement | null) => {
    if (el) nodeRefs.current.set(key, el);
    else nodeRefs.current.delete(key);
  }, []);

  if (sortedSteps.length === 0) return null;

  return (
    <div className="relative" ref={containerRef}>
      {/* SVG arrows layer */}
      <svg className="absolute inset-0 w-full h-full pointer-events-none overflow-visible" style={{ zIndex: 1 }}>
        <defs>
          {Object.entries(ACTOR_COLORS).map(([actor, color]) => (
            <marker
              key={actor}
              id={`arrow-${actor}`}
              viewBox="0 0 10 7"
              refX="9"
              refY="3.5"
              markerWidth="8"
              markerHeight="6"
              orient="auto-start-fix"
            >
              <path d="M 0 0 L 10 3.5 L 0 7 z" fill={color} />
            </marker>
          ))}
          <marker
            id="arrow-multi"
            viewBox="0 0 10 7"
            refX="9"
            refY="3.5"
            markerWidth="8"
            markerHeight="6"
            orient="auto-start-fix"
          >
            <path d="M 0 0 L 10 3.5 L 0 7 z" fill="hsl(var(--muted-foreground))" />
          </marker>
        </defs>

        {edges.map((edge, i) => {
          const fromRect = positions.get(edge.from);
          const toRect = positions.get(edge.to);
          if (!fromRect || !toRect) return null;

          const fromIdx = sortedSteps.findIndex(s => s.status_key === edge.from);
          const toIdx = sortedSteps.findIndex(s => s.status_key === edge.to);
          const isForward = toIdx > fromIdx;
          const isAdjacent = Math.abs(toIdx - fromIdx) === 1;
          const color = edge.actors.length === 1
            ? ACTOR_COLORS[edge.actors[0]] || 'hsl(var(--muted-foreground))'
            : 'hsl(var(--muted-foreground))';
          const markerId = edge.actors.length === 1 ? `arrow-${edge.actors[0]}` : 'arrow-multi';

          // Straight horizontal arrow for adjacent nodes
          if (isAdjacent && isForward) {
            const x1 = fromRect.left + fromRect.width;
            const y1 = fromRect.top + fromRect.height / 2;
            const x2 = toRect.left;
            const y2 = toRect.top + toRect.height / 2;
            const midY = (y1 + y2) / 2;

            return (
              <g key={i}>
                <line
                  x1={x1 + 2} y1={midY}
                  x2={x2 - 2} y2={midY}
                  stroke={color}
                  strokeWidth={1.5}
                  markerEnd={`url(#${markerId})`}
                  markerStart={edge.isBidirectional ? `url(#${markerId})` : undefined}
                  opacity={0.7}
                />
              </g>
            );
          }

          // Curved arrow for non-adjacent or backward transitions
          const offset = (Math.abs(toIdx - fromIdx)) * 12 + 20;
          const isBackward = toIdx < fromIdx;
          const curveDir = isBackward ? 1 : -1; // backward goes below, forward skip goes above

          const x1 = fromRect.left + fromRect.width / 2;
          const y1 = isBackward
            ? fromRect.top + fromRect.height
            : fromRect.top;
          const x2 = toRect.left + toRect.width / 2;
          const y2 = isBackward
            ? toRect.top + toRect.height
            : toRect.top;

          const cy = isBackward
            ? Math.max(y1, y2) + offset
            : Math.min(y1, y2) - offset;

          const path = `M ${x1} ${y1} Q ${(x1 + x2) / 2} ${cy} ${x2} ${y2}`;

          return (
            <g key={i}>
              <path
                d={path}
                fill="none"
                stroke={color}
                strokeWidth={1.5}
                strokeDasharray={isBackward ? '4 3' : undefined}
                markerEnd={`url(#${markerId})`}
                markerStart={edge.isBidirectional ? `url(#${markerId})` : undefined}
                opacity={0.6}
              />
            </g>
          );
        })}
      </svg>

      {/* Nodes layer */}
      <div className="flex flex-wrap items-center gap-x-6 gap-y-10 relative" style={{ zIndex: 2, padding: '28px 8px' }}>
        {sortedSteps.map((step, idx) => {
          const isFirst = idx === 0;
          const isTerminal = step.is_terminal;
          const isDeprecated = (step as any).is_deprecated;

          return (
            <div
              key={step.status_key}
              ref={(el) => setNodeRef(step.status_key, el)}
              className={cn(
                'relative flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-[11px] font-semibold whitespace-nowrap select-none',
                'bg-background shadow-sm',
                isTerminal && 'border-green-400 dark:border-green-600 ring-1 ring-green-200 dark:ring-green-800',
                isFirst && !isTerminal && 'border-primary ring-1 ring-primary/20',
                !isTerminal && !isFirst && 'border-border',
                isDeprecated && 'opacity-50 border-dashed'
              )}
            >
              {isFirst && (
                <Play size={10} className="text-primary shrink-0" />
              )}
              {step.is_transit && (
                <Truck size={9} className="text-blue-500 shrink-0" />
              )}
              {(step as any).creates_tracking_assignment && (
                <span className="text-[8px] px-1 py-0 rounded bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400 font-normal">Delivery starts</span>
              )}
              {(step as any).otp_type === 'delivery' && (
                <KeyRound size={9} className="text-amber-500 shrink-0" />
              )}
              <span>{step.display_label || formatName(step.status_key)}</span>
              {step.is_success && (
                <CheckCircle2 size={9} className="text-emerald-500 shrink-0" />
              )}
              {isTerminal && (
                <CircleStop size={10} className="text-green-600 dark:text-green-400 shrink-0" />
              )}
            </div>
          );
        })}
      </div>

      {/* Legend */}
      {edges.length > 0 && (
        <div className="flex items-center gap-3 mt-1 flex-wrap">
          {Object.entries(ACTOR_COLORS).map(([actor, color]) => {
            const hasActor = edges.some(e => e.actors.includes(actor));
            if (!hasActor) return null;
            return (
              <div key={actor} className="flex items-center gap-1">
                <div className="w-4 h-0.5 rounded-full" style={{ backgroundColor: color }} />
                <span className="text-[9px] text-muted-foreground capitalize">{actor}</span>
              </div>
            );
          })}
          <div className="flex items-center gap-1">
            <span className="text-[9px] text-muted-foreground">→ one-way</span>
          </div>
          <div className="flex items-center gap-1">
            <span className="text-[9px] text-muted-foreground">↔ bi-directional</span>
          </div>
        </div>
      )}
    </div>
  );
}
