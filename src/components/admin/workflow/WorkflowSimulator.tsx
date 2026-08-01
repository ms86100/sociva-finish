// @ts-nocheck
import { useState, useEffect, useMemo } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from 'sonner';
import {
  Play, RotateCcw, ArrowRight, CheckCircle2, CircleDot, Circle,
  AlertTriangle, User, Store, Truck, Bot, ShieldCheck, XCircle,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { type FlowStep, type Transition, type WorkflowGroup, ACTORS, TRANSACTION_TYPES, formatName } from './types';

const ACTOR_ICONS: Record<string, React.ReactNode> = {
  buyer: <User size={12} />,
  seller: <Store size={12} />,
  delivery: <Truck size={12} />,
  system: <Bot size={12} />,
  admin: <ShieldCheck size={12} />,
};

const ACTOR_COLORS: Record<string, string> = {
  buyer: 'bg-blue-100 text-blue-700 border-blue-200',
  seller: 'bg-amber-100 text-amber-700 border-amber-200',
  delivery: 'bg-purple-100 text-purple-700 border-purple-200',
  system: 'bg-gray-100 text-gray-700 border-gray-200',
  admin: 'bg-red-100 text-red-700 border-red-200',
};

interface SimLogEntry {
  from: string;
  to: string;
  actor: string;
  step: number;
}

export function WorkflowSimulator() {
  const [workflows, setWorkflows] = useState<WorkflowGroup[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedKey, setSelectedKey] = useState('');
  const [steps, setSteps] = useState<FlowStep[]>([]);
  const [transitions, setTransitions] = useState<Transition[]>([]);
  const [currentStatus, setCurrentStatus] = useState('');
  const [simLog, setSimLog] = useState<SimLogEntry[]>([]);
  const [simActor, setSimActor] = useState('seller');
  const [isTerminal, setIsTerminal] = useState(false);
  const [hasError, setHasError] = useState('');

  useEffect(() => {
    loadWorkflows();
  }, []);

  const loadWorkflows = async () => {
    setIsLoading(true);
    const { data, error } = await supabase
      .from('category_status_flows')
      .select('parent_group, transaction_type, status_key, sort_order, actor, is_terminal, display_label, color, icon, buyer_hint, seller_hint, id, notify_buyer, notification_title, notification_body, notification_action, is_transit, requires_otp, is_success, creates_tracking_assignment')
      .order('parent_group')
      .order('transaction_type')
      .order('sort_order', { ascending: true });

    if (error) { toast.error('Failed to load workflows'); setIsLoading(false); return; }

    const groupMap = new Map<string, WorkflowGroup>();
    for (const row of (data || [])) {
      const key = `${row.parent_group}::${row.transaction_type}`;
      if (!groupMap.has(key)) {
        groupMap.set(key, { parent_group: row.parent_group, transaction_type: row.transaction_type, steps: [], step_count: 0 });
      }
      const group = groupMap.get(key)!;
      group.steps.push({ ...row, seller_hint: (row as any).seller_hint || '', notify_buyer: (row as any).notify_buyer || false, notification_title: (row as any).notification_title || '', notification_body: (row as any).notification_body || '', notification_action: (row as any).notification_action || '', notify_seller: (row as any).notify_seller || false, seller_notification_title: (row as any).seller_notification_title || '', seller_notification_body: (row as any).seller_notification_body || '', is_transit: !!(row as any).is_transit, requires_otp: !!(row as any).requires_otp, is_success: !!(row as any).is_success, creates_tracking_assignment: !!(row as any).creates_tracking_assignment, otp_type: (row as any).otp_type || null } as FlowStep);
      group.step_count++;
    }

    setWorkflows(Array.from(groupMap.values()));
    setIsLoading(false);
  };

  const selectWorkflow = async (key: string) => {
    setSelectedKey(key);
    setSimLog([]);
    setHasError('');
    setIsTerminal(false);

    const [parentGroup, transactionType] = key.split('::');
    const wf = workflows.find(w => w.parent_group === parentGroup && w.transaction_type === transactionType);
    if (!wf) return;

    setSteps(wf.steps);

    const { data } = await supabase
      .from('category_status_transitions')
      .select('from_status, to_status, allowed_actor')
      .eq('parent_group', parentGroup)
      .eq('transaction_type', transactionType);

    setTransitions((data || []) as Transition[]);

    // Start at the first step
    const firstStep = wf.steps[0];
    if (firstStep) {
      setCurrentStatus(firstStep.status_key);
      setIsTerminal(!!firstStep.is_terminal);
    }
  };

  const availableTransitions = useMemo(() => {
    if (!currentStatus || isTerminal) return [];
    return transitions.filter(t => t.from_status === currentStatus);
  }, [currentStatus, transitions, isTerminal]);

  const nextStatusesForActor = useMemo(() => {
    const forActor = availableTransitions.filter(t => t.allowed_actor === simActor);
    const uniqueStatuses = [...new Set(forActor.map(t => t.to_status))];
    return uniqueStatuses.map(status => {
      const step = steps.find(s => s.status_key === status);
      return { status, step };
    });
  }, [availableTransitions, simActor, steps]);

  const allNextStatuses = useMemo(() => {
    const uniqueStatuses = [...new Set(availableTransitions.map(t => t.to_status))];
    return uniqueStatuses.map(status => ({
      status,
      step: steps.find(s => s.status_key === status),
      actors: availableTransitions.filter(t => t.to_status === status).map(t => t.allowed_actor),
    }));
  }, [availableTransitions, steps]);

  const performTransition = (toStatus: string) => {
    const targetStep = steps.find(s => s.status_key === toStatus);
    setSimLog(prev => [...prev, {
      from: currentStatus,
      to: toStatus,
      actor: simActor,
      step: prev.length + 1,
    }]);
    setCurrentStatus(toStatus);
    setIsTerminal(!!targetStep?.is_terminal);
    setHasError('');
  };

  const tryInvalidTransition = () => {
    setHasError(`❌ Actor "${simActor}" cannot transition from "${currentStatus}" — no valid transitions found. The DB trigger would raise: "Invalid status transition".`);
  };

  const resetSimulation = () => {
    setSimLog([]);
    setHasError('');
    setIsTerminal(false);
    if (steps.length > 0) {
      setCurrentStatus(steps[0].status_key);
      setIsTerminal(!!steps[0].is_terminal);
    }
  };

  const currentStep = steps.find(s => s.status_key === currentStatus);

  if (isLoading) {
    return <div className="space-y-3">{[1, 2, 3].map(i => <Skeleton key={i} className="h-16 rounded-2xl" />)}</div>;
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-bold">Workflow Simulator</h2>
        <p className="text-xs text-muted-foreground mt-0.5">
          Test workflows by simulating order status transitions as different actors — without affecting real data
        </p>
      </div>

      {/* Workflow Selector */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="text-xs font-semibold text-muted-foreground mb-1.5 block">Workflow</label>
          <Select value={selectedKey} onValueChange={selectWorkflow}>
            <SelectTrigger className="h-9 rounded-lg text-sm">
              <SelectValue placeholder="Select a workflow to simulate..." />
            </SelectTrigger>
            <SelectContent>
              {workflows.map(wf => {
                const key = `${wf.parent_group}::${wf.transaction_type}`;
                return (
                  <SelectItem key={key} value={key}>
                    {formatName(wf.parent_group)} — {formatName(wf.transaction_type)} ({wf.step_count} steps)
                  </SelectItem>
                );
              })}
            </SelectContent>
          </Select>
        </div>

        <div>
          <label className="text-xs font-semibold text-muted-foreground mb-1.5 block">Acting As</label>
          <Select value={simActor} onValueChange={setSimActor}>
            <SelectTrigger className="h-9 rounded-lg text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ACTORS.map(a => (
                <SelectItem key={a} value={a}>
                  <span className="flex items-center gap-1.5">{ACTOR_ICONS[a]} {formatName(a)}</span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {selectedKey && steps.length > 0 && (
        <>
          {/* Pipeline Visualization */}
          <div className="bg-muted/30 rounded-2xl p-4 border border-border/50">
            <div className="flex items-center justify-between mb-3">
              <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Status Pipeline</p>
              <Button size="sm" variant="outline" onClick={resetSimulation} className="h-7 text-xs rounded-lg">
                <RotateCcw size={12} className="mr-1" /> Reset
              </Button>
            </div>

            <div className="flex items-center gap-1 flex-wrap">
              {steps.map((step, idx) => {
                const isCurrent = step.status_key === currentStatus;
                const wasVisited = simLog.some(l => l.to === step.status_key || (idx === 0 && simLog.length === 0));
                const isPast = simLog.some(l => l.from === step.status_key);

                return (
                  <div key={step.status_key} className="flex items-center gap-1">
                    <div className={cn(
                      "flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs font-medium transition-all",
                      isCurrent
                        ? "bg-primary text-primary-foreground border-primary shadow-sm ring-2 ring-primary/20"
                        : isPast
                          ? "bg-muted/60 text-muted-foreground border-border/50 line-through opacity-60"
                          : "bg-background text-foreground border-border/50"
                    )}>
                      {isCurrent ? <CircleDot size={12} /> : isPast ? <CheckCircle2 size={12} /> : <Circle size={12} />}
                      {step.display_label || step.status_key}
                      {step.is_terminal && <span className="text-[9px] opacity-70">⏹</span>}
                    </div>
                    {idx < steps.length - 1 && <ArrowRight size={12} className="text-muted-foreground/40 shrink-0" />}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Current Status Detail */}
          <Card className="border-0 shadow-[var(--shadow-card)] rounded-2xl">
            <CardContent className="p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs text-muted-foreground font-medium">Current Status</p>
                  <p className="text-lg font-bold">{currentStep?.display_label || currentStatus}</p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="text-[10px] font-mono">{currentStatus}</Badge>
                  {isTerminal && (
                    <Badge className="bg-green-100 text-green-700 border-green-200 text-[10px]">Terminal</Badge>
                  )}
                </div>
              </div>

              {currentStep && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <div className="bg-blue-50 rounded-lg p-2.5 border border-blue-100">
                    <p className="text-[10px] font-semibold text-blue-600 mb-0.5 flex items-center gap-1"><User size={10} /> Buyer sees</p>
                    <p className="text-xs text-blue-800">{currentStep.buyer_hint || '—'}</p>
                  </div>
                  <div className="bg-amber-50 rounded-lg p-2.5 border border-amber-100">
                    <p className="text-[10px] font-semibold text-amber-600 mb-0.5 flex items-center gap-1"><Store size={10} /> Seller sees</p>
                    <p className="text-xs text-amber-800">{currentStep.seller_hint || '—'}</p>
                  </div>
                </div>
              )}

              {/* Actor ownership */}
              <div className="flex items-center gap-2">
                <p className="text-[10px] text-muted-foreground font-medium">Owned by:</p>
                <Badge className={cn("text-[10px] border", ACTOR_COLORS[currentStep?.actor || 'system'])}>
                  <span className="mr-1">{ACTOR_ICONS[currentStep?.actor || 'system']}</span>
                  {formatName(currentStep?.actor || 'system')}
                </Badge>
              </div>
            </CardContent>
          </Card>

          {/* Available Transitions */}
          {!isTerminal && (
            <div className="space-y-2">
              <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
                Available Transitions (as {formatName(simActor)})
              </p>

              {nextStatusesForActor.length > 0 ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {nextStatusesForActor.map(({ status, step }) => (
                    <button
                      key={status}
                      onClick={() => performTransition(status)}
                      className="flex items-center gap-3 p-3 rounded-xl border border-border/50 bg-background hover:bg-primary/5 hover:border-primary/30 transition-all text-left group"
                    >
                      <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center group-hover:bg-primary/20 transition-colors">
                        <ArrowRight size={14} className="text-primary" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold">{step?.display_label || status}</p>
                        <p className="text-[10px] text-muted-foreground font-mono">{status}</p>
                      </div>
                      {step?.is_terminal && (
                        <Badge className="bg-green-100 text-green-700 border-green-200 text-[9px]">Terminal</Badge>
                      )}
                    </button>
                  ))}
                </div>
              ) : (
                <div className="bg-destructive/5 border border-destructive/20 rounded-xl p-3 space-y-2">
                  <div className="flex items-center gap-2">
                    <AlertTriangle size={14} className="text-destructive" />
                    <p className="text-xs font-semibold text-destructive">
                      No transitions available for "{formatName(simActor)}" from "{currentStatus}"
                    </p>
                  </div>
                  {currentStep?.actor?.split(',').map(a => a.trim()).includes(simActor) ? (
                    <p className="text-[11px] text-amber-600 font-medium">
                      ⚠️ The step's actor field includes "{simActor}", but no transition rule exists in the Transitions tab. 
                      Add a transition from "{currentStatus}" for actor "{simActor}" to fix this.
                    </p>
                  ) : (
                    <p className="text-[11px] text-muted-foreground">
                      This actor cannot move the order forward from this status. Try switching to another actor.
                    </p>
                  )}
                  <Button size="sm" variant="outline" onClick={tryInvalidTransition} className="h-7 text-xs rounded-lg text-destructive border-destructive/30 hover:bg-destructive/10">
                    <XCircle size={12} className="mr-1" /> Simulate Invalid Attempt
                  </Button>
                </div>
              )}

              {/* Show all possible transitions from other actors */}
              {nextStatusesForActor.length === 0 && allNextStatuses.length > 0 && (
                <div className="mt-2 space-y-1.5">
                  <p className="text-[10px] text-muted-foreground font-medium">Other actors can transition to:</p>
                  {allNextStatuses.map(({ status, step, actors }) => (
                    <div key={status} className="flex items-center gap-2 px-2 py-1.5 rounded-lg bg-muted/30">
                      <span className="text-xs font-mono text-muted-foreground">{step?.display_label || status}</span>
                      <div className="flex gap-1">
                        {actors.map(a => (
                          <Badge key={a} className={cn("text-[9px] border px-1", ACTOR_COLORS[a])}>
                            {ACTOR_ICONS[a]}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {isTerminal && (
            <div className="bg-green-50 border border-green-200 rounded-xl p-4 text-center space-y-2">
              <CheckCircle2 size={24} className="text-green-600 mx-auto" />
              <p className="text-sm font-semibold text-green-800">Simulation Complete</p>
              <p className="text-xs text-green-600">
                Reached terminal status "{currentStep?.display_label}" in {simLog.length} transition{simLog.length !== 1 ? 's' : ''}
              </p>
              <Button size="sm" variant="outline" onClick={resetSimulation} className="h-8 text-xs rounded-lg mt-2">
                <RotateCcw size={12} className="mr-1" /> Run Again
              </Button>
            </div>
          )}

          {/* Error Display */}
          {hasError && (
            <div className="bg-destructive/10 border border-destructive/20 rounded-xl p-3">
              <p className="text-xs font-mono text-destructive">{hasError}</p>
            </div>
          )}

          {/* Transition Log */}
          {simLog.length > 0 && (
            <div>
              <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground mb-2">Transition Log</p>
              <ScrollArea className="max-h-48">
                <div className="space-y-1">
                  {simLog.map((entry, idx) => {
                    const toStep = steps.find(s => s.status_key === entry.to);
                    return (
                      <div key={idx} className="flex items-center gap-2 px-2 py-1.5 rounded-lg bg-muted/30 text-xs">
                        <span className="text-muted-foreground font-mono w-5 shrink-0">#{entry.step}</span>
                        <Badge variant="outline" className="text-[9px] font-mono">{entry.from}</Badge>
                        <ArrowRight size={10} className="text-muted-foreground shrink-0" />
                        <Badge variant="outline" className="text-[9px] font-mono">{entry.to}</Badge>
                        <Badge className={cn("text-[9px] border ml-auto", ACTOR_COLORS[entry.actor])}>
                          {ACTOR_ICONS[entry.actor]}
                          <span className="ml-0.5">{entry.actor}</span>
                        </Badge>
                      </div>
                    );
                  })}
                </div>
              </ScrollArea>
            </div>
          )}
        </>
      )}
    </div>
  );
}
