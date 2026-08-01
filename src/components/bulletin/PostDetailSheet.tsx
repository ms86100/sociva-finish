// @ts-nocheck
import { useState, useEffect } from 'react';
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from '@/components/ui/drawer';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { formatDistanceToNow } from 'date-fns';
import { 
  ArrowBigUp, Send, Calendar, MapPin, Users, Pin, Loader2 
} from 'lucide-react';
import { CATEGORY_CONFIG } from './CategoryFilter';
import type { BulletinPost } from './PostCard';

interface Comment {
  id: string;
  body: string;
  created_at: string;
  author?: { name: string; block: string; flat_number: string };
}

interface PostDetailSheetProps {
  post: BulletinPost | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onVote: (postId: string) => void;
}

export function PostDetailSheet({ post, open, onOpenChange, onVote }: PostDetailSheetProps) {
  const { user } = useAuth();
  const [comments, setComments] = useState<Comment[]>([]);
  const [newComment, setNewComment] = useState('');
  const [sending, setSending] = useState(false);
  const [loadingComments, setLoadingComments] = useState(false);

  // RSVP state
  const [rsvpStatus, setRsvpStatus] = useState<string | null>(null);
  const [rsvpCount, setRsvpCount] = useState(0);

  useEffect(() => {
    if (post && open) {
      fetchComments();
      if (post.rsvp_enabled) fetchRsvpData();
    }
  }, [post?.id, open]);

  const fetchComments = async () => {
    if (!post) return;
    setLoadingComments(true);
    const { data } = await supabase
      .from('bulletin_comments')
      .select('id, body, created_at, author:profiles!bulletin_comments_author_id_fkey(name, block, flat_number)')
      .eq('post_id', post.id)
      .order('created_at', { ascending: true });
    setComments((data as any) || []);
    setLoadingComments(false);
  };

  const fetchRsvpData = async () => {
    if (!post || !user) return;
    const { data: myRsvp } = await supabase
      .from('bulletin_rsvps')
      .select('status')
      .eq('post_id', post.id)
      .eq('user_id', user.id)
      .maybeSingle();
    setRsvpStatus(myRsvp?.status || null);

    const { count } = await supabase
      .from('bulletin_rsvps')
      .select('*', { count: 'exact', head: true })
      .eq('post_id', post.id)
      .eq('status', 'going');
    setRsvpCount(count || 0);
  };

  const handleSendComment = async () => {
    if (!newComment.trim() || !post || !user) return;
    setSending(true);
    const { error } = await supabase.from('bulletin_comments').insert({
      post_id: post.id,
      author_id: user.id,
      body: newComment.trim(),
    });
    if (error) {
      toast({ title: 'Failed to comment', variant: 'destructive' });
    } else {
      setNewComment('');
      await fetchComments();
      // BULLETIN-02 FIX: Update comment_count on the post so the header stays in sync
      if (post) {
        post.comment_count = (post.comment_count || 0) + 1;
      }
    }
    setSending(false);
  };

  const handleRsvp = async (status: string) => {
    if (!post || !user) return;
    if (rsvpStatus) {
      await supabase
        .from('bulletin_rsvps')
        .update({ status })
        .eq('post_id', post.id)
        .eq('user_id', user.id);
    } else {
      await supabase.from('bulletin_rsvps').insert({
        post_id: post.id,
        user_id: user.id,
        status,
      });
    }
    setRsvpStatus(status);
    fetchRsvpData();
  };

  // Poll voting
  const handlePollVote = async (optionId: string) => {
    if (!post || !user) return;
    // Check if poll deadline has passed
    if (post.poll_deadline && new Date(post.poll_deadline) < new Date()) {
      toast({ title: 'Voting has ended', variant: 'destructive' });
      return;
    }
    const { error } = await supabase.from('bulletin_votes').insert({
      post_id: post.id,
      user_id: user.id,
      poll_option_id: optionId,
      vote_type: 'poll',
    });
    if (error) {
      if (error.code === '23505') {
        toast({ title: 'You already voted', variant: 'destructive' });
      }
    } else {
      toast({ title: 'Vote recorded!' });
    }
  };

  if (!post) return null;
  const cat = CATEGORY_CONFIG[post.category] || CATEGORY_CONFIG.alert;
  const CatIcon = cat.icon;

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent className="max-h-[90vh] overflow-y-auto">
        <DrawerHeader>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className={cn('text-[10px] gap-1', cat.bg, cat.color)}>
              <CatIcon size={10} />
              {cat.label}
            </Badge>
            {post.is_pinned && <Pin size={12} className="text-primary fill-primary" />}
          </div>
          <DrawerTitle className="text-left">{post.title}</DrawerTitle>
          <div className="text-xs text-muted-foreground">
            {post.author?.name} · {post.author?.block}-{post.author?.flat_number} · {formatDistanceToNow(new Date(post.created_at), { addSuffix: true })}
          </div>
        </DrawerHeader>

        <div className="mt-4 space-y-4">
          {/* Body */}
          {post.body && <p className="text-sm text-foreground whitespace-pre-wrap">{post.body}</p>}

          {/* Images */}
          {post.attachment_urls?.length > 0 && (
            <div className="grid grid-cols-2 gap-2">
              {post.attachment_urls.map((url, i) => (
                <img key={i} src={url} alt="" className="w-full rounded-lg object-cover max-h-48 border border-border" loading="lazy" />
              ))}
            </div>
          )}

          {/* Event details */}
          {post.category === 'event' && (
            <div className="p-3 rounded-lg bg-muted/50 space-y-2">
              {post.event_date && (
                <div className="flex items-center gap-2 text-sm">
                  <Calendar size={14} className="text-primary" />
                  {new Date(post.event_date).toLocaleString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })}
                </div>
              )}
              {post.event_location && (
                <div className="flex items-center gap-2 text-sm">
                  <MapPin size={14} className="text-primary" />
                  {post.event_location}
                </div>
              )}
              {post.rsvp_enabled && (
                <div className="space-y-2">
                  <div className="flex items-center gap-1 text-xs text-muted-foreground">
                    <Users size={12} /> {rsvpCount} going
                  </div>
                  <div className="flex gap-2">
                    {['going', 'maybe', 'not_going'].map(s => (
                      <Button
                        key={s}
                        size="sm"
                        variant={rsvpStatus === s ? 'default' : 'outline'}
                        className="text-xs capitalize"
                        onClick={() => handleRsvp(s)}
                      >
                        {s.replace('_', ' ')}
                      </Button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Poll */}
          {post.category === 'poll' && post.poll_options && Array.isArray(post.poll_options) && (
            <div className="space-y-2">
              {(post.poll_options as any[]).map((opt: any) => (
                <button
                  key={opt.id}
                  onClick={() => handlePollVote(opt.id)}
                  className="w-full text-left p-3 rounded-lg border border-border hover:border-primary/50 transition-colors text-sm"
                >
                  {opt.text}
                </button>
              ))}
              {post.poll_deadline && (
                <p className="text-xs text-muted-foreground">
                  Voting ends {formatDistanceToNow(new Date(post.poll_deadline), { addSuffix: true })}
                </p>
              )}
            </div>
          )}

          {/* Upvote */}
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className={cn('gap-1', post.user_has_voted && 'text-primary border-primary')}
              onClick={() => onVote(post.id)}
            >
              <ArrowBigUp size={16} className={post.user_has_voted ? 'fill-primary' : ''} />
              {post.vote_count} Upvotes
            </Button>
          </div>

          <Separator />

          {/* Comments */}
          <div className="space-y-3">
            <h4 className="font-medium text-sm">Comments ({post.comment_count})</h4>
            {loadingComments ? (
              <div className="flex justify-center py-4"><Loader2 className="animate-spin text-muted-foreground" /></div>
            ) : comments.length === 0 ? (
              <p className="text-xs text-muted-foreground text-center py-4">No comments yet. Be the first!</p>
            ) : (
              comments.map(c => (
                <div key={c.id} className="space-y-1">
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs font-medium text-foreground">{c.author?.name}</span>
                    <span className="text-[10px] text-muted-foreground">
                      {c.author?.block}-{c.author?.flat_number} · {formatDistanceToNow(new Date(c.created_at), { addSuffix: true })}
                    </span>
                  </div>
                  <p className="text-sm text-foreground">{c.body}</p>
                </div>
              ))
            )}
          </div>

          {/* Comment input */}
          <div className="flex gap-2 sticky bottom-0 bg-background pt-2">
            <Input
              value={newComment}
              onChange={e => setNewComment(e.target.value)}
              placeholder="Write a comment..."
              onKeyDown={e => e.key === 'Enter' && handleSendComment()}
            />
            <Button size="icon" onClick={handleSendComment} disabled={sending || !newComment.trim()}>
              {sending ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
            </Button>
          </div>
        </div>
      </DrawerContent>
    </Drawer>
  );
}
