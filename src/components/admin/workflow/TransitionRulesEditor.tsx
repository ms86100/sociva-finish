// @ts-nocheck
import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ArrowRight, Plus, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { type FlowStep, type Transition, ACTORS, formatName } from './types';

interface Props {
  editSteps: FlowStep[];
  transitions: Transition[];
  hasTransition: (from: string, to: string, actor: string) => boolean;
  toggleTransition: (from: string, to: string, actor: string) => void;
}

export function TransitionRulesEditor({ editSteps, transitions, hasTransition, toggleTransition }: Props) {
  const [addingFor, setAddingFor] = useState<string | null>(null);
  const [newTarget, setNewTarget] = useState<string>('');

  const nonTerminalSteps = editSteps.filter(s => !s.is_terminal && s.status_key);

  const getActiveTargets = (fromKey: string) => {
    const targetKeys = new Set<string>();
    transitions.forEach(t => {
      if (t.from_status === fromKey) targetKeys.add(t.to_status);
    });
    return editSteps.filter(s => targetKeys.has(s.status_key)).sort((a, b) => a.sort_order - b.sort_order);
  };

  const getActiveActors = (fromKey: string, toKey: string) =>
    ACTORS.filter(a => hasTransition(fromKey, toKey, a));

  const getAvailableTargets = (fromKey: string) => {
    const activeKeys = new Set(getActiveTargets(fromKey).map(s => s.status_key));
    return editSteps.filter(s => s.status_key !== fromKey && !activeKeys.has(s.status_key) && s.status_key);
  };

  const handleAddTransition = (fromKey: string) => {
    if (!newTarget) return;
    toggleTransition(fromKey, newTarget, 'system');
    setNewTarget('');
    setAddingFor(null);
  };

  const removeAllActors = (fromKey: string, toKey: string) => {
    ACTORS.forEach(a => {
      if (hasTransition(fromKey, toKey, a)) {
        toggleTransition(fromKey, toKey, a);
      }
    });
  };

  return (
    <div>
      <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground mb-3">Transition Rules</p>
      <p className="text-[11px] text-muted-foreground mb-3">Active transitions — click actor badges to toggle, ✕ to remove a link.</p>

      <div className="space-y-3">
        {nonTerminalSteps.map(fromStep => {
          const activeTargets = getActiveTargets(fromStep.status_key);
          const availableTargets = getAvailableTargets(fromStep.status_key);

          return (
            <div key={fromStep.status_key} className="bg-muted/30 rounded-xl p-3 border border-border/40">
              <p className="text-xs font-semibold mb-2 flex items-center gap-1.5">
                <Badge variant="outline" className="text-[10px] font-mono">{fromStep.status_key}</Badge>
                <ArrowRight size={12} className="text-muted-foreground" />
              </p>

              {activeTargets.length === 0 && (
                <p className="text-[11px] text-muted-foreground italic px-2">No transitions defined</p>
              )}

              <div className="space-y-1.5">
                {activeTargets.map(toStep => {
                  const activeActors = getActiveActors(fromStep.status_key, toStep.status_key);
                  return (
                    <div key={toStep.status_key} className="flex items-center gap-2 px-2 py-1.5 rounded-lg bg-primary/5">
                      <span className="text-[11px] font-mono text-foreground w-24 truncate" title={toStep.status_key}>
                        {toStep.status_key}
                      </span>
                      <div className="flex gap-1 flex-wrap flex-1">
                        {ACTORS.map(actor => (
                          <button
                            key={actor}
                            onClick={() => toggleTransition(fromStep.status_key, toStep.status_key, actor)}
                            className={cn(
                              "text-[10px] px-1.5 py-0.5 rounded-md border transition-all",
                              activeActors.includes(actor)
                                ? "bg-primary text-primary-foreground border-primary"
                                : "bg-background text-muted-foreground border-border hover:border-primary/50"
                            )}
                          >
                            {actor}
                          </button>
                        ))}
                      </div>
                      <button
                        onClick={() => removeAllActors(fromStep.status_key, toStep.status_key)}
                        className="text-muted-foreground hover:text-destructive transition-colors p-0.5"
                        title="Remove transition"
                      >
                        <X size={12} />
                      </button>
                    </div>
                  );
                })}
              </div>

              {/* Add transition */}
              {addingFor === fromStep.status_key ? (
                <div className="flex items-center gap-2 mt-2 px-2">
                  <Select value={newTarget} onValueChange={setNewTarget}>
                    <SelectTrigger className="h-7 text-xs flex-1">
                      <SelectValue placeholder="Select target status" />
                    </SelectTrigger>
                    <SelectContent>
                      {availableTargets.map(s => (
                        <SelectItem key={s.status_key} value={s.status_key}>
                          {s.display_label || formatName(s.status_key)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button size="sm" variant="default" className="h-7 text-xs px-3" onClick={() => handleAddTransition(fromStep.status_key)} disabled={!newTarget}>
                    Add
                  </Button>
                  <Button size="sm" variant="ghost" className="h-7 text-xs px-2" onClick={() => { setAddingFor(null); setNewTarget(''); }}>
                    Cancel
                  </Button>
                </div>
              ) : (
                availableTargets.length > 0 && (
                  <button
                    onClick={() => { setAddingFor(fromStep.status_key); setNewTarget(''); }}
                    className="flex items-center gap-1 text-[11px] text-primary hover:text-primary/80 mt-2 px-2 transition-colors"
                  >
                    <Plus size={12} /> Add transition
                  </button>
                )
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
