// @ts-nocheck
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from '@/components/ui/drawer';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { format } from 'date-fns';
import { toast } from 'sonner';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { CheckCircle2, RotateCcw, ShieldCheck, Clock, Wrench, AlertTriangle, MessageSquare } from 'lucide-react';
import { showFeedback } from '@/components/FeedbackPopupProvider';

/** Align with live snag_tickets status check */
const STATUS_FLOW = [
  { key: 'reported', label: 'Opened', icon: AlertTriangle },
  { key: 'acknowledged', label: 'In review', icon: Clock },
  { key: 'in_progress', label: 'Being fixed', icon: Wrench },
  { key: 'resolved', label: 'Confirm fix', icon: CheckCircle2 },
  { key: 'closed', label: 'Closed', icon: ShieldCheck },
];

export interface SnagTicket {
  id: string;
  unit_number?: string | null;
  flat_number?: string | null;
  category: string;
  description: string;
  title?: string | null;
  image_urls?: string[] | null;
  photo_urls?: string[] | null;
  status: string;
  assigned_to?: string | null;
  assigned_to_name?: string | null;
  acknowledged_at: string | null;
  resolved_at?: string | null;
  resolution_note: string | null;
  created_at: string;
  reported_by: string;
  source_post_id?: string | null;
  society_id?: string;
}

function unitLabel(ticket: SnagTicket) {
  return ticket.unit_number || ticket.flat_number || 'Unknown';
}

function photos(ticket: SnagTicket): string[] {
  return ticket.image_urls || ticket.photo_urls || [];
}

