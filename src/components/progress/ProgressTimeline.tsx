// @ts-nocheck
import { cn } from '@/lib/utils';
import { Check, Circle } from 'lucide-react';

const STAGES = [
  { key: 'foundation', label: 'Foundation' },
  { key: 'structure', label: 'Structure' },
  { key: 'mep', label: 'MEP' },
  { key: 'finishing', label: 'Finishing' },
  { key: 'handover', label: 'Handover' },
  { key: 'completed', label: 'Completed' },
];

interface ProgressTimelineProps {
  currentStage: string;
  overallPercentage: number;
}

export function ProgressTimeline({ currentStage, overallPercentage }: ProgressTimelineProps) {
  const currentIndex = STAGES.findIndex(s => s.key === currentStage);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between text-sm">
        <span className="font-semibold">Overall Progress</span>
        <span className="text-primary font-bold">{overallPercentage}%</span>
      </div>
      <div className="h-3 w-full rounded-full bg-secondary overflow-hidden">
        <div
          className="h-full bg-gradient-to-r from-primary to-primary/70 rounded-full transition-all duration-500"
          style={{ width: `${overallPercentage}%` }}
        />
      </div>

      <div className="flex items-center justify-between mt-4">
        {STAGES.map((stage, index) => {
          const isCompleted = index < currentIndex || (index === currentIndex && currentStage === 'completed');
          const isCurrent = index === currentIndex && currentStage !== 'completed';

          return (
            <div key={stage.key} className="flex flex-col items-center gap-1 flex-1">
              <div className="relative flex items-center justify-center w-full">
                {/* Connector line */}
                {index > 0 && (
                  <div
                    className={cn(
                      'absolute right-1/2 h-0.5 w-full -z-10',
                      isCompleted || isCurrent ? 'bg-primary' : 'bg-muted'
                    )}
                  />
                )}
                {/* Node */}
                <div
                  className={cn(
                    'w-5 h-5 rounded-full flex items-center justify-center z-10 border-2',
                    isCompleted
                      ? 'bg-primary border-primary text-primary-foreground'
                      : isCurrent
                        ? 'bg-background border-primary'
                        : 'bg-background border-muted'
                  )}
                >
                  {isCompleted ? (
                    <Check size={10} />
                  ) : isCurrent ? (
                    <Circle size={6} className="fill-primary text-primary" />
                  ) : null}
                </div>
              </div>
              <span
                className={cn(
                  'text-[8px] text-center leading-tight',
                  isCompleted || isCurrent ? 'text-primary font-semibold' : 'text-muted-foreground'
                )}
              >
                {stage.label}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
