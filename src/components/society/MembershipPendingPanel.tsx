import { Clock, ShieldCheck, Sparkles } from 'lucide-react';

interface MembershipPendingPanelProps {
  title?: string;
  description?: string;
}

export function MembershipPendingPanel({
  title = 'Your community access is pending',
  description = 'A society admin needs to approve your join request before visitor, gate, and resident tools unlock. Marketplace browsing stays open in the meantime.',
}: MembershipPendingPanelProps) {
  return (
    <div className="relative overflow-hidden rounded-[1.75rem] border border-primary/15 bg-gradient-to-br from-primary/12 via-background to-secondary p-6 text-center shadow-card">
      <div className="pointer-events-none absolute -right-10 -top-10 h-36 w-36 rounded-full bg-primary/15 blur-2xl" />
      <div className="pointer-events-none absolute -bottom-12 -left-8 h-32 w-32 rounded-full bg-primary/10 blur-2xl" />
      <div className="relative mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-primary to-primary/70 text-primary-foreground shadow-lg shadow-primary/25">
        <ShieldCheck size={28} />
      </div>
      <p className="relative text-[11px] font-semibold uppercase tracking-[0.18em] text-primary">Awaiting approval</p>
      <h2 className="relative mt-2 text-xl font-bold tracking-tight">{title}</h2>
      <p className="relative mx-auto mt-2 max-w-sm text-sm leading-relaxed text-muted-foreground">
        {description}
      </p>
      <div className="relative mt-5 flex items-center justify-center gap-4 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-background/80 px-3 py-1.5">
          <Clock size={12} className="text-primary" /> Usually same day
        </span>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-background/80 px-3 py-1.5">
          <Sparkles size={12} className="text-primary" /> You will get a ping
        </span>
      </div>
    </div>
  );
}
