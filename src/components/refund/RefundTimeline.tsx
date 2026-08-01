// @ts-nocheck
import { CheckCircle2, Circle, Clock, XCircle } from 'lucide-react';
import { format } from 'date-fns';

interface AuditEntry {
  id: string;
  action: string;
  before_state: string | null;
  after_state: string | null;
  created_at: string;
  metadata?: any;
}

interface RefundTimelineProps {
  currentState: string;
  auditLog: AuditEntry[];
}

const STEPS: { key: string; label: string; matchActions: string[] }[] = [
  { key: 'requested', label: 'Requested', matchActions: ['request'] },
  { key: 'approved', label: 'Approved', matchActions: ['approve'] },
  { key: 'refund_initiated', label: 'Initiated', matchActions: ['initiate'] },
  { key: 'refund_completed', label: 'Completed', matchActions: ['complete'] },
];

const STATE_ORDER = ['requested', 'approved', 'refund_initiated', 'refund_processing', 'refund_completed'];

export function RefundTimeline({ currentState, auditLog }: RefundTimelineProps) {
  if (currentState === 'rejected') {
    const rejectEntry = auditLog.find((a) => a.action === 'reject');
    return (
      <div className="flex items-center gap-2 px-3 py-2 bg-destructive/5 rounded-lg">
        <XCircle size={14} className="text-destructive" />
        <div className="flex-1">
          <p className="text-xs font-medium text-destructive">Rejected</p>
          {rejectEntry && (
            <p className="text-[10px] text-muted-foreground">
              {format(new Date(rejectEntry.created_at), 'MMM d, h:mm a')}
            </p>
          )}
        </div>
      </div>
    );
  }

  if (currentState === 'refund_failed') {
    return (
      <div className="flex items-center gap-2 px-3 py-2 bg-destructive/5 rounded-lg">
        <XCircle size={14} className="text-destructive" />
        <p className="text-xs font-medium text-destructive">Refund failed — support will reach out</p>
      </div>
    );
  }

  const currentIdx = STATE_ORDER.indexOf(currentState);

  return (
    <div className="space-y-1.5">
      {STEPS.map((step, idx) => {
        const stepIdx = STATE_ORDER.indexOf(step.key);
        const reached = currentIdx >= stepIdx;
        const isCurrent = currentState === step.key || (step.key === 'refund_initiated' && currentState === 'refund_processing');
        const entry = auditLog.find((a) => step.matchActions.includes(a.action));

        return (
          <div key={step.key} className="flex items-center gap-2">
            {reached ? (
              isCurrent && step.key !== 'refund_completed' ? (
                <Clock size={14} className="text-primary animate-pulse shrink-0" />
              ) : (
                <CheckCircle2 size={14} className="text-success shrink-0" />
              )
            ) : (
              <Circle size={14} className="text-muted-foreground/40 shrink-0" />
            )}
            <div className="flex-1 flex items-center justify-between">
              <span className={`text-xs ${reached ? 'font-medium' : 'text-muted-foreground'}`}>
                {step.label}
              </span>
              {entry && (
                <span className="text-[10px] text-muted-foreground">
                  {format(new Date(entry.created_at), 'MMM d, h:mm a')}
                </span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
