// @ts-nocheck
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { useTicketMessages, useSendTicketMessage, useResolveTicket, type SupportTicket } from '@/hooks/useSupportTickets';
import { useAuth } from '@/contexts/AuthContext';
import { CheckCircle2, Clock, AlertTriangle, Send, Loader2 } from 'lucide-react';
import { formatDistanceToNow, format } from 'date-fns';
import { cn } from '@/lib/utils';

interface SupportTicketDetailProps {
  ticket: SupportTicket | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  viewRole: 'buyer' | 'seller';
}

const ISSUE_LABELS: Record<string, string> = {
  late_delivery: 'Late delivery',
  missing_item: 'Missing item',
  wrong_item: 'Wrong item',
  payment_issue: 'Payment issue',
  cancel_request: 'Cancel request',
  other: 'Other issue',
};

export function SupportTicketDetail({ ticket, open, onOpenChange, viewRole }: SupportTicketDetailProps) {
  const { user } = useAuth();
  const { data: messages = [], isLoading } = useTicketMessages(ticket?.id);
  const sendMessage = useSendTicketMessage();
  const resolveTicket = useResolveTicket();
  const [newMessage, setNewMessage] = useState('');
  const [rejectReason, setRejectReason] = useState('');
  const [showReject, setShowReject] = useState(false);

  if (!ticket) return null;

  const isActive = ['open', 'seller_pending'].includes(ticket.status);

  const handleSend = async () => {
    if (!newMessage.trim() || !user) return;
    await sendMessage.mutateAsync({
      ticket_id: ticket.id,
      sender_id: user.id,
      sender_type: viewRole,
      message_text: newMessage.trim(),
    });
    setNewMessage('');
  };

  const handleAccept = async () => {
    await resolveTicket.mutateAsync({ ticketId: ticket.id, action: 'accept' });
    onOpenChange(false);
  };

  const handleReject = async () => {
    await resolveTicket.mutateAsync({ ticketId: ticket.id, action: 'reject', note: rejectReason });
    setShowReject(false);
    setRejectReason('');
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="h-[85vh] flex flex-col p-0">
        <SheetHeader className="px-4 pt-4">
          <SheetTitle className="text-left">
            {ISSUE_LABELS[ticket.issue_type] || ticket.issue_type}
          </SheetTitle>
        </SheetHeader>

        {/* Status banner */}
        <div className={cn(
          'mx-4 mt-2 px-3 py-2 rounded-lg text-xs font-medium flex items-center gap-2',
          ticket.status === 'resolved' || ticket.status === 'auto_resolved'
            ? 'bg-emerald-500/10 text-emerald-600'
            : ticket.sla_breached
              ? 'bg-destructive/10 text-destructive'
              : 'bg-warning/10 text-warning'
        )}>
          {ticket.status === 'resolved' || ticket.status === 'auto_resolved' ? (
            <CheckCircle2 size={14} />
          ) : ticket.sla_breached ? (
            <AlertTriangle size={14} />
          ) : (
            <Clock size={14} />
          )}
          {ticket.status === 'resolved' ? 'Resolved' :
            ticket.status === 'auto_resolved' ? 'Auto-resolved' :
              ticket.sla_breached ? 'SLA breached — overdue' :
                'Awaiting response'}
          {ticket.resolution_note && (
            <span className="ml-1 font-normal">— {ticket.resolution_note}</span>
          )}
        </div>

        {/* Evidence */}
        {ticket.evidence_urls && ticket.evidence_urls.length > 0 && (
          <div className="px-4 mt-3 flex gap-2 overflow-x-auto">
            {ticket.evidence_urls.map((url, i) => (
              <img key={i} src={url} alt={`Evidence ${i + 1}`} className="w-16 h-16 rounded-lg object-cover border border-border shrink-0" />
            ))}
          </div>
        )}

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2">
          {messages.map((msg) => (
            <div
              key={msg.id}
              className={cn(
                'max-w-[85%] px-3 py-2 rounded-xl text-sm',
                msg.sender_type === 'system'
                  ? 'mx-auto bg-muted/50 text-muted-foreground text-center text-xs max-w-full'
                  : msg.sender_type === viewRole
                    ? 'ml-auto bg-primary text-primary-foreground'
                    : 'bg-muted'
              )}
            >
              <p>{msg.message_text}</p>
              <p className="text-[10px] opacity-60 mt-0.5">
                {format(new Date(msg.created_at), 'h:mm a')}
              </p>
            </div>
          ))}
        </div>

        {/* Actions */}
        {isActive && (
          <div className="border-t border-border p-3 space-y-2">
            {/* Seller actions */}
            {viewRole === 'seller' && ticket.status === 'seller_pending' && !showReject && (
              <div className="flex gap-2">
                <Button
                  size="sm"
                  className="flex-1"
                  onClick={handleAccept}
                  disabled={resolveTicket.isPending}
                >
                  <CheckCircle2 size={14} className="mr-1.5" />
                  Accept & Resolve
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setShowReject(true)}
                >
                  Request Info
                </Button>
              </div>
            )}

            {showReject && (
              <div className="space-y-2">
                <Textarea
                  placeholder="Ask the customer for clarification..."
                  value={rejectReason}
                  onChange={(e) => setRejectReason(e.target.value)}
                  rows={2}
                />
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" onClick={() => setShowReject(false)}>Cancel</Button>
                  <Button size="sm" onClick={handleReject} disabled={!rejectReason.trim() || resolveTicket.isPending}>Send</Button>
                </div>
              </div>
            )}

            {/* Message input */}
            {!showReject && (
              <div className="flex gap-2">
                <Textarea
                  placeholder="Type a message..."
                  value={newMessage}
                  onChange={(e) => setNewMessage(e.target.value)}
                  rows={1}
                  className="flex-1 min-h-[36px] text-sm resize-none"
                  onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
                />
                <Button
                  size="icon"
                  className="h-9 w-9 shrink-0"
                  onClick={handleSend}
                  disabled={!newMessage.trim() || sendMessage.isPending}
                >
                  {sendMessage.isPending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                </Button>
              </div>
            )}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