export function SnagDetailSheet({
  ticket, open, onOpenChange, onUpdated,
}: {
  ticket: SnagTicket | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onUpdated: () => void;
}) {
  const { user, isAdmin, isSocietyAdmin } = useAuth();
  const [assignee, setAssignee] = useState('');
  const [resolutionNote, setResolutionNote] = useState('');

  if (!ticket) return null;

  const isReporter = user?.id === ticket.reported_by;
  const canManage = isAdmin || isSocietyAdmin;
  const currentIndex = STATUS_FLOW.findIndex(s => s.key === ticket.status);
  const imageList = photos(ticket);

  const handleStatusUpdate = async (status: string) => {
    const updates: any = { status, updated_at: new Date().toISOString() };
    if (status === 'acknowledged') updates.acknowledged_at = new Date().toISOString();
    if (status === 'resolved' || status === 'closed') {
      updates.resolved_at = new Date().toISOString();
      if (resolutionNote.trim()) updates.resolution_note = resolutionNote.trim();
    }
    // Store contractor name in resolution_note prefix when assigning (no assigned_to_name column live)
    if (status === 'in_progress' && assignee.trim()) {
      updates.resolution_note = `Assigned: ${assignee.trim()}${resolutionNote.trim() ? ` - ${resolutionNote.trim()}` : ''}`;
    }

    const { error } = await supabase.from('snag_tickets').update(updates).eq('id', ticket.id);
    if (error) { toast.error('Failed to update'); return; }
    showFeedback({
      title: status === 'closed' ? 'Issue closed' : 'Status updated',
      variant: 'success',
    });
    onUpdated();
  };

  const handleVerify = () => handleStatusUpdate('resolved');
  const handleReopen = () => handleStatusUpdate('reported');
  const handleClose = () => handleStatusUpdate('closed');

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent className="max-h-[90vh] overflow-y-auto">
        <DrawerHeader><DrawerTitle>{ticket.title || 'Issue details'}</DrawerTitle></DrawerHeader>
        <div className="space-y-4 mt-4 px-4 pb-6">
          <div>
            <p className="text-sm">{ticket.description}</p>
            <p className="text-[10px] text-muted-foreground mt-1">
              Unit {unitLabel(ticket)} · {format(new Date(ticket.created_at), 'dd MMM yyyy, hh:mm a')}
            </p>
          </div>

          {ticket.source_post_id && (
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-muted/50 border border-border">
              <MessageSquare size={14} className="text-primary shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium text-foreground">From community post</p>
                <p className="text-[10px] text-muted-foreground">Opened from Smart Groups for transparency</p>
              </div>
              <Button size="sm" variant="outline" className="h-7 text-[11px]" asChild>
                <Link to="/bulletin">Open feed</Link>
              </Button>
            </div>
          )}

          {ticket.acknowledged_at ? (
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-success/10 border border-success/20">
              <ShieldCheck size={14} className="text-success" />
              <span className="text-xs text-success font-medium">
                Seen by committee - {format(new Date(ticket.acknowledged_at), 'MMM d, h:mm a')}
              </span>
            </div>
          ) : (
            (() => {
              const hoursSince = (Date.now() - new Date(ticket.created_at).getTime()) / 3600000;
              return hoursSince > 48 ? (
                <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-warning/10 border border-warning/20">
                  <AlertTriangle size={14} className="text-warning" />
                  <span className="text-xs text-warning font-medium">
                    Awaiting review - submitted {Math.floor(hoursSince / 24)} days ago
                  </span>
                </div>
              ) : null;
            })()
          )}

          {imageList.length > 0 && (
            <div className="grid grid-cols-3 gap-2">
              {imageList.map((url, i) => (
                <img key={i} src={url} alt={`Issue photo ${i + 1}`} className="w-full aspect-square object-cover rounded-lg border border-border" />
              ))}
            </div>
          )}

          <div className="space-y-1">
            <p className="text-xs font-semibold text-muted-foreground">Status trail</p>
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

          {ticket.resolution_note && ['resolved', 'closed', 'in_progress'].includes(ticket.status) && (
            <div className="px-3 py-2.5 rounded-lg bg-success/10 border border-success/20">
              <p className="text-[10px] font-semibold text-success mb-0.5">Update:</p>
              <p className="text-xs text-foreground">{ticket.resolution_note}</p>
            </div>
          )}

          {canManage && !['closed'].includes(ticket.status) && (
            <div className="space-y-2 border-t border-border pt-3">
              <p className="text-xs font-semibold">Committee actions</p>
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
                    placeholder="Contractor or team note"
                    className="text-xs h-8"
                  />
                  <Button size="sm" className="h-8" disabled={!assignee.trim()} onClick={() => handleStatusUpdate('in_progress')}>
                    Start work
                  </Button>
                </div>
              )}
              {ticket.status === 'in_progress' && (
                <div className="space-y-2">
                  <Input
                    value={resolutionNote}
                    onChange={(e) => setResolutionNote(e.target.value)}
                    placeholder="Fix details (shown to residents)..."
                    className="text-xs h-8"
                  />
                  <Button size="sm" className="w-full" onClick={() => handleStatusUpdate('resolved')}>
                    Mark resolved
                  </Button>
                </div>
              )}
              {ticket.status === 'resolved' && (
                <Button size="sm" className="w-full" onClick={handleClose}>
                  Close issue
                </Button>
              )}
            </div>
          )}

          {isReporter && ticket.status === 'in_progress' && (
            <div className="flex gap-2 border-t border-border pt-3">
              <Button size="sm" variant="outline" className="flex-1 gap-1" onClick={handleReopen}>
                <RotateCcw size={12} /> Reopen
              </Button>
              <Button size="sm" className="flex-1 gap-1" onClick={handleVerify}>
                <CheckCircle2 size={12} /> Confirm fix
              </Button>
            </div>
          )}

          {isReporter && ticket.status === 'resolved' && !canManage && (
            <div className="flex gap-2 border-t border-border pt-3">
              <Button size="sm" variant="outline" className="flex-1 gap-1" onClick={handleReopen}>
                <RotateCcw size={12} /> Reopen
              </Button>
              <p className="text-[10px] text-muted-foreground self-center">
                Waiting for committee to close
              </p>
            </div>
          )}
        </div>
      </DrawerContent>
    </Drawer>
  );
}
