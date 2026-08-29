import { Button } from '@/components/ui/button';
import { DynamicIcon } from '@/components/ui/DynamicIcon';
import { cn } from '@/lib/utils';
import type { ParentGroupInfo } from '@/hooks/useParentGroups';
import { ChevronRight, Loader2 } from 'lucide-react';

interface ParentGroupPickerStepProps {
  groups: ParentGroupInfo[];
  selectedGroup: string | null;
  isLoading?: boolean;
  onSelect: (slug: string) => void;
  onContinue?: (slug: string) => void;
  onBack?: () => void;
  helper?: string;
  continueLabel?: string;
}

export function ParentGroupPickerStep({
  groups,
  selectedGroup,
  isLoading,
  onSelect,
  onContinue,
  onBack,
  helper = 'Which of these best describes what you offer? One store stays in one type.',
  continueLabel = 'Continue',
}: ParentGroupPickerStepProps) {
  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12 text-muted-foreground gap-2">
        <Loader2 className="animate-spin" size={18} />
        Loading store types…
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {onBack && (
        <button type="button" onClick={onBack} className="flex items-center gap-1 text-sm text-muted-foreground">
          ← What you offer
        </button>
      )}
      <p className="text-sm text-muted-foreground">
        {helper}
      </p>
      <div className="grid grid-cols-2 gap-2">
        {groups.map((group) => {
          const isSelected = selectedGroup === group.value;
          return (
            <button
              key={group.value}
              type="button"
              onClick={() => onSelect(group.value)}
              className={cn(
                'flex flex-col items-start gap-2 p-3 rounded-xl border-2 transition-all text-left min-h-[96px]',
                isSelected ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/30',
              )}
            >
              <div className={cn('w-10 h-10 rounded-xl flex items-center justify-center', group.color)}>
                <DynamicIcon name={group.icon} size={20} />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-semibold leading-tight">{group.label}</p>
                {group.description && (
                  <p className="text-[10px] text-muted-foreground line-clamp-2 mt-0.5">{group.description}</p>
                )}
              </div>
            </button>
          );
        })}
      </div>
      <Button
        className="w-full"
        disabled={!selectedGroup}
        onClick={() => selectedGroup && (onContinue || onSelect)(selectedGroup)}
      >
        {continueLabel}<ChevronRight size={16} className="ml-1" />
      </Button>
    </div>
  );
}
