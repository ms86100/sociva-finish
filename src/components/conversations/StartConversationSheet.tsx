// @ts-nocheck
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader2, MessageCircle } from 'lucide-react';
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from '@/components/ui/drawer';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { useConversationActions } from '@/hooks/useConversations';
import { friendlyError } from '@/lib/utils';
import { toast } from 'sonner';

interface StartConversationSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  targetUserId: string;
  targetName?: string | null;
  contextPostId?: string | null;
  contextPostTitle?: string | null;
  contextPostCategory?: string | null;
}

export function StartConversationSheet({
  open,
  onOpenChange,
  targetUserId,
  targetName,
  contextPostId,
  contextPostTitle,
  contextPostCategory,
}: StartConversationSheetProps) {
  const navigate = useNavigate();
  const { openOrRequest } = useConversationActions();
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  const handleSend = async () => {
    const body = message.trim();
    if (!body || busy) return;
    setBusy(true);
    try {
      const result = await openOrRequest.mutateAsync({
        targetUserId,
        firstMessage: body,
        contextPostId: contextPostId || null,
        idempotencyKey: crypto.randomUUID(),
      });
      onOpenChange(false);
      setMessage('');
      toast.success(result.status === 'pending' ? 'Message request sent' : 'Message sent');
      navigate(`/messages/${result.conversation_id}`);
    } catch (e: any) {
      toast.error(friendlyError(e) || 'Could not start conversation');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent className="max-h-[85vh]">
        <DrawerHeader>
          <DrawerTitle className="text-left flex items-center gap-2">
            <MessageCircle size={18} className="text-primary" />
            Message {targetName || 'neighbour'}
          </DrawerTitle>
        </DrawerHeader>
        <div className="px-4 pb-6 space-y-3">
          {contextPostTitle && (
            <div className="rounded-xl border border-border bg-muted/40 px-3 py-2">
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                Regarding Smart Groups post
              </p>
              <p className="text-sm font-medium">{contextPostTitle}</p>
              {contextPostCategory && (
                <Badge variant="outline" className="mt-1 text-[10px]">
                  {contextPostCategory.replace(/_/g, ' ')}
                </Badge>
              )}
            </div>
          )}
          <Textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="Write a short private message..."
            rows={4}
            maxLength={4000}
          />
          <p className="text-[11px] text-muted-foreground">
            If you have not messaged this neighbour before, they will get a message request first.
          </p>
          <Button className="w-full" disabled={!message.trim() || busy} onClick={handleSend}>
            {busy ? <Loader2 className="animate-spin" size={16} /> : 'Send'}
          </Button>
        </div>
      </DrawerContent>
    </Drawer>
  );
}
