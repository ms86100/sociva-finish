// @ts-nocheck
import { useMemo } from 'react';
import { Check, X } from 'lucide-react';

interface PasswordStrengthIndicatorProps {
  password: string;
}

const checks = [
  { label: '6+ characters', test: (p: string) => p.length >= 6 },
  { label: 'Uppercase letter', test: (p: string) => /[A-Z]/.test(p) },
  { label: 'Number', test: (p: string) => /[0-9]/.test(p) },
  { label: 'Special character', test: (p: string) => /[^A-Za-z0-9]/.test(p) },
];

export function PasswordStrengthIndicator({ password }: PasswordStrengthIndicatorProps) {
  const passed = useMemo(() => checks.filter(c => c.test(password)).length, [password]);

  if (!password) return null;

  const strength = passed <= 1 ? 'Weak' : passed <= 2 ? 'Fair' : passed <= 3 ? 'Good' : 'Strong';
  const color = passed <= 1 ? 'bg-destructive' : passed <= 2 ? 'bg-orange-400' : passed <= 3 ? 'bg-yellow-400' : 'bg-green-500';
  const textColor = passed <= 1 ? 'text-destructive' : passed <= 2 ? 'text-orange-500' : passed <= 3 ? 'text-yellow-600' : 'text-green-600';

  return (
    <div className="space-y-2 pt-1">
      {/* Strength bar */}
      <div className="flex items-center gap-2">
        <div className="flex-1 flex gap-1">
          {[1, 2, 3, 4].map(i => (
            <div
              key={i}
              className={`h-1.5 flex-1 rounded-full transition-all duration-300 ${i <= passed ? color : 'bg-muted'}`}
            />
          ))}
        </div>
        <span className={`text-xs font-semibold ${textColor} transition-colors duration-300`}>{strength}</span>
      </div>

      {/* Check list */}
      <div className="grid grid-cols-2 gap-x-2 gap-y-1">
        {checks.map(c => {
          const ok = c.test(password);
          return (
            <div key={c.label} className="flex items-center gap-1.5">
              {ok ? (
                <Check size={12} className="text-green-500 shrink-0" />
              ) : (
                <X size={12} className="text-muted-foreground/50 shrink-0" />
              )}
              <span className={`text-[11px] ${ok ? 'text-green-600 font-medium' : 'text-muted-foreground/70'} transition-colors duration-200`}>
                {c.label}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
