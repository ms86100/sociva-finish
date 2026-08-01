// @ts-nocheck
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { ChevronDown, Info, Lightbulb, AlertTriangle, CheckCircle2, LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ReactNode } from 'react';

/* ─── Reusable doc building blocks (supports both old and new API) ─── */

export function DocSection({ title, children, id }: { title: string; children: ReactNode; id?: string }) {
  return (
    <Collapsible defaultOpen>
      <CollapsibleTrigger className="flex items-center gap-1.5 group cursor-pointer mb-2">
        <ChevronDown size={14} className="text-muted-foreground group-data-[state=closed]:rotate-[-90deg] transition-transform" />
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
      </CollapsibleTrigger>
      <CollapsibleContent className="pl-5 pb-4 text-sm text-muted-foreground leading-relaxed space-y-2">
        {children}
      </CollapsibleContent>
    </Collapsible>
  );
}

export function DocHero({ title, description, subtitle, badges, children, icon }: { title: string; description?: string; subtitle?: string; badges?: string[]; children?: ReactNode; icon?: LucideIcon }) {
  const desc = description || subtitle || '';
  return (
    <div className="bg-gradient-to-br from-primary/10 to-accent/10 rounded-2xl p-5 mb-4">
      <div className="flex items-center gap-3 mb-1">
        {icon && (() => { const Icon = icon; return <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center"><Icon className="text-primary" size={22} /></div>; })()}
        <h2 className="text-lg font-bold text-foreground">{title}</h2>
      </div>
      <p className="text-xs text-muted-foreground leading-relaxed">{desc}</p>
      {badges && (
        <div className="flex flex-wrap gap-2 mt-3">
          {badges.map((b) => (
            <span key={b} className="text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground">{b}</span>
          ))}
        </div>
      )}
      {children}
    </div>
  );
}

export function DocFlowStep({ number, title, desc }: { number: number; title: string; desc: string }) {
  return (
    <div className="flex gap-3 items-start">
      <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center shrink-0 text-xs font-bold text-primary">{number}</div>
      <div>
        <p className="text-xs font-semibold text-foreground">{title}</p>
        <p className="text-[11px] text-muted-foreground">{desc}</p>
      </div>
    </div>
  );
}

const cardStyles = {
  info: { icon: Info, color: 'text-blue-600' },
  tip: { icon: Lightbulb, color: 'text-amber-600' },
  warning: { icon: AlertTriangle, color: 'text-destructive' },
  success: { icon: CheckCircle2, color: 'text-green-600' },
};

export function DocInfoCard({ title, icon, variant, children }: { title: string; icon?: string; variant?: 'info' | 'tip' | 'warning' | 'success'; children: ReactNode }) {
  return (
    <div className="p-3 bg-card border border-border rounded-xl mt-2 mb-2">
      <p className="text-xs font-semibold text-foreground mb-2">{icon ? `${icon} ` : ''}{title}</p>
      <div className="text-[11px] text-muted-foreground space-y-1">{children}</div>
    </div>
  );
}

export function DocTable({ headers, rows }: { headers: string[]; rows: string[][] }) {
  return (
    <div className="overflow-x-auto mt-2">
      <table className="w-full text-xs border border-border rounded-lg overflow-hidden">
        <thead>
          <tr className="bg-muted/50">
            {headers.map((h, i) => (
              <th key={i} className="text-left px-3 py-2 font-semibold">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((row, i) => (
            <tr key={i}>
              {row.map((cell, j) => (
                <td key={j} className="px-3 py-2">{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function DocBadge({ type }: { type: string }) {
  const colors: Record<string, string> = {
    buyer: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300',
    seller: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300',
    admin: 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300',
    all: 'bg-muted text-muted-foreground',
    delivery: 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300',
  };
  return (
    <span className={cn('text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded-full', colors[type] || colors.all)}>
      {type}
    </span>
  );
}

// Legacy exports for backward compatibility
export function DocSubSection({ title, children }: { title: string; children: ReactNode }) {
  return <DocSection title={title}>{children}</DocSection>;
}

export function DocStep({ number, title, children }: { number: number; title: string; children: ReactNode }) {
  return (
    <div className="flex gap-3 mb-4">
      <div className="w-7 h-7 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-xs font-bold shrink-0 mt-0.5">
        {number}
      </div>
      <div className="flex-1">
        <p className="font-semibold text-foreground mb-1">{title}</p>
        <div className="text-sm text-foreground/80 leading-relaxed">{children}</div>
      </div>
    </div>
  );
}

export function DocList({ items }: { items: string[] }) {
  return (
    <ul className="space-y-1.5 ml-1">
      {items.map((item, i) => (
        <li key={i} className="flex gap-2 text-sm">
          <span className="text-primary mt-1.5 shrink-0">•</span>
          <span className="text-foreground/80">{item}</span>
        </li>
      ))}
    </ul>
  );
}