// @ts-nocheck
import { useState, useEffect, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Switch } from '@/components/ui/switch';
import { toast } from 'sonner';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '@/lib/utils';
import {
  Play, Plus, ChevronDown, ChevronRight, CheckCircle2, XCircle,
  Clock, AlertTriangle, Loader2, Trash2, Edit3, RotateCcw,
  FlaskConical, Zap, Timer,
} from 'lucide-react';

interface TestStep {
  step_id: string;
  label: string;
  action: string;
  table?: string;
  actor: string;
  params?: Record<string, any>;
  expect?: { status?: string; row_count?: number; field_checks?: Record<string, any> };
  on_fail?: string;
  cleanup?: boolean;
}

interface Scenario {
  id: string;
  name: string;
  module: string;
  description: string | null;
  steps: TestStep[];
  is_active: boolean;
  priority: number;
  last_run_at: string | null;
  last_result: string | null;
  last_run_id: string | null;
  created_at: string;
}

interface StepResult {
  step_id: string;
  label: string;
  outcome: 'passed' | 'failed' | 'skipped';
  duration_ms: number;
  error_message?: string;
  suggested_fix?: string;
  response_data?: any;
}

const MODULES = ['checkout', 'cart', 'lifecycle', 'rls', 'edge_cases', 'booking', 'seller', 'delivery', 'auth', 'payment', 'general'];
const ACTIONS = ['select', 'insert', 'update', 'delete', 'rpc', 'assert', 'setup'];
const ACTORS = ['buyer', 'seller', 'admin', 'guard', 'service_role'];

const resultColor: Record<string, string> = {
  passed: 'bg-emerald-500/10 text-emerald-600 border-emerald-200',
  failed: 'bg-destructive/10 text-destructive border-destructive/20',
  running: 'bg-amber-500/10 text-amber-600 border-amber-200',
  pending: 'bg-muted text-muted-foreground border-border',
  partial: 'bg-amber-500/10 text-amber-600 border-amber-200',
};

const resultIcon: Record<string, React.ReactNode> = {
  passed: <CheckCircle2 size={14} />,
  failed: <XCircle size={14} />,
  running: <Loader2 size={14} className="animate-spin" />,
  pending: <Clock size={14} />,
  partial: <AlertTriangle size={14} />,
};

export default function AdminTestScenariosTab() {
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [loading, setLoading] = useState(true);
  const [runningIds, setRunningIds] = useState<Set<string>>(new Set());
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [stepResults, setStepResults] = useState<Record<string, StepResult[]>>({});
  const [showCreate, setShowCreate] = useState(false);
  const [editScenario, setEditScenario] = useState<Scenario | null>(null);
  const [filterModule, setFilterModule] = useState<string>('all');
  const [generating, setGenerating] = useState(false);
  const [isBatchRunning, setIsBatchRunning] = useState(false);
  const [stopRequested, setStopRequested] = useState(false);
  const stopRequestedRef = useRef(false);
  // Form state
  const [formName, setFormName] = useState('');
  const [formModule, setFormModule] = useState('general');
  const [formDesc, setFormDesc] = useState('');
  const [formPriority, setFormPriority] = useState(50);
  const [formSteps, setFormSteps] = useState<TestStep[]>([]);

  useEffect(() => {
    fetchScenarios();
    const channel = supabase
      .channel('test-scenarios-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'test_scenarios' }, () => {
        fetchScenarios();
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, []);

  async function fetchScenarios() {
    const { data, error } = await supabase
      .from('test_scenarios')
      .select('*')
      .order('priority', { ascending: true });
    if (!error && data) {
      setScenarios(data.map(d => ({
        ...d,
        steps: Array.isArray(d.steps) ? d.steps as unknown as TestStep[] : [],
      })));
    }
    setLoading(false);
  }

  async function runScenario(id: string, options?: { silent?: boolean }) {
    setRunningIds(prev => new Set(prev).add(id));
    setExpandedId(id);
    try {
      const { data, error } = await supabase.functions.invoke('run-test-scenario', {
        body: { scenario_id: id },
      });
      if (error) throw error;
      if (data?.steps) {
        setStepResults(prev => ({ ...prev, [id]: data.steps }));
      }
      if (!options?.silent) {
        toast.success(`Scenario ${data?.result === 'passed' ? 'passed ✓' : 'completed with issues'}`);
      }
      return data?.result as string | undefined;
    } catch (err: any) {
      if (!options?.silent) {
        toast.error(`Run failed: ${err.message}`);
      }
      return 'failed';
    } finally {
      setRunningIds(prev => { const s = new Set(prev); s.delete(id); return s; });
      fetchScenarios();
    }
  }

  function stopRunningQueue() {
    stopRequestedRef.current = true;
    setStopRequested(true);
    toast.message('Stopping after the current scenario finishes.');
  }

  async function runAllActive() {
    if (isBatchRunning) return;

    const active = scenarios.filter(s => s.is_active);
    if (active.length === 0) {
      toast.error('No active scenarios to run');
      return;
    }

    stopRequestedRef.current = false;
    setStopRequested(false);
    setIsBatchRunning(true);

    let completed = 0;
    let failed = 0;

    try {
      for (const scenario of active) {
        if (stopRequestedRef.current) break;
        const result = await runScenario(scenario.id, { silent: true });
        completed += 1;
        if (result !== 'passed') failed += 1;
      }

      if (stopRequestedRef.current) {
        toast.message(`Stopped after ${completed}/${active.length} scenarios.`);
      } else {
        toast.success(`Finished ${completed} scenarios${failed ? ` · ${failed} with issues` : ''}`);
      }
    } finally {
      stopRequestedRef.current = false;
      setStopRequested(false);
      setIsBatchRunning(false);
    }
  }

  async function generateScenarios() {
    setGenerating(true);
    try {
      const { data, error } = await supabase.functions.invoke('generate-test-scenarios', {
        body: { modules: ['cart', 'checkout', 'lifecycle', 'rls', 'edge_cases'], clear_existing: true },
      });
      if (error) throw error;
      toast.success(`Generated ${data?.total_inserted || 0} test scenarios across ${Object.keys(data?.by_module || {}).length} modules`);
      fetchScenarios();
    } catch (err: any) {
      toast.error(`Generation failed: ${err.message}`);
    } finally {
      setGenerating(false);
    }
  }

  async function toggleActive(id: string, active: boolean) {
    await supabase.from('test_scenarios').update({ is_active: active }).eq('id', id);
    fetchScenarios();
  }

  async function deleteScenario(id: string) {
    await supabase.from('test_scenarios').delete().eq('id', id);
    toast.success('Scenario deleted');
    fetchScenarios();
  }

  function openEdit(scenario: Scenario) {
    setEditScenario(scenario);
    setFormName(scenario.name);
    setFormModule(scenario.module);
    setFormDesc(scenario.description || '');
    setFormPriority(scenario.priority);
    setFormSteps([...scenario.steps]);
    setShowCreate(true);
  }

  function openCreate() {
    setEditScenario(null);
    setFormName(''); setFormModule('general'); setFormDesc(''); setFormPriority(50);
    setFormSteps([{ step_id: 'step_1', label: '', action: 'select', actor: 'buyer', table: '', on_fail: 'abort' }]);
    setShowCreate(true);
  }

  async function saveScenario() {
    if (!formName.trim()) { toast.error('Name required'); return; }
    const payload = {
      name: formName, module: formModule, description: formDesc || null,
      priority: formPriority, steps: formSteps as any,
      updated_at: new Date().toISOString(),
    };
    if (editScenario) {
      await supabase.from('test_scenarios').update(payload).eq('id', editScenario.id);
      toast.success('Scenario updated');
    } else {
      await supabase.from('test_scenarios').insert(payload);
      toast.success('Scenario created');
    }
    setShowCreate(false);
    fetchScenarios();
  }

  function addStep() {
    setFormSteps(prev => [...prev, {
      step_id: `step_${prev.length + 1}`, label: '', action: 'select', actor: 'buyer', table: '', on_fail: 'continue',
    }]);
  }

  function updateStep(idx: number, patch: Partial<TestStep>) {
    setFormSteps(prev => prev.map((s, i) => i === idx ? { ...s, ...patch } : s));
  }

  function removeStep(idx: number) {
    setFormSteps(prev => prev.filter((_, i) => i !== idx));
  }

  const filtered = filterModule === 'all' ? scenarios : scenarios.filter(s => s.module === filterModule);

  if (loading) {
    return <div className="flex items-center justify-center py-20"><Loader2 className="animate-spin text-muted-foreground" size={24} /></div>;
  }

  return (
    <div className="space-y-4 pt-4">
      {/* Header */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-xl bg-primary/10 flex items-center justify-center">
            <FlaskConical size={15} className="text-primary" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-foreground">Test Scenarios</h3>
            <p className="text-[11px] text-muted-foreground">{scenarios.length} scenarios · {scenarios.filter(s => s.is_active).length} active</p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={generateScenarios} disabled={generating || isBatchRunning} className="text-xs gap-1.5">
            {generating ? <Loader2 size={13} className="animate-spin" /> : <RotateCcw size={13} />}
            {generating ? 'Generating...' : 'Generate All'}
          </Button>
          {isBatchRunning ? (
            <Button size="sm" variant="outline" onClick={stopRunningQueue} disabled={stopRequested} className="text-xs gap-1.5 border-destructive/30 text-destructive hover:text-destructive">
              <XCircle size={13} /> {stopRequested ? 'Stopping…' : 'Stop Queue'}
            </Button>
          ) : (
            <Button size="sm" variant="outline" onClick={runAllActive} className="text-xs gap-1.5">
              <Zap size={13} /> Run All
            </Button>
          )}
          <Button size="sm" onClick={openCreate} className="text-xs gap-1.5" disabled={isBatchRunning}>
            <Plus size={13} /> New
          </Button>
        </div>
      </div>

      {/* Filter */}
      <div className="flex gap-2 overflow-x-auto pb-1">
        {['all', ...MODULES].map(m => (
          <button
            key={m}
            onClick={() => setFilterModule(m)}
            className={cn(
              'px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-colors',
              filterModule === m ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:text-foreground'
            )}
          >
            {m === 'all' ? 'All' : m.charAt(0).toUpperCase() + m.slice(1)}
          </button>
        ))}
      </div>

      {/* Scenario Cards */}
      <div className="space-y-3">
        <AnimatePresence>
          {filtered.map(scenario => {
            const isRunning = runningIds.has(scenario.id);
            const isExpanded = expandedId === scenario.id;
            const results = stepResults[scenario.id];
            return (
              <motion.div key={scenario.id} layout initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
                <Card className="overflow-hidden">
                  <div className="p-3.5">
                    {/* Title row */}
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-start gap-2.5 min-w-0 flex-1">
                        <button onClick={() => setExpandedId(isExpanded ? null : scenario.id)} className="mt-0.5 shrink-0">
                          {isExpanded ? <ChevronDown size={16} className="text-muted-foreground" /> : <ChevronRight size={16} className="text-muted-foreground" />}
                        </button>
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <h4 className="text-sm font-semibold text-foreground truncate">{scenario.name}</h4>
                            <Badge variant="outline" className="text-[10px] px-1.5 py-0">{scenario.module}</Badge>
                            <Badge variant="outline" className={cn('text-[10px] px-1.5 py-0 gap-1', resultColor[scenario.last_result || 'pending'])}>
                              {resultIcon[scenario.last_result || 'pending']}
                              {scenario.last_result || 'pending'}
                            </Badge>
                          </div>
                          {scenario.description && (
                            <p className="text-[11px] text-muted-foreground mt-0.5 line-clamp-1">{scenario.description}</p>
                          )}
                          <div className="flex items-center gap-3 mt-1.5 text-[10px] text-muted-foreground">
                            <span className="flex items-center gap-1"><Timer size={10} />{scenario.steps.length} steps</span>
                            {scenario.last_run_at && (
                              <span>Last: {new Date(scenario.last_run_at).toLocaleString()}</span>
                            )}
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-1.5 shrink-0">
                        <Switch checked={scenario.is_active} onCheckedChange={(v) => toggleActive(scenario.id, v)} />
                        <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => openEdit(scenario)}>
                          <Edit3 size={13} />
                        </Button>
                        <Button
                          size="sm"
                          className="h-8 text-xs gap-1"
                          onClick={() => runScenario(scenario.id)}
                          disabled={isRunning || isBatchRunning}
                        >
                          {isRunning ? <Loader2 size={13} className="animate-spin" /> : <Play size={13} />}
                          Run
                        </Button>
                      </div>
                    </div>

                    {/* Expanded: step results */}
                    {isExpanded && (
                      <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} className="mt-3 border-t border-border/40 pt-3">
                        {results && results.length > 0 ? (
                          <div className="space-y-1.5">
                            {results.map((r, i) => (
                              <div key={r.step_id} className={cn(
                                'flex items-start gap-2 px-2.5 py-2 rounded-lg text-xs',
                                r.outcome === 'passed' && 'bg-emerald-50 dark:bg-emerald-950/20',
                                r.outcome === 'failed' && 'bg-destructive/5',
                                r.outcome === 'skipped' && 'bg-muted/50',
                              )}>
                                <span className="shrink-0 mt-0.5">
                                  {r.outcome === 'passed' ? <CheckCircle2 size={13} className="text-emerald-600" /> :
                                   r.outcome === 'failed' ? <XCircle size={13} className="text-destructive" /> :
                                   <Clock size={13} className="text-muted-foreground" />}
                                </span>
                                <div className="min-w-0 flex-1">
                                  <div className="flex items-center justify-between gap-2">
                                    <span className="font-medium text-foreground">{i + 1}. {r.label}</span>
                                    <span className="text-muted-foreground shrink-0">{r.duration_ms}ms</span>
                                  </div>
                                  {r.error_message && (
                                    <p className="text-destructive mt-0.5 font-mono text-[10px] break-all">{r.error_message}</p>
                                  )}
                                  {r.suggested_fix && (
                                    <div className="mt-1 px-2 py-1.5 rounded-md bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/40">
                                      <p className="text-[10px] font-semibold text-amber-700 dark:text-amber-400 flex items-center gap-1">
                                        <AlertTriangle size={10} /> Suggested Fix:
                                      </p>
                                      <p className="text-[10px] text-amber-800 dark:text-amber-300 mt-0.5">{r.suggested_fix}</p>
                                    </div>
                                  )}
                                </div>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div className="space-y-1">
                            <p className="text-xs text-muted-foreground font-medium mb-2">Steps defined:</p>
                            {scenario.steps.map((s, i) => (
                              <div key={s.step_id} className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-muted/30 text-xs">
                                <span className="text-muted-foreground w-5">{i + 1}.</span>
                                <span className="font-medium text-foreground">{s.label || s.step_id}</span>
                                <Badge variant="outline" className="text-[9px] px-1 py-0 ml-auto">{s.action}</Badge>
                                <Badge variant="outline" className="text-[9px] px-1 py-0">{s.actor}</Badge>
                              </div>
                            ))}
                          </div>
                        )}
                        <div className="flex justify-end mt-2">
                          <Button size="sm" variant="ghost" className="text-xs text-destructive h-7 gap-1" onClick={() => deleteScenario(scenario.id)}>
                            <Trash2 size={12} /> Delete
                          </Button>
                        </div>
                      </motion.div>
                    )}
                  </div>
                </Card>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>

      {filtered.length === 0 && (
        <div className="text-center py-16">
          <FlaskConical size={32} className="mx-auto text-muted-foreground/40 mb-3" />
          <p className="text-sm text-muted-foreground">No test scenarios yet</p>
          <Button size="sm" className="mt-3" onClick={openCreate}><Plus size={14} className="mr-1" /> Create First Scenario</Button>
        </div>
      )}

      {/* Create/Edit Dialog */}
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="rounded-2xl max-w-lg max-h-[90dvh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="font-bold">{editScenario ? 'Edit Scenario' : 'New Test Scenario'}</DialogTitle>
          </DialogHeader>
          <ScrollArea className="flex-1 -mx-6 px-6">
            <div className="space-y-4 pb-4">
              <Input placeholder="Scenario name" value={formName} onChange={e => setFormName(e.target.value)} />
              <div className="flex gap-2">
                <Select value={formModule} onValueChange={setFormModule}>
                  <SelectTrigger className="flex-1"><SelectValue /></SelectTrigger>
                  <SelectContent>{MODULES.map(m => <SelectItem key={m} value={m}>{m}</SelectItem>)}</SelectContent>
                </Select>
                <Input type="number" placeholder="Priority" value={formPriority} onChange={e => setFormPriority(Number(e.target.value))} className="w-20" />
              </div>
              <Textarea placeholder="Description..." value={formDesc} onChange={e => setFormDesc(e.target.value)} rows={2} />

              {/* Steps */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs font-bold text-foreground">Steps ({formSteps.length})</p>
                  <Button size="sm" variant="outline" className="h-7 text-xs" onClick={addStep}><Plus size={12} className="mr-1" /> Add</Button>
                </div>
                <div className="space-y-2">
                  {formSteps.map((step, idx) => (
                    <div key={idx} className="p-2.5 rounded-xl bg-muted/30 border border-border/30 space-y-2">
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] font-bold text-muted-foreground w-5">{idx + 1}</span>
                        <Input placeholder="Step label" value={step.label} onChange={e => updateStep(idx, { label: e.target.value })} className="flex-1 h-8 text-xs" />
                        <button onClick={() => removeStep(idx)} className="text-destructive/60 hover:text-destructive"><Trash2 size={13} /></button>
                      </div>
                      <div className="flex gap-1.5">
                        <Select value={step.action} onValueChange={v => updateStep(idx, { action: v })}>
                          <SelectTrigger className="h-7 text-[11px] flex-1"><SelectValue /></SelectTrigger>
                          <SelectContent>{ACTIONS.map(a => <SelectItem key={a} value={a}>{a}</SelectItem>)}</SelectContent>
                        </Select>
                        <Select value={step.actor} onValueChange={v => updateStep(idx, { actor: v })}>
                          <SelectTrigger className="h-7 text-[11px] flex-1"><SelectValue /></SelectTrigger>
                          <SelectContent>{ACTORS.map(a => <SelectItem key={a} value={a}>{a}</SelectItem>)}</SelectContent>
                        </Select>
                        <Input placeholder="table" value={step.table || ''} onChange={e => updateStep(idx, { table: e.target.value })} className="h-7 text-[11px] flex-1" />
                      </div>
                      <Textarea
                        placeholder='{"filters":{"status":"active"}} or {"row":{"quantity":1}}'
                        value={step.params ? JSON.stringify(step.params) : ''}
                        onChange={e => {
                          try { updateStep(idx, { params: JSON.parse(e.target.value) }); } catch { /* keep typing */ }
                        }}
                        rows={1}
                        className="text-[10px] font-mono min-h-[28px]"
                      />
                      <div className="flex gap-1.5">
                        <Select value={step.on_fail || 'abort'} onValueChange={v => updateStep(idx, { on_fail: v })}>
                          <SelectTrigger className="h-7 text-[11px] flex-1"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="abort">On fail: abort</SelectItem>
                            <SelectItem value="continue">On fail: continue</SelectItem>
                            <SelectItem value="skip_remaining">On fail: skip rest</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </ScrollArea>
          <div className="flex gap-2 pt-2 border-t border-border/30">
            <Button variant="outline" className="flex-1" onClick={() => setShowCreate(false)}>Cancel</Button>
            <Button className="flex-1 font-semibold" onClick={saveScenario}>
              {editScenario ? 'Update' : 'Create'} Scenario
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
