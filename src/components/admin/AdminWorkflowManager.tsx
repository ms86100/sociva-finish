// @ts-nocheck
import { useState, useEffect } from 'react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { WorkflowFlowDiagram } from './workflow/WorkflowFlowDiagram';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from '@/components/ui/drawer';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { toast } from 'sonner';
import {
  GitBranch, Plus, Trash2, Save, ChevronRight,
  ArrowRight, Copy, HelpCircle, AlertTriangle,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { type FlowStep, type Transition, type WorkflowGroup, ACTORS, TRANSACTION_TYPES, formatName } from './workflow/types';
import { CreateWorkflowDialog } from './workflow/CreateWorkflowDialog';
import { TransitionRulesEditor } from './workflow/TransitionRulesEditor';
import { CloneWorkflowDialog } from './workflow/CloneWorkflowDialog';
import { DeleteWorkflowDialog } from './workflow/DeleteWorkflowDialog';
import { WorkflowLinkage } from './workflow/WorkflowLinkage';

/** Inline label with tooltip helper */
function FieldLabel({ label, tooltip, className }: { label: string; tooltip: string; className?: string }) {
  return (
    <div className={cn("flex items-center gap-1 mb-0.5", className)}>
      <span className="text-[10px] font-medium text-muted-foreground">{label}</span>
      <Tooltip>
        <TooltipTrigger asChild>
          <HelpCircle size={11} className="text-muted-foreground/50 cursor-help shrink-0" />
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-[220px] text-xs">
          {tooltip}
        </TooltipContent>
      </Tooltip>
    </div>
  );
}

/** Predefined badge color options */
const BADGE_COLORS = [
  { label: 'Blue', value: 'bg-blue-100 text-blue-700', preview: 'bg-blue-500' },
  { label: 'Green', value: 'bg-green-100 text-green-700', preview: 'bg-green-500' },
  { label: 'Yellow', value: 'bg-yellow-100 text-yellow-700', preview: 'bg-yellow-500' },
  { label: 'Orange', value: 'bg-orange-100 text-orange-700', preview: 'bg-orange-500' },
  { label: 'Red', value: 'bg-red-100 text-red-700', preview: 'bg-red-500' },
  { label: 'Purple', value: 'bg-purple-100 text-purple-700', preview: 'bg-purple-500' },
  { label: 'Pink', value: 'bg-pink-100 text-pink-700', preview: 'bg-pink-500' },
  { label: 'Gray', value: 'bg-gray-100 text-gray-600', preview: 'bg-gray-500' },
  { label: 'Teal', value: 'bg-teal-100 text-teal-700', preview: 'bg-teal-500' },
];

export function AdminWorkflowManager() {
  const [workflows, setWorkflows] = useState<WorkflowGroup[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedWorkflow, setSelectedWorkflow] = useState<WorkflowGroup | null>(null);
  const [editSteps, setEditSteps] = useState<FlowStep[]>([]);
  const [transitions, setTransitions] = useState<Transition[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [workflowUsage, setWorkflowUsage] = useState<Record<string, number>>({});

  // Dialog states
  const [showCreate, setShowCreate] = useState(false);
  const [cloneSource, setCloneSource] = useState<WorkflowGroup | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<WorkflowGroup | null>(null);

  useEffect(() => { loadWorkflows(); loadUsageCounts(); }, []);

  const loadWorkflows = async () => {
    setIsLoading(true);
    const { data, error } = await supabase
      .from('category_status_flows')
      .select('parent_group, transaction_type, status_key, sort_order, actor, is_terminal, display_name, id, is_deprecated, is_transit, creates_tracking_assignment, statuses, starts_live_activity, notification_image_url')
      .order('parent_group')
      .order('transaction_type')
      .order('sort_order', { ascending: true });

    if (error) {
      toast.error('Failed to load workflows');
      setIsLoading(false);
      return;
    }

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

  const loadUsageCounts = async () => {
    try {
      const { data } = await supabase
        .from('orders')
        .select('transaction_type')
        .not('transaction_type', 'is', null);
      if (data) {
        const counts: Record<string, number> = {};
        for (const row of data) {
          const key = row.transaction_type as string;
          counts[key] = (counts[key] || 0) + 1;
        }
        setWorkflowUsage(counts);
      }
    } catch (e) {
      console.warn('Failed to load workflow usage counts:', e);
    }
  };

  const openEditor = async (wf: WorkflowGroup) => {
    setSelectedWorkflow(wf);
    setEditSteps(wf.steps.map(s => ({ ...s })));
    const { data } = await supabase
      .from('category_status_transitions')
      .select('from_status, to_status, allowed_actor, is_side_action')
      .eq('parent_group', wf.parent_group)
      .eq('transaction_type', wf.transaction_type);
    setTransitions((data || []) as Transition[]);
  };

  const addStep = () => {
    const maxOrder = editSteps.length > 0 ? Math.max(...editSteps.map(s => s.sort_order)) : 0;
    setEditSteps([...editSteps, {
      status_key: '', sort_order: maxOrder + 10, actor: 'seller', is_terminal: false,
      display_name: '', color: 'bg-gray-100 text-gray-600', icon: 'Circle', buyer_hint: '', seller_hint: '',
      notify_buyer: false, notification_title: '', notification_body: '', notification_action: '',
      notify_seller: false, seller_notification_title: '', seller_notification_body: '',
      is_transit: false, requires_otp: false, otp_type: null, is_success: false, creates_tracking_assignment: false,
    }]);
  };

  const removeStep = (index: number) => {
    const step = editSteps[index];
    setEditSteps(editSteps.filter((_, i) => i !== index));
    setTransitions(transitions.filter(t => t.from_status !== step.status_key && t.to_status !== step.status_key));
  };

  const updateStep = (index: number, field: keyof FlowStep, value: any) => {
    const updated = [...editSteps];
    (updated[index] as any)[field] = value;
    setEditSteps(updated);
  };

  const moveStep = (index: number, direction: 'up' | 'down') => {
    if (direction === 'up' && index === 0) return;
    if (direction === 'down' && index === editSteps.length - 1) return;
    const swapIdx = direction === 'up' ? index - 1 : index + 1;
    const updated = [...editSteps];
    const tmpOrder = updated[index].sort_order;
    updated[index].sort_order = updated[swapIdx].sort_order;
    updated[swapIdx].sort_order = tmpOrder;
    [updated[index], updated[swapIdx]] = [updated[swapIdx], updated[index]];
    setEditSteps(updated);
  };

  const hasTransition = (from: string, to: string, actor: string) =>
    transitions.some(t => t.from_status === from && t.to_status === to && t.allowed_actor === actor);

  const toggleTransition = (from: string, to: string, actor: string) => {
    if (hasTransition(from, to, actor)) {
      setTransitions(transitions.filter(t => !(t.from_status === from && t.to_status === to && t.allowed_actor === actor)));
    } else {
      setTransitions([...transitions, { from_status: from, to_status: to, allowed_actor: actor }]);
    }
  };

  const saveWorkflow = async () => {
    if (!selectedWorkflow) return;

    const emptyKeys = editSteps.filter(s => !s.status_key.trim());
    if (emptyKeys.length > 0) { toast.error('All steps must have a status key'); return; }

    const keys = editSteps.map(s => s.status_key.trim().toLowerCase());
    const dupes = keys.filter((k, i) => keys.indexOf(k) !== i);
    if (dupes.length > 0) { toast.error(`Duplicate status key: "${dupes[0]}"`); return; }

    if (!editSteps.some(s => s.is_terminal)) { toast.error('Workflow must have at least one terminal status'); return; }

    const nonTerminalKeys = new Set(editSteps.filter(s => !s.is_terminal).map(s => s.status_key));
    const fromKeys = new Set(transitions.map(t => t.from_status));
    const orphaned = [...nonTerminalKeys].filter(k => !fromKeys.has(k));
    if (orphaned.length > 0) toast.warning(`Warning: "${orphaned.join('", "')}" have no outgoing transitions`);

    const stepOrderMap = new Map(editSteps.map(s => [s.status_key, s.sort_order]));
    const backwardTransitions = transitions.filter(t => {
      const fromOrder = stepOrderMap.get(t.from_status);
      const toOrder = stepOrderMap.get(t.to_status);
      return fromOrder !== undefined && toOrder !== undefined && toOrder < fromOrder;
    });
    if (backwardTransitions.length > 0) {
      toast.warning(`Backward transition detected: ${backwardTransitions.map(t => `${t.from_status} → ${t.to_status}`).join(', ')}`);
    }

    // Self-pickup validation: auto-clear transit/tracking flags that are ignored by DB triggers
    const isSelfPickupWorkflow = selectedWorkflow.transaction_type.includes('self_fulfillment') || selectedWorkflow.transaction_type.includes('self_pickup');
    if (isSelfPickupWorkflow) {
      const flaggedSteps = editSteps.filter(s => s.is_transit || s.creates_tracking_assignment);
      if (flaggedSteps.length > 0) {
        toast.warning('Self-pickup workflows cannot use transit or tracking flags — auto-cleared before saving.');
        for (const s of editSteps) {
          s.is_transit = false;
          s.creates_tracking_assignment = false;
        }
        setEditSteps([...editSteps]);
      }
    }

    // Enforce single creates_tracking_assignment per workflow
    {
      const trackingSteps = editSteps.filter(s => s.creates_tracking_assignment);
      if (trackingSteps.length > 1) {
        toast.error('Only one step can have "Start Delivery Here" enabled. Please remove duplicates.');
        return;
      }
    }

    // Delivery OTP validation: otp_type='delivery' only valid AFTER a creates_tracking_assignment step
    {
      let trackingAssignmentSeen = false;
      let cleared = false;
      const sortedForValidation = [...editSteps].sort((a, b) => a.sort_order - b.sort_order);
      for (const s of sortedForValidation) {
        if (s.creates_tracking_assignment) trackingAssignmentSeen = true;
        if (s.otp_type === 'delivery' && !trackingAssignmentSeen) {
          toast.error(`Delivery OTP requires a delivery assignment. Step "${s.display_name || s.status_key}" comes before any tracking assignment step — cleared to 'None'. Review and save again.`, { duration: 8000 });
          s.otp_type = null;
          s.requires_otp = false;
          cleared = true;
        }
      }
      if (cleared) {
        setEditSteps([...editSteps]);
        return; // Stop save — keep editor open so admin can review the cleared values
      }
    }

    // Legacy mismatch normalization: requires_otp=true but otp_type=null
    // This fixes the split-brain where the old checkbox was checked but no otp_type was selected
    {
      let normalized = false;
      let trackingSeenForLegacy = false;
      const sortedForLegacy = [...editSteps].sort((a, b) => a.sort_order - b.sort_order);
      for (const s of sortedForLegacy) {
        if (s.creates_tracking_assignment) trackingSeenForLegacy = true;
        if (s.requires_otp && !s.otp_type) {
          if (trackingSeenForLegacy) {
            // Post-tracking step: safe to assume delivery OTP was intended
            s.otp_type = 'delivery';
            toast.info(`Step "${s.display_name || s.status_key}" had legacy OTP flag — auto-mapped to Delivery OTP.`);
          } else {
            // Pre-tracking step: delivery OTP cannot work here, clear the flag
            s.requires_otp = false;
            toast.warning(`Step "${s.display_name || s.status_key}" had legacy OTP flag but no delivery context — cleared.`);
          }
          normalized = true;
        }
      }
      if (normalized) {
        setEditSteps([...editSteps]);
      }
    }

    setIsSaving(true);
    try {
      const { parent_group, transaction_type } = selectedWorkflow;

      await supabase.from('category_status_flows').delete().eq('parent_group', parent_group).eq('transaction_type', transaction_type);

      const stepsToInsert = editSteps.map((s, i) => {
        return {
        parent_group, transaction_type, status_key: s.status_key, sort_order: (i + 1) * 10,
        actor: s.actor || 'system', is_terminal: s.is_terminal, display_name: s.display_name || s.status_key,
        color: s.color, icon: s.icon, buyer_hint: s.buyer_hint, seller_hint: s.seller_hint,
        notify_buyer: s.notify_buyer, notification_title: s.notification_title || null,
        notification_body: s.notification_body || null, notification_action: s.notification_action || null,
        notify_seller: s.notify_seller, seller_notification_title: s.seller_notification_title || null,
        seller_notification_body: s.seller_notification_body || null,
        is_transit: s.is_transit, requires_otp: s.otp_type !== null, otp_type: s.otp_type, is_success: s.is_success, creates_tracking_assignment: s.creates_tracking_assignment,
        buyer_display_name: (s as any).buyer_display_name || null, seller_display_name: (s as any).seller_display_name || null,
        };
      });
      const { error: insertError } = await supabase.from('category_status_flows').insert(stepsToInsert);
      if (insertError) throw insertError;

      await supabase.from('category_status_transitions').delete().eq('parent_group', parent_group).eq('transaction_type', transaction_type);

      // Auto-generate missing forward transitions from step actor fields
      const enrichedTransitions = [...transitions];
      const sortedSteps = [...editSteps].sort((a, b) => a.sort_order - b.sort_order);
      for (let i = 0; i < sortedSteps.length; i++) {
        const step = sortedSteps[i];
        if (step.is_terminal) continue;
        const nextStep = sortedSteps[i + 1];
        if (!nextStep) continue;
        const actors = (step.actor || 'system').split(',').map(a => a.trim()).filter(Boolean);
        for (const actor of actors) {
          const hasForward = enrichedTransitions.some(
            t => t.from_status === step.status_key && t.allowed_actor === actor && !t.is_side_action
          );
          if (!hasForward) {
            enrichedTransitions.push({
              from_status: step.status_key,
              to_status: nextStep.status_key,
              allowed_actor: actor,
              is_side_action: false,
            });
          }
        }
      }

      if (enrichedTransitions.length > 0) {
        // Deduplicate
        const seen = new Set<string>();
        const transToInsert = enrichedTransitions.filter(t => {
          const key = `${t.from_status}:${t.to_status}:${t.allowed_actor}`;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        }).map(t => ({
          parent_group, transaction_type, from_status: t.from_status, to_status: t.to_status, allowed_actor: t.allowed_actor,
          is_side_action: t.is_side_action || false,
        }));
        const { error: transError } = await supabase.from('category_status_transitions').insert(transToInsert);
        if (transError) throw transError;
      }

      // Sync transit_statuses system setting — scoped to delivery-related workflows only
      // to prevent pickup-only workflows from polluting transit status lists
      try {
        const DELIVERY_WORKFLOWS = ['cart_purchase', 'seller_delivery'];
        const { data: allFlows } = await supabase
          .from('category_status_flows')
          .select('status_key, is_transit, transaction_type')
          .eq('is_transit', true)
          .in('transaction_type', DELIVERY_WORKFLOWS);
        if (allFlows) {
          const transitKeys = [...new Set(allFlows.map(f => f.status_key))];
          const transitJson = JSON.stringify(transitKeys);
          // Upsert transit_statuses
          await supabase.from('system_settings').upsert(
            { key: 'transit_statuses', value: transitJson },
            { onConflict: 'key' }
          );
          // Also sync transit_statuses_la (used by Live Activities)
          await supabase.from('system_settings').upsert(
            { key: 'transit_statuses_la', value: transitJson },
            { onConflict: 'key' }
          );
        }
      } catch (syncErr) {
        console.warn('Failed to sync transit_statuses system setting:', syncErr);
      }

      toast.success('Workflow saved successfully');
      await loadWorkflows();
      setSelectedWorkflow(null);
    } catch (error: any) {
      toast.error(`Failed to save: ${error.message}`);
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return <div className="space-y-3">{[1, 2, 3].map(i => <Skeleton key={i} className="h-20 rounded-2xl" />)}</div>;
  }

  // Group workflows by transaction_type, with 'default' parent_group first
  const groupedByType = (() => {
    const map = new Map<string, WorkflowGroup[]>();
    for (const wf of workflows) {
      const list = map.get(wf.transaction_type) || [];
      list.push(wf);
      map.set(wf.transaction_type, list);
    }
    // Sort each group: 'default' first, rest alphabetically
    for (const [, list] of map) {
      list.sort((a, b) => {
        if (a.parent_group === 'default') return -1;
        if (b.parent_group === 'default') return 1;
        return a.parent_group.localeCompare(b.parent_group);
      });
    }
    return map;
  })();

  // Prefer DB-discovered types, then TRANSACTION_TYPES seed order
  const typeOrder = [
    ...TRANSACTION_TYPES.map(t => t.value),
    ...Array.from(groupedByType.keys()).filter(k => !TRANSACTION_TYPES.some(t => t.value === k)),
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold">Workflow Manager</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Order statuses for each buyer journey (accept → deliver, OTP, map flags). Categories link via buyer journey in Catalog.
          </p>
        </div>
        <Button size="sm" onClick={() => setShowCreate(true)} className="h-8 rounded-lg text-xs font-semibold">
          <Plus size={14} className="mr-1" /> New Workflow
        </Button>
      </div>
      <div className="rounded-xl border border-border/50 bg-muted/20 p-3 text-[11px] text-muted-foreground">
        Edit steps and who can advance them. OTP / live map turn on via step flags (<code className="text-[10px]">otp_type</code>, <code className="text-[10px]">is_transit</code>). Parent-group overrides replace the default graph for that aisle.
      </div>

      <div className="space-y-3">
        {typeOrder.map(txType => {
          const group = groupedByType.get(txType);
          if (!group || group.length === 0) return null;
          const defaultWf = group.find(g => g.parent_group === 'default') || group[0];
          const overrides = group.filter(g => g !== defaultWf);
          const activeStepCount = defaultWf.steps.filter(s => !(s as any).is_deprecated).length;
          const typeLabel = TRANSACTION_TYPES.find(t => t.value === txType)?.label || formatName(txType);

          return (
            <Card
              key={txType}
              className="border-0 shadow-[var(--shadow-card)] hover:shadow-[var(--shadow-md)] transition-all rounded-2xl"
            >
              <CardContent className="p-4 space-y-2.5">
                <div
                  className="flex items-center justify-between cursor-pointer"
                  onClick={() => openEditor(defaultWf)}
                >
                  <div className="flex items-center gap-3 flex-1 min-w-0">
                    <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
                      <GitBranch size={16} className="text-primary" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-bold">{typeLabel}</p>
                      <p className="text-xs text-muted-foreground">
                        {activeStepCount} steps (default)
                        {defaultWf.steps.some(s => (s as any).is_deprecated) && (
                          <span className="ml-1 text-amber-500">
                            ({defaultWf.steps.filter(s => (s as any).is_deprecated).length} deprecated)
                          </span>
                        )}
                      </p>
                      {(() => {
                        const usage = workflowUsage[txType] || 0;
                        return (
                          <p className={cn("text-[10px]", usage > 0 ? "text-accent" : "text-muted-foreground/60")}>
                            {usage > 0 ? `${usage} order${usage > 1 ? 's' : ''}` : '0 orders (unused)'}
                          </p>
                        );
                      })()}
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      onClick={(e) => { e.stopPropagation(); setCloneSource(defaultWf); }}
                      className="w-7 h-7 rounded-lg flex items-center justify-center text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors"
                      title="Clone workflow"
                    >
                      <Copy size={14} />
                    </button>
                    <ChevronRight size={16} className="text-muted-foreground" />
                  </div>
                </div>

                {overrides.length > 0 && (
                  <div className="pl-12 space-y-1.5">
                    <div className="flex items-center gap-1 text-[10px] text-amber-600 font-medium">
                      <AlertTriangle size={11} className="shrink-0" />
                      <span>{overrides.length} category override{overrides.length > 1 ? 's' : ''} — these take priority over default</span>
                    </div>
                    <div className="flex items-center gap-1.5 flex-wrap">
                      {overrides.map(ov => (
                        <Badge
                          key={ov.parent_group}
                          variant="outline"
                          className="text-[10px] px-2.5 py-1 cursor-pointer border-amber-300 bg-amber-50 text-amber-700 hover:bg-amber-100 hover:border-amber-400 transition-colors font-medium"
                          onClick={() => openEditor(ov)}
                        >
                          <AlertTriangle size={10} className="mr-1 shrink-0" />
                          Override: {formatName(ov.parent_group)} · {ov.steps.filter(s => !(s as any).is_deprecated).length} steps
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Editor Sheet */}
      <Drawer open={!!selectedWorkflow} onOpenChange={(open) => !open && setSelectedWorkflow(null)}>
        <DrawerContent className="max-h-[90dvh] p-0">
          <DrawerHeader className="px-4 pt-4 pb-3 border-b border-border">
            <div className="flex items-center justify-between">
              <DrawerTitle className="text-base font-bold">
                {selectedWorkflow && `${formatName(selectedWorkflow.parent_group)} — ${formatName(selectedWorkflow.transaction_type)}`}
              </DrawerTitle>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-xs text-destructive hover:text-destructive hover:bg-destructive/10 rounded-lg"
                onClick={() => { setDeleteTarget(selectedWorkflow); }}
              >
                <Trash2 size={12} className="mr-1" /> Delete
              </Button>
            </div>
            {selectedWorkflow && (
              <WorkflowLinkage parentGroup={selectedWorkflow.parent_group} transactionType={selectedWorkflow.transaction_type} />
            )}
            {selectedWorkflow?.parent_group === 'default' && (() => {
              const overridesForType = workflows.filter(
                w => w.transaction_type === selectedWorkflow.transaction_type && w.parent_group !== 'default'
              );
              if (overridesForType.length === 0) return null;
              return (
                <div className="mt-2 flex items-start gap-2 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2">
                  <AlertTriangle size={14} className="text-amber-600 shrink-0 mt-0.5" />
                  <p className="text-[11px] text-amber-700">
                    This default workflow has <strong>{overridesForType.length} category override{overridesForType.length > 1 ? 's' : ''}</strong>{' '}
                    ({overridesForType.map(o => formatName(o.parent_group)).join(', ')}).
                    Changes here <strong>won't affect</strong> those overridden categories.
                  </p>
                </div>
              );
            })()}
          </DrawerHeader>

          <ScrollArea className="h-[calc(90dvh-120px)]">
            <div className="px-4 py-4 space-y-5">
              {/* Transition Flow Diagram */}
              {editSteps.length > 0 && transitions.length > 0 && (
                <Collapsible defaultOpen>
                  <CollapsibleTrigger className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-muted-foreground cursor-pointer hover:text-foreground transition-colors mb-2">
                    <ChevronRight size={12} className="transition-transform data-[state=open]:rotate-90" />
                    Transition Flow
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <div className="bg-muted/30 rounded-xl border border-border/50 p-3 overflow-x-auto">
                      <WorkflowFlowDiagram steps={editSteps} transitions={transitions} />
                    </div>
                  </CollapsibleContent>
                </Collapsible>
              )}

               {/* Status Steps */}
              <div>
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Status Pipeline</p>
                    <p className="text-[10px] text-muted-foreground mt-0.5">Each step represents a stage in the order lifecycle. Drag to reorder.</p>
                  </div>
                  <Button size="sm" variant="outline" onClick={addStep} className="h-7 text-xs rounded-lg">
                    <Plus size={12} className="mr-1" /> Add Step
                  </Button>
                </div>

                <div className="space-y-2">
                  {editSteps.map((step, index) => (
                    <div key={index} className={cn("bg-muted/40 rounded-xl p-3 space-y-3 border border-border/50", (step as any).is_deprecated && "opacity-60 border-amber-300/50 bg-amber-50/30 dark:bg-amber-900/10")}>
                      {/* Row 1: Order + Status Key + Delete */}
                      <div className="flex items-center gap-2">
                        <div className="flex flex-col gap-0.5">
                          <button onClick={() => moveStep(index, 'up')} disabled={index === 0} className="text-muted-foreground hover:text-foreground disabled:opacity-30 text-xs">▲</button>
                          <button onClick={() => moveStep(index, 'down')} disabled={index === editSteps.length - 1} className="text-muted-foreground hover:text-foreground disabled:opacity-30 text-xs">▼</button>
                        </div>
                        <span className="text-[10px] font-mono text-muted-foreground w-5">{index + 1}</span>
                        <div className="flex-1">
                          <FieldLabel label="Status Key" tooltip="Unique identifier for this step (e.g. 'placed', 'accepted', 'picked_up'). Used internally — must be lowercase with underscores." />
                          <Input value={step.status_key} onChange={(e) => updateStep(index, 'status_key', e.target.value)} placeholder="e.g. picked_up" className="h-8 text-xs font-mono rounded-lg" />
                        </div>
                        {(step as any).is_deprecated && <Badge variant="outline" className="text-[9px] bg-amber-100 text-amber-700 border-amber-300 shrink-0">Deprecated</Badge>}
                        <button onClick={() => removeStep(index)} className="text-destructive hover:text-destructive/80 mt-4" title="Delete this step"><Trash2 size={14} /></button>
                      </div>

                      {/* Row 2: Display Label + Badge Color */}
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <FieldLabel label="Display Name" tooltip="The default label shown in the app (e.g. 'Picked Up', 'On the Way'). Can be overridden per role below." />
                          <Input value={step.display_name} onChange={(e) => updateStep(index, 'display_name', e.target.value)} placeholder="e.g. Picked Up" className="h-7 text-xs rounded-lg" />
                        </div>
                        <div>
                          <FieldLabel label="Badge Color" tooltip="The color scheme used for the status badge in the order timeline." />
                          <Select value={step.color} onValueChange={(v) => updateStep(index, 'color', v)}>
                            <SelectTrigger className="h-7 text-xs rounded-lg">
                              <div className="flex items-center gap-2">
                                {(() => {
                                  const match = BADGE_COLORS.find(c => c.value === step.color);
                                  return match ? (
                                    <><span className={cn("w-3 h-3 rounded-full shrink-0", match.preview)} /><span>{match.label}</span></>
                                  ) : (
                                    <span className="text-muted-foreground">{step.color || 'Select color'}</span>
                                  );
                                })()}
                              </div>
                            </SelectTrigger>
                            <SelectContent>
                              {BADGE_COLORS.map(c => (
                                <SelectItem key={c.value} value={c.value}>
                                  <div className="flex items-center gap-2">
                                    <span className={cn("w-3 h-3 rounded-full", c.preview)} />
                                    <span>{c.label}</span>
                                  </div>
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      </div>

                      {/* Row 2b: Role-specific label overrides */}
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <FieldLabel label="Buyer Label Override" tooltip="If set, buyers see this label instead of the Display Name (e.g. 'Ready for Pickup' instead of 'Ready'). Leave empty to use the default." />
                          <Input value={(step as any).buyer_display_name || ''} onChange={(e) => updateStep(index, 'buyer_display_name' as any, e.target.value || null)} placeholder="e.g. Ready for Pickup" className="h-7 text-xs rounded-lg" />
                        </div>
                        <div>
                          <FieldLabel label="Seller Label Override" tooltip="If set, sellers see this label instead of the Display Name (e.g. 'Handed Over' instead of 'Picked Up'). Leave empty to use the default." />
                          <Input value={(step as any).seller_display_name || ''} onChange={(e) => updateStep(index, 'seller_display_name' as any, e.target.value || null)} placeholder="e.g. Handed Over" className="h-7 text-xs rounded-lg" />
                        </div>
                      </div>

                      {/* Row 3: Icon + End State */}
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <FieldLabel label="Icon" tooltip="Icon shown next to this status in the timeline (e.g. 'Truck', 'ShoppingCart', 'CheckCircle'). Uses Lucide icon names." />
                          <Input value={step.icon} onChange={(e) => updateStep(index, 'icon', e.target.value)} placeholder="e.g. Truck" className="h-7 text-xs rounded-lg" />
                        </div>
                        <div className="flex items-end pb-1">
                          <div className="flex items-center gap-2">
                            <Checkbox checked={step.is_terminal} onCheckedChange={(v) => updateStep(index, 'is_terminal', !!v)} id={`terminal-${index}`} />
                            <label htmlFor={`terminal-${index}`} className="text-xs text-muted-foreground cursor-pointer">End State</label>
                            <Tooltip>
                              <TooltipTrigger asChild><HelpCircle size={11} className="text-muted-foreground/50 cursor-help" /></TooltipTrigger>
                              <TooltipContent side="top" className="max-w-[220px] text-xs">
                                Mark this as an end state if the order lifecycle stops here. Examples: "Completed", "Cancelled", "Refunded". No further transitions happen after this.
                              </TooltipContent>
                            </Tooltip>
                          </div>
                        </div>
                      </div>

                      {/* Behavior Toggles */}
                      <div className="flex items-center gap-4 flex-wrap border-t border-border/30 pt-2">
                        <span className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">Behavior</span>

                        {selectedWorkflow && (selectedWorkflow.transaction_type.includes('self_fulfillment') || selectedWorkflow.transaction_type.includes('self_pickup')) && (step.is_transit || step.creates_tracking_assignment) && (
                          <div className="w-full flex items-center gap-1.5 text-[10px] text-amber-600 bg-amber-50 rounded-md px-2 py-1 border border-amber-200">
                            <AlertTriangle size={11} className="shrink-0" />
                            <span>Transit & tracking flags are ignored for self-pickup workflows (blocked by DB triggers).</span>
                          </div>
                        )}

                        <div className="flex items-center gap-1.5">
                          <Checkbox checked={step.is_transit} onCheckedChange={(v) => updateStep(index, 'is_transit', !!v)} id={`transit-${index}`} />
                          <label htmlFor={`transit-${index}`} className="text-[11px] text-muted-foreground cursor-pointer">🚚 In Transit</label>
                          <Tooltip>
                            <TooltipTrigger asChild><HelpCircle size={10} className="text-muted-foreground/40 cursor-help" /></TooltipTrigger>
                            <TooltipContent side="top" className="max-w-[200px] text-xs">Enables live delivery tracking, map UI, and GPS updates for the buyer during this step.</TooltipContent>
                          </Tooltip>
                        </div>

                        <div className="flex items-center gap-1.5">
                          <FieldLabel label="OTP Type" tooltip="Controls OTP verification. 'Delivery OTP' requires a delivery assignment. 'Generic OTP' works at any step — a 4-digit code is generated and must be shared between parties. 'None' means no OTP gate." className="mb-0" />
                          <Select value={step.otp_type || 'none'} onValueChange={(v) => { updateStep(index, 'otp_type', v === 'none' ? null : v); updateStep(index, 'requires_otp', v !== 'none'); }}>
                            <SelectTrigger className="h-7 w-[140px] text-[11px]">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="none">None</SelectItem>
                              <SelectItem value="delivery">🔐 Delivery OTP</SelectItem>
                              <SelectItem value="generic">🔑 Generic OTP</SelectItem>
                            </SelectContent>
                          </Select>
                          {step.otp_type === 'delivery' && (() => {
                            const sorted = [...editSteps].sort((a, b) => a.sort_order - b.sort_order);
                            const idx = sorted.findIndex(s => s.status_key === step.status_key);
                            return !sorted.slice(0, idx + 1).some(s => s.creates_tracking_assignment);
                          })() && (
                            <AlertTriangle size={12} className="text-destructive shrink-0" />
                          )}
                          {step.requires_otp && !step.otp_type && (
                            <AlertTriangle size={12} className="text-destructive shrink-0" />
                          )}
                        </div>

                        <div className="flex items-center gap-1.5">
                          <Checkbox checked={step.is_success} onCheckedChange={(v) => updateStep(index, 'is_success', !!v)} id={`success-${index}`} />
                          <label htmlFor={`success-${index}`} className="text-[11px] text-muted-foreground cursor-pointer">✅ Successful</label>
                          <Tooltip>
                            <TooltipTrigger asChild><HelpCircle size={10} className="text-muted-foreground/40 cursor-help" /></TooltipTrigger>
                            <TooltipContent side="top" className="max-w-[200px] text-xs">Marks this as a successful completion. Triggers celebration UI, enables reviews, and settles payments. Only meaningful on end states.</TooltipContent>
                          </Tooltip>
                        </div>

                        {!step.is_terminal && (
                          <div className="flex items-center gap-1.5">
                            <Checkbox checked={step.creates_tracking_assignment} onCheckedChange={(v) => {
                              // Enforce single tracking start point — clear all others
                              if (v) {
                                editSteps.forEach((s, si) => {
                                  if (si !== index && s.creates_tracking_assignment) {
                                    updateStep(si, 'creates_tracking_assignment', false);
                                  }
                                });
                              }
                              updateStep(index, 'creates_tracking_assignment', !!v);
                              // Auto-select Delivery OTP when enabling tracking start
                              if (v && (!step.otp_type || step.otp_type === 'none')) {
                                updateStep(index, 'otp_type', 'delivery');
                              }
                            }} id={`tracking-${index}`} />
                            <label htmlFor={`tracking-${index}`} className="text-[11px] text-muted-foreground cursor-pointer">🚚 Start Delivery Here</label>
                            <Tooltip>
                              <TooltipTrigger asChild><HelpCircle size={10} className="text-muted-foreground/40 cursor-help" /></TooltipTrigger>
                              <TooltipContent side="top" className="max-w-[200px] text-xs">Creates a delivery tracking assignment when this step is reached. Only one step per workflow can have this. Delivery OTP only works after this point.</TooltipContent>
                            </Tooltip>
                          </div>
                        )}

                        {/* Per-step capability indicators — context-sensitive */}
                        {(() => {
                          const sorted = [...editSteps].sort((a, b) => a.sort_order - b.sort_order);
                          const thisIdx = sorted.findIndex(s => s.status_key === step.status_key);
                          const trackingStartIdx = sorted.findIndex(s => s.creates_tracking_assignment);
                          const hasDeliveryContext = trackingStartIdx !== -1 && thisIdx >= trackingStartIdx;
                          const trackingStepLabel = trackingStartIdx !== -1 ? (sorted[trackingStartIdx].display_name || sorted[trackingStartIdx].status_key) : null;

                          return (
                            <div className="flex flex-wrap gap-1.5 mt-1">
                              {step.creates_tracking_assignment && (
                                <span className="text-[9px] px-1.5 py-0.5 rounded bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400">
                                  🚚 Delivery starts at this step — Delivery OTP available from here onward
                                </span>
                              )}
                              {hasDeliveryContext && !step.creates_tracking_assignment && step.otp_type === 'delivery' && (
                                <span className="text-[9px] px-1.5 py-0.5 rounded bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400">
                                  ✅ Delivery OTP available (delivery started at: {trackingStepLabel})
                                </span>
                              )}
                              {step.otp_type === 'delivery' && !hasDeliveryContext && (
                                <div className="w-full mt-1 p-1.5 rounded border border-destructive/30 bg-destructive/5 text-[10px] text-destructive">
                                  ⚠️ Delivery OTP cannot work here. {trackingStepLabel ? `Delivery starts at: ${trackingStepLabel}` : 'No step has "Start Delivery Here" enabled.'} → Use Generic OTP instead, or move this to a later step.
                                </div>
                              )}
                            </div>
                          );
                        })()}
                      </div>

                      {/* Display Actor (who this step is "waiting on") — multi-select toggles */}
                      {!step.is_terminal && step.status_key && (
                        <div className="flex items-center gap-2 flex-wrap">
                          <FieldLabel label="Waiting On" tooltip="Which role(s) is this step waiting on? This controls the display hint (e.g. 'Waiting for seller'). It does NOT control who can advance — configure that in the Transition Rules section below." />
                          <div className="flex gap-1">
                            {ACTORS.map(actor => {
                              const actorLabels: Record<string, string> = { buyer: '👤 Buyer', seller: '🏪 Seller', delivery: '🚚 Delivery', system: '⚙️ System', admin: '🛡️ Admin' };
                              const selectedActors = (step.actor || '').split(',').filter(Boolean);
                              const isActive = selectedActors.includes(actor);
                              return (
                                <button
                                  key={actor}
                                  type="button"
                                  onClick={() => {
                                    if (isActive && selectedActors.length <= 1) return;
                                    const next = isActive
                                      ? selectedActors.filter(a => a !== actor)
                                      : [...selectedActors, actor];
                                    updateStep(index, 'actor', next.join(','));
                                  }}
                                  className={cn(
                                    "text-[10px] px-2 py-1 rounded-md border transition-all",
                                    isActive
                                      ? "bg-primary text-primary-foreground border-primary"
                                      : "bg-background text-muted-foreground border-border hover:border-primary/50"
                                  )}
                                >
                                  {actorLabels[actor] || actor}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      )}

                      {/* Cancellation / Rejection toggles */}
                      {!step.is_terminal && step.status_key && (
                        <div className="flex items-center gap-4 flex-wrap">
                          <FieldLabel label="Cancellation" tooltip="Controls who can cancel/reject the order at this step. This creates transition rules to the 'cancelled' status." className="mb-0" />
                          {[
                            { actor: 'buyer', label: '👤 Buyer can cancel', color: 'bg-orange-100 text-orange-700 border-orange-300' },
                            { actor: 'seller', label: '🏪 Seller can reject', color: 'bg-red-100 text-red-700 border-red-300' },
                            { actor: 'admin', label: '🛡️ Admin can cancel', color: 'bg-purple-100 text-purple-700 border-purple-300' },
                          ].map(({ actor, label, color }) => {
                            const hasCancelTransition = transitions.some(
                              t => t.from_status === step.status_key && t.to_status === 'cancelled' && t.allowed_actor === actor
                            );
                            return (
                              <button
                                key={actor}
                                type="button"
                                onClick={() => {
                                  if (hasCancelTransition) {
                                    setTransitions(prev => prev.filter(
                                      t => !(t.from_status === step.status_key && t.to_status === 'cancelled' && t.allowed_actor === actor)
                                    ));
                                  } else {
                                    setTransitions(prev => [...prev, {
                                      from_status: step.status_key,
                                      to_status: 'cancelled',
                                      allowed_actor: actor,
                                      is_side_action: false,
                                    }]);
                                  }
                                }}
                                className={cn(
                                  "text-[10px] px-2 py-1 rounded-md border transition-all",
                                  hasCancelTransition
                                    ? color
                                    : "bg-background text-muted-foreground border-border hover:border-destructive/50"
                                )}
                              >
                                {label}
                              </button>
                            );
                          })}
                        </div>
                      )}

                      {/* Hint Messages */}
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <FieldLabel label="Buyer Message" tooltip="A short message shown to the buyer when the order is at this step (e.g. 'Your order is being prepared')." />
                          <Input value={step.buyer_hint} onChange={(e) => updateStep(index, 'buyer_hint', e.target.value)} placeholder="e.g. Your order is on the way!" className="h-7 text-xs rounded-lg" />
                        </div>
                        <div>
                          <FieldLabel label="Seller Message" tooltip="A short message shown to the seller when the order is at this step (e.g. 'Customer is waiting for pickup')." />
                          <Input value={step.seller_hint} onChange={(e) => updateStep(index, 'seller_hint', e.target.value)} placeholder="e.g. Prepare the order now" className="h-7 text-xs rounded-lg" />
                        </div>
                      </div>

                      {/* Notification Config */}
                      <div className="border-t border-border/30 pt-2 space-y-2">
                        <div className="flex items-center gap-2">
                          <Checkbox checked={step.notify_buyer} onCheckedChange={(v) => updateStep(index, 'notify_buyer', !!v)} id={`notify-${index}`} />
                          <label htmlFor={`notify-${index}`} className="text-xs text-muted-foreground cursor-pointer">🔔 Send Buyer Push Notification</label>
                          <Tooltip>
                            <TooltipTrigger asChild><HelpCircle size={10} className="text-muted-foreground/40 cursor-help" /></TooltipTrigger>
                            <TooltipContent side="top" className="max-w-[220px] text-xs">Send a push notification to the buyer when the order enters this step.</TooltipContent>
                          </Tooltip>
                        </div>
                        {step.notify_buyer && (
                          <div className="space-y-1.5 pl-6">
                            <div>
                              <FieldLabel label="Notification Title" tooltip="Title of the push notification (e.g. '✅ Order Accepted!'). Keep it short and clear." />
                              <Input value={step.notification_title} onChange={(e) => updateStep(index, 'notification_title', e.target.value)} placeholder="e.g. ✅ Order Accepted!" className="h-7 text-xs rounded-lg" />
                            </div>
                            <div>
                              <FieldLabel label="Notification Body" tooltip="Body text of the push notification. You can use {seller_name} as a placeholder." />
                              <Input value={step.notification_body} onChange={(e) => updateStep(index, 'notification_body', e.target.value)} placeholder="e.g. {seller_name} accepted your order" className="h-7 text-xs rounded-lg" />
                            </div>
                            <div>
                              <FieldLabel label="Action Button" tooltip="Optional button text shown in the notification (e.g. 'Track Order', 'Rate Order')." />
                              <Input value={step.notification_action} onChange={(e) => updateStep(index, 'notification_action', e.target.value)} placeholder="e.g. Track Order" className="h-7 text-xs rounded-lg" />
                            </div>
                          </div>
                        )}
                        <div className="flex items-center gap-2">
                          <Checkbox checked={step.notify_seller} onCheckedChange={(v) => updateStep(index, 'notify_seller', !!v)} id={`notify-seller-${index}`} />
                          <label htmlFor={`notify-seller-${index}`} className="text-xs text-muted-foreground cursor-pointer">📣 Send Seller Push Notification</label>
                          <Tooltip>
                            <TooltipTrigger asChild><HelpCircle size={10} className="text-muted-foreground/40 cursor-help" /></TooltipTrigger>
                            <TooltipContent side="top" className="max-w-[220px] text-xs">Send a push notification to the seller when the order enters this step.</TooltipContent>
                          </Tooltip>
                        </div>
                        {step.notify_seller && (
                          <div className="space-y-1.5 pl-6">
                            <div>
                              <FieldLabel label="Notification Title" tooltip="Title of the seller push notification." />
                              <Input value={step.seller_notification_title} onChange={(e) => updateStep(index, 'seller_notification_title', e.target.value)} placeholder="e.g. 🆕 New Order Received!" className="h-7 text-xs rounded-lg" />
                            </div>
                            <div>
                              <FieldLabel label="Notification Body" tooltip="Body text of the seller push notification." />
                              <Input value={step.seller_notification_body} onChange={(e) => updateStep(index, 'seller_notification_body', e.target.value)} placeholder="e.g. Review items and accept promptly" className="h-7 text-xs rounded-lg" />
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Transitions */}
              <TransitionRulesEditor
                editSteps={editSteps}
                transitions={transitions}
                hasTransition={hasTransition}
                toggleTransition={toggleTransition}
              />
            </div>
          </ScrollArea>

          <div className="absolute bottom-0 left-0 right-0 border-t border-border bg-background px-4 py-3 pb-[env(safe-area-inset-bottom)]">
            <Button className="w-full h-11 rounded-xl font-semibold" onClick={saveWorkflow} disabled={isSaving}>
              <Save size={15} className="mr-2" />
              {isSaving ? 'Saving...' : 'Save Workflow'}
            </Button>
          </div>
        </DrawerContent>
      </Drawer>

      {/* Dialogs */}
      <CreateWorkflowDialog
        open={showCreate}
        onOpenChange={setShowCreate}
        existingWorkflows={workflows}
        onCreated={loadWorkflows}
      />
      <CloneWorkflowDialog
        open={!!cloneSource}
        onOpenChange={(open) => !open && setCloneSource(null)}
        source={cloneSource}
        existingWorkflows={workflows}
        onCloned={loadWorkflows}
      />
      <DeleteWorkflowDialog
        open={!!deleteTarget}
        onOpenChange={(open) => { if (!open) { setDeleteTarget(null); } }}
        workflow={deleteTarget}
        onDeleted={() => { setSelectedWorkflow(null); loadWorkflows(); }}
      />
    </div>
  );
}
