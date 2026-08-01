// @ts-nocheck
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from '@/components/ui/drawer';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { format } from 'date-fns';
import { toast } from 'sonner';
import { useState } from 'react';
import { CheckCircle2, RotateCcw, ShieldCheck, Clock, Wrench, AlertTriangle } from 'lucide-react';

interface SnagTicket {
  id: string;
  flat_number: string;
  category: string;
  description: string;
  photo_urls: string[];
  status: string;
  sla_deadline: string;
  assigned_to_name: string | null;
  acknowledged_at: string | null;
  fixed_at: string | null;
  verified_at: string | null;
  resolution_note: string | null;
  created_at: string;
  reported_by: string;
}

const STATUS_FLOW = [
  { key: 'reported', label: 'Reported', icon: AlertTriangle },
  { key: 'acknowledged', label: 'Acknowledged', icon: Clock },
  { key: 'contractor_assigned', label: 'Contractor Assigned', icon: Wrench },
  { key: 'in_progress', label: 'In Progress', icon: Wrench },
  { key: 'fixed', label: 'Fixed', icon: CheckCircle2 },
  { key: 'verified', label: 'Verified', icon: ShieldCheck },
  { key: 'closed', label: 'Closed', icon: CheckCircle2 },
];

export function SnagDetailSheet({
  ticket, open, onOpenChange, onUpdated,
}: {
  ticket: SnagTicket | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onUpdated: () => void;
}) {
  const { user, isAdmin } = useAuth();
  const [assignee, setAssignee] = useState('');
  const [newStatus, setNewStatus] = useState('');
  const [resolutionNote, setResolutionNote] = useState('');

  if (!ticket) return null;

  const isReporter = user?.id === ticket.reported_by;
  const currentIndex = STATUS_FLOW.findIndex(s => s.key === ticket.status);

  const handleStatusUpdate = async (status: string) => {
    const updates: any = { status };
    if (status === 'acknowledged') updates.acknowledged_at = new Date().toISOString();
    if (status === 'fixed') {
      updates.fixed_at = new Date().toISOString();
      if (resolutionNote.trim()) updates.resolution_note = resolutionNote.trim();
    }
    if (status === 'verified') updates.verified_at = new Date().toISOString();
    if (status === 'contractor_assigned' && assignee) updates.assigned_to_name = assignee;

    const { error } = await supabase.from('snag_tickets').update(updates).eq('id', ticket.id);
    if (error) { toast.error('Failed to update'); return; }
    toast.success('Status updated');
    onUpdated();
  };

  const handleVerify = () => handleStatusUpdate('verified');
  const handleReopen = () => handleStatusUpdate('reported');

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent className="max-h-[90vh] overflow-y-auto">
        <DrawerHeader><DrawerTitle>Snag Details</DrawerTitle></DrawerHeader>
        <div className="space-y-4 mt-4 px-4">
          {/* Description */}
          <div>
            <p className="text-sm">{ticket.description}</p>
            <p className="text-[10px] text-muted-foreground mt-1">
              Flat {ticket.flat_number} · {format(new Date(ticket.created_at), 'dd MMM yyyy, hh:mm a')}
            </p>
          </div>

          {/* Acknowledgment Indicator */}
          {ticket.acknowledged_at ? (
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-success/10 border border-success/20">
              <ShieldCheck size={14} className="text-success" />
              <span className="text-xs text-success font-medium">
                Seen by committee — {format(new Date(ticket.acknowledged_at), 'MMM d, h:mm a')}
              </span>
            </div>
          ) : (
            (() => {
              const hoursSince = (Date.now() - new Date(ticket.created_at).getTime()) / 3600000;
              return hoursSince > 48 ? (
                <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-warning/10 border border-warning/20">
                  <AlertTriangle size={14} className="text-warning" />
                  <span className="text-xs text-warning font-medium">
                    Awaiting review — submitted {Math.floor(hoursSince / 24)} days ago
                  </span>
                </div>
              ) : null;
            })()
          )}


          {ticket.photo_urls.length > 0 && (
            <div className="grid grid-cols-3 gap-2">
              {ticket.photo_urls.map((url, i) => (
                <img key={i} src={url} alt={`Snag photo ${i + 1}`} className="w-full aspect-square object-cover rounded-lg border border-border" />
              ))}
            </div>
          )}

          {/* Status Timeline */}
          <div className="space-y-1">
            <p className="text-xs font-semibold text-muted-foreground">Status Timeline</p>
            <div className="flex flex-wrap gap-1.5">
              {STATUS_FLOW.map((s, i) => {
                const Icon = s.icon;
                const isDone = i <= currentIndex;
                return (
                  <Badge key={s.key} variant="outline" className={`text-[9px] gap-0.5 ${isDone ? 'bg-primary/10 text-primary border-primary/30' : ''}`}>
                    <Icon size={8} /> {s.label}
                  </Badge>
                );
              })}
            </div>
          </div>

          {ticket.assigned_to_name && (
            <p className="text-xs"><span className="text-muted-foreground">Assigned to:</span> {ticket.assigned_to_name}</p>
          )}

          {/* Resolution Outcome */}
          {ticket.resolution_note && ['fixed', 'verified', 'closed'].includes(ticket.status) && (
            <div className="px-3 py-2.5 rounded-lg bg-success/10 border border-success/20">
              <p className="text-[10px] font-semibold text-success mb-0.5">Fix details:</p>
              <p className="text-xs text-foreground">{ticket.resolution_note}</p>
            </div>
          )}

          {/* Admin Controls */}
          {isAdmin && !['verified', 'closed'].includes(ticket.status) && (
            <div className="space-y-2 border-t border-border pt-3">
              <p className="text-xs font-semibold">Admin Actions</p>
              {ticket.status === 'reported' && (
                <Button size="sm" className="w-full" onClick={() => handleStatusUpdate('acknowledged')}>
                  Acknowledge
                </Button>
              )}
              {['acknowledged', 'reported'].includes(ticket.status) && (
                <div className="flex gap-2">
                  <Input
                    value={assignee}
                    onChange={(e) => setAssignee(e.target.value)}
                    placeholder="Contractor name"
                    className="text-xs h-8"
                  />
                  <Button size="sm" className="h-8" disabled={!assignee.trim()} onClick={() => handleStatusUpdate('contractor_assigned')}>
                    Assign
                  </Button>
                </div>
              )}
              {['contractor_assigned', 'in_progress'].includes(ticket.status) && (
                <div className="space-y-2">
                  <Input
                    value={resolutionNote}
                    onChange={(e) => setResolutionNote(e.target.value)}
                    placeholder="Fix details (shown to resident)..."
                    className="text-xs h-8"
                  />
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" className="flex-1" onClick={() => handleStatusUpdate('in_progress')}>
                      Mark In Progress
                    </Button>
                    <Button size="sm" className="flex-1" onClick={() => handleStatusUpdate('fixed')}>
                      Mark Fixed
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Resident Controls */}
          {isReporter && ticket.status === 'fixed' && (
            <div className="flex gap-2 border-t border-border pt-3">
              <Button size="sm" variant="outline" className="flex-1 gap-1" onClick={handleReopen}>
                <RotateCcw size={12} /> Reopen
              </Button>
              <Button size="sm" className="flex-1 gap-1" onClick={handleVerify}>
                <CheckCircle2 size={12} /> Verify Fix
              </Button>
            </div>
          )}
        </div>
      </DrawerContent>
    </Drawer>
  );
}
