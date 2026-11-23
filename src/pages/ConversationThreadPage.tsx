// @ts-nocheck
import { useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { format } from 'date-fns';
import {
  Camera,
  Check,
  ImagePlus,
  Loader2,
  MoreVertical,
  Pencil,
  Send,
  X,
} from 'lucide-react';
import { AppLayout } from '@/components/layout/AppLayout';
import { BackButton } from '@/components/navigation/BackButton';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { FeatureGate } from '@/components/ui/FeatureGate';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn, friendlyError } from '@/lib/utils';
import { useAuth } from '@/contexts/AuthContext';
import {
  useConversationComposerFiles,
  useConversationThread,
} from '@/hooks/useConversationThread';
import { useConversationActions } from '@/hooks/useConversations';
import { useChatViewport } from '@/hooks/useChatViewport';
import { toast } from 'sonner';

const QUICK_EMOJI = ['🙏', '👍', '😊', '🔥', '✅', '🏠', '⭐', '😅'];

export default function ConversationThreadPage() {
  const { conversationId } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { meta, metaLoading, messages, isLoading, sendMessage, editMessage, deleteMessage } =
    useConversationThread(conversationId);
  const { respondRequest, blockUser } = useConversationActions();
  const { files, addFiles, removeFile, clearFiles } = useConversationComposerFiles();
  const { keyboardInset } = useChatViewport(true);
  const [text, setText] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const otherName = meta?.other?.name || 'Neighbour';
  const isIncomingRequest = meta?.conv?.status === 'pending' && meta?.conv?.created_by !== user?.id;
  const isOutgoingPending = meta?.conv?.status === 'pending' && meta?.conv?.created_by === user?.id;
  const canCompose = meta?.conv?.status === 'active';

  const previews = useMemo(
    () => files.map((f) => ({ name: f.name, url: URL.createObjectURL(f) })),
    [files],
  );

  const handleSend = async () => {
    const body = text.trim();
    if ((!body && files.length === 0) || sendMessage.isPending) return;
    try {
      if (editingId) {
        await editMessage.mutateAsync({ messageId: editingId, body });
        setEditingId(null);
        setText('');
        toast.success('Message updated');
        return;
      }
      await sendMessage.mutateAsync({ body, files });
      setText('');
      clearFiles();
      requestAnimationFrame(() => {
        scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
      });
    } catch (e: any) {
      toast.error(friendlyError(e) || 'Could not send');
    }
  };

  const startEdit = (id: string, body: string) => {
    setEditingId(id);
    setText(body);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setText('');
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteMessage.mutateAsync(id);
      toast.success('Message deleted');
    } catch (e: any) {
      toast.error(friendlyError(e) || 'Could not delete');
    }
  };

  const handleAccept = async () => {
    try {
      await respondRequest.mutateAsync({ conversationId: conversationId!, accept: true });
      toast.success('Request accepted');
    } catch (e: any) {
      toast.error(friendlyError(e) || 'Could not accept');
    }
  };

  const handleDecline = async () => {
    try {
      await respondRequest.mutateAsync({ conversationId: conversationId!, accept: false });
      toast.success('Request declined');
      navigate('/messages', { replace: true });
    } catch (e: any) {
      toast.error(friendlyError(e) || 'Could not decline');
    }
  };

  const handleBlock = async () => {
    if (!meta?.other?.id) return;
    try {
      await blockUser.mutateAsync(meta.other.id);
      toast.success('Neighbour blocked');
      navigate('/messages', { replace: true });
    } catch (e: any) {
      toast.error(friendlyError(e) || 'Could not block');
    }
  };

  return (
    <FeatureGate feature="conversations">
      <AppLayout showNav={false} showHeader={false} showCart={false}>
        <div
          className="flex flex-col h-[calc(100dvh-0px)] max-h-[100dvh]"
          style={{ paddingBottom: keyboardInset ? `${keyboardInset}px` : undefined }}
        >
          <div className="flex items-center gap-2 px-3 py-2 border-b bg-card shrink-0">
            <BackButton fallback="/messages" />
            <div className="min-w-0 flex-1">
              <p className="font-semibold text-sm truncate">{otherName}</p>
              <p className="text-[11px] text-muted-foreground truncate">
                {[meta?.other?.block, meta?.other?.flat_number].filter(Boolean).join('-')
                  || (metaLoading ? 'Loading...' : 'Society neighbour')}
              </p>
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" aria-label="Conversation options">
                  <MoreVertical size={18} />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={handleBlock} className="text-destructive">
                  Block neighbour
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          {meta?.contextPost && (
            <Link
              to={`/community?post=${meta.contextPost.id}`}
              className="mx-3 mt-2 rounded-xl border border-border bg-muted/40 px-3 py-2 block"
            >
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                Regarding Smart Groups post
              </p>
              <p className="text-sm font-medium truncate">{meta.contextPost.title || 'Original post'}</p>
              {meta.contextPost.category && (
                <Badge variant="outline" className="mt-1 text-[10px]">
                  {meta.contextPost.category.replace(/_/g, ' ')}
                </Badge>
              )}
            </Link>
          )}

          {isIncomingRequest && (
            <div className="mx-3 mt-2 rounded-xl border border-primary/30 bg-primary/5 p-3 space-y-2">
              <p className="text-sm font-medium">{otherName} wants to message you</p>
              <p className="text-xs text-muted-foreground">
                Accept to continue privately. Decline to ignore.
              </p>
              <div className="flex gap-2">
                <Button size="sm" className="flex-1" onClick={handleAccept}>Accept</Button>
                <Button size="sm" variant="outline" className="flex-1" onClick={handleDecline}>Decline</Button>
              </div>
            </div>
          )}

          {isOutgoingPending && (
            <div className="mx-3 mt-2 rounded-xl border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
              Message request sent. Waiting for {otherName} to accept.
            </div>
          )}

          <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto px-3 py-3 space-y-2">
            {isLoading && (
              <p className="text-xs text-muted-foreground text-center py-8">Loading messages...</p>
            )}
            {!isLoading && messages.length === 0 && (
              <p className="text-xs text-muted-foreground text-center py-8">No messages yet</p>
            )}
            {messages.map((m) => {
              const mine = m.sender_id === user?.id;
              const deleted = !!m.deleted_at;
              const editable =
                mine
                && !deleted
                && Date.now() - new Date(m.created_at).getTime() < 15 * 60 * 1000;

              return (
                <div key={m.id} className={cn('flex', mine ? 'justify-end' : 'justify-start')}>
                  <div
                    className={cn(
                      'max-w-[82%] rounded-2xl px-3 py-2 text-sm space-y-1',
                      mine ? 'bg-primary text-primary-foreground rounded-br-md' : 'bg-muted rounded-bl-md',
                    )}
                  >
                    {deleted ? (
                      <p className="italic opacity-70 text-xs">Message deleted</p>
                    ) : (
                      <>
                        {m.attachments?.map((a) => (
                          <img
                            key={a.id}
                            src={a.public_url}
                            alt=""
                            className="rounded-lg max-h-48 w-full object-cover"
                            loading="lazy"
                          />
                        ))}
                        {m.body && <p className="whitespace-pre-wrap break-words">{m.body}</p>}
                        <div className={cn('flex items-center gap-2 text-[10px]', mine ? 'opacity-80' : 'text-muted-foreground')}>
                          <span>{format(new Date(m.created_at), 'h:mm a')}</span>
                          {m.edited_at && <span>edited</span>}
                          {editable && (
                            <>
                              <button type="button" className="underline" onClick={() => startEdit(m.id, m.body)}>
                                Edit
                              </button>
                              <button type="button" className="underline" onClick={() => handleDelete(m.id)}>
                                Delete
                              </button>
                            </>
                          )}
                        </div>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {canCompose && (
            <div className="border-t bg-background px-3 py-2 space-y-2 shrink-0">
              {editingId && (
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Pencil size={12} />
                  Editing message
                  <button type="button" className="ml-auto" onClick={cancelEdit} aria-label="Cancel edit">
                    <X size={14} />
                  </button>
                </div>
              )}

              {previews.length > 0 && (
                <div className="flex gap-2 overflow-x-auto">
                  {previews.map((p, i) => (
                    <div key={p.url} className="relative shrink-0">
                      <img src={p.url} alt="" className="h-16 w-16 rounded-lg object-cover border" />
                      <button
                        type="button"
                        className="absolute -top-1 -right-1 bg-background rounded-full border p-0.5"
                        onClick={() => removeFile(i)}
                        aria-label="Remove image"
                      >
                        <X size={12} />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              <div className="flex gap-1 overflow-x-auto pb-1">
                {QUICK_EMOJI.map((e) => (
                  <button
                    key={e}
                    type="button"
                    className="text-lg px-1.5 rounded hover:bg-muted"
                    onClick={() => setText((t) => `${t}${e}`)}
                  >
                    {e}
                  </button>
                ))}
              </div>

              <div className="flex items-end gap-2">
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*"
                  multiple
                  className="hidden"
                  onChange={(e) => {
                    addFiles(e.target.files);
                    e.target.value = '';
                  }}
                />
                <input
                  ref={cameraRef}
                  type="file"
                  accept="image/*"
                  capture="environment"
                  className="hidden"
                  onChange={(e) => {
                    addFiles(e.target.files);
                    e.target.value = '';
                  }}
                />
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  onClick={() => fileRef.current?.click()}
                  aria-label="Attach photo"
                >
                  <ImagePlus size={18} />
                </Button>
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  onClick={() => cameraRef.current?.click()}
                  aria-label="Take photo"
                >
                  <Camera size={18} />
                </Button>
                <Textarea
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  placeholder="Write a message..."
                  className="min-h-[44px] max-h-[120px] resize-none"
                  rows={1}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      handleSend();
                    }
                  }}
                />
                <Button
                  type="button"
                  size="icon"
                  onClick={handleSend}
                  disabled={sendMessage.isPending || editMessage.isPending || (!text.trim() && files.length === 0)}
                  aria-label="Send"
                >
                  {sendMessage.isPending || editMessage.isPending ? (
                    <Loader2 size={16} className="animate-spin" />
                  ) : editingId ? (
                    <Check size={16} />
                  ) : (
                    <Send size={16} />
                  )}
                </Button>
              </div>
              <p className="text-[10px] text-muted-foreground text-center">
                Photos and emoji supported. Video not available yet.
              </p>
            </div>
          )}
        </div>
      </AppLayout>
    </FeatureGate>
  );
}
