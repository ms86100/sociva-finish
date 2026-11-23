// @ts-nocheck
import { useState, useEffect, useMemo } from 'react';
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from '@/components/ui/drawer';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { formatDistanceToNow } from 'date-fns';
import {
  ArrowBigUp, Send, Calendar, MapPin, Users, Pin, Loader2, Star, HandHelping, MessageCircle,
  Reply, Bug, Sparkles, X,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { CATEGORY_CONFIG } from './CategoryFilter';
import type { BulletinPost } from './PostCard';
import { showFeedback, useFeedbackPopup } from '@/components/FeedbackPopupProvider';
import { StartConversationSheet } from '@/components/conversations/StartConversationSheet';
import { useEffectiveFeatures } from '@/hooks/useEffectiveFeatures';
import { assessPeacekeeperTone } from '@/lib/peacekeeper';
import { IssueMeter } from './IssueMeter';
import {
  CONVERTIBLE_CATEGORIES,
  ISSUE_ASK_COMMITTEE_MIN,
  getConvertedSnagId,
  isMeterCategory,
  snagDeepLink,
} from '@/lib/community-issue';

interface Comment {
  id: string;
  body: string;
  created_at: string;
  is_recommendation?: boolean;
  author_id?: string;
  parent_id?: string | null;
  author?: { name: string; block: string; flat_number: string };
}

interface PostDetailSheetProps {
  post: BulletinPost | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onVote: (postId: string) => void;
  onPostUpdated?: () => void;
}

const SUMMARY_COMMENT_THRESHOLD = 5;

export function PostDetailSheet({ post, open, onOpenChange, onVote, onPostUpdated }: PostDetailSheetProps) {
  const { user, isSocietyAdmin, isAdmin } = useAuth();
  const { isFeatureEnabled } = useEffectiveFeatures();
  const conversationsOn = isFeatureEnabled('conversations');
  const [comments, setComments] = useState<Comment[]>([]);
  const [newComment, setNewComment] = useState('');
  const [sending, setSending] = useState(false);
  const [loadingComments, setLoadingComments] = useState(false);
  const [helphubMatches, setHelphubMatches] = useState<any[]>([]);
  const [dmOpen, setDmOpen] = useState(false);
  const [dmTarget, setDmTarget] = useState<{ id: string; name?: string | null } | null>(null);
  const [replyTo, setReplyTo] = useState<Comment | null>(null);
  const [converting, setConverting] = useState(false);
  const [summarizing, setSummarizing] = useState(false);
  const [localSummary, setLocalSummary] = useState<string | null>(null);
  const [summaryHint, setSummaryHint] = useState<string | null>(null);
  const [peaceNudge, setPeaceNudge] = useState<{
    reason: string;
    calmerVersion: string;
    asRecommendation: boolean;
  } | null>(null);
  const [askingCommittee, setAskingCommittee] = useState(false);

  const [rsvpStatus, setRsvpStatus] = useState<string | null>(null);
  const [rsvpCount, setRsvpCount] = useState(0);

  const openDm = (id: string, name?: string | null) => {
    if (!id || id === user?.id) return;
    setDmTarget({ id, name });
    setDmOpen(true);
  };

  useEffect(() => {
    if (post && open) {
      setReplyTo(null);
      setPeaceNudge(null);
      setLocalSummary(post.ai_summary || null);
      setSummaryHint(null);
      fetchComments();
      if (post.rsvp_enabled) fetchRsvpData();
      fetchHelpHubMatches();
    }
  }, [post?.id, open]);

  const fetchComments = async () => {
    if (!post) return;
    setLoadingComments(true);
    const withAuthor = await supabase
      .from('bulletin_comments')
      .select('id, body, created_at, is_recommendation, author_id, parent_id, author:profiles!bulletin_comments_author_id_fkey(name, block, flat_number)')
      .eq('post_id', post.id)
      .order('created_at', { ascending: true });

    let rows: Comment[] = [];
    if (!withAuthor.error && withAuthor.data) {
      rows = (withAuthor.data as any) || [];
    } else {
      const plain = await supabase
        .from('bulletin_comments')
        .select('id, body, created_at, is_recommendation, author_id, parent_id')
        .eq('post_id', post.id)
        .order('created_at', { ascending: true });

      const plainRows = (plain.data as any[]) || [];
      const authorIds = [...new Set(plainRows.map((r) => r.author_id).filter(Boolean))];
      let authorsById: Record<string, { name?: string; block?: string; flat_number?: string }> = {};
      if (authorIds.length > 0) {
        const { data: profiles } = await supabase
          .from('profiles')
          .select('id, name, block, flat_number')
          .in('id', authorIds);
        for (const p of profiles || []) {
          authorsById[p.id] = p;
        }
      }
      rows = plainRows.map((r) => ({
        ...r,
        author: authorsById[r.author_id] || null,
      })) as any;
    }

    setComments(rows);
    setLoadingComments(false);

    // Auto-summarise when thread is lively and none cached (or stale)
    if (rows.length >= SUMMARY_COMMENT_THRESHOLD) {
      const summarisedAt =
        typeof post.structured?.summary_comment_count === 'number'
          ? post.structured.summary_comment_count
          : 0;
      const needsFresh =
        !post.ai_summary && !localSummary
          ? true
          : rows.length >= summarisedAt + 3;
      if (needsFresh) {
        maybeSummarize(post.id, false);
      }
    } else if (rows.length > 0 && rows.length < SUMMARY_COMMENT_THRESHOLD) {
      setSummaryHint(`Thread summary unlocks after ${SUMMARY_COMMENT_THRESHOLD} comments (${rows.length} so far).`);
    }
  };

  const maybeSummarize = async (postId: string, force = false) => {
    if (summarizing) return;
    setSummarizing(true);
    setSummaryHint(null);
    try {
      const { data, error } = await supabase.functions.invoke('summarize-thread', {
        body: { post_id: postId, force },
      });
      if (error) {
        setSummaryHint(error.message || 'Could not summarise this thread right now.');
        return;
      }
      if (data?.error) {
        setSummaryHint(String(data.error));
        return;
      }
      if (data?.reason && !data?.summary) {
        setSummaryHint(data.reason);
        return;
      }
      if (data?.summary) {
        setLocalSummary(data.summary);
        if (post) {
          post.ai_summary = data.summary;
          post.structured = {
            ...(post.structured || {}),
            summary_comment_count: data.comment_count || comments.length,
            summary_model: data.model,
          };
        }
      }
    } catch (err: any) {
      console.warn('[PostDetailSheet] summarize-thread failed', err);
      setSummaryHint(err?.message || 'Summarise failed. Try again in a moment.');
    } finally {
      setSummarizing(false);
    }
  };

  const fetchHelpHubMatches = async () => {
    if (!post || post.category !== 'find_help' || !post.service_category) {
      setHelphubMatches([]);
      return;
    }
    const { data } = await supabase
      .from('helphub_listings')
      .select('id, display_name, category, recommender_name, tower_or_block')
      .eq('society_id', post.society_id)
      .eq('category', post.service_category)
      .eq('status', 'active')
      .gt('expires_at', new Date().toISOString())
      .order('created_at', { ascending: false })
      .limit(5);
    setHelphubMatches(data || []);
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

  const insertComment = async (body: string, asRecommendation = false) => {
    if (!body.trim() || !post || !user) return;
    setSending(true);
    const parentId = replyTo?.id || null;
    // One level deep only: if replying to a child, attach to its parent
    const effectiveParent =
      parentId && replyTo?.parent_id ? replyTo.parent_id : parentId;

    const { error } = await supabase.from('bulletin_comments').insert({
      post_id: post.id,
      author_id: user.id,
      body: body.trim(),
      is_recommendation: asRecommendation,
      parent_id: effectiveParent,
    });
    if (error) {
      const { showFeedback } = useFeedbackPopup();
      showFeedback({
        title: asRecommendation ? 'Failed to recommend' : 'Failed to comment',
        variant: 'error'
      });
    } else {
      setNewComment('');
      setReplyTo(null);
      setPeaceNudge(null);
      if (post) {
        post.comment_count = (post.comment_count || 0) + 1;
        if (asRecommendation) {
          post.recommendation_count = (post.recommendation_count || 0) + 1;
        }
      }
      await fetchComments();
    }
    setSending(false);
  };

  const handleSendComment = async (asRecommendation = false) => {
    if (!newComment.trim() || !post || !user) return;
    if (!peaceNudge) {
      const tone = assessPeacekeeperTone(newComment);
      if (tone.needsNudge) {
        setPeaceNudge({
          reason: tone.reason,
          calmerVersion: tone.calmerVersion,
          asRecommendation,
        });
        return;
      }
    }
    await insertComment(newComment, asRecommendation);
  };

  const handleClosePost = async () => {
    if (!post || !user || post.author_id !== user.id) return;
    await supabase.from('bulletin_posts').update({ status: 'closed' }).eq('id', post.id);
    post.status = 'closed';
    showFeedback({ title: 'Marked as closed', variant: 'success' });
    onPostUpdated?.();
  };

  const handleConvertToIssue = async () => {
    if (!post || !user) return;
    setConverting(true);
    try {
      const { data, error } = await supabase.rpc('convert_bulletin_post_to_snag', {
        _post_id: post.id,
        _auto: false,
      });
      if (error) throw error;
      const snagId = data?.snag_id;
      const already = data?.already_converted;
      if (post.structured && typeof post.structured === 'object') {
        (post as any).structured = {
          ...(post as any).structured,
          converted_snag_id: snagId,
          snag_status: (post as any).structured?.snag_status || 'reported',
        };
      } else {
        (post as any).structured = { converted_snag_id: snagId, snag_status: 'reported' };
      }
      post.status = 'closed';
      showFeedback({
        title: already ? 'Already linked to an issue' : 'Converted to issue',
        variant: 'success',
      });
      onPostUpdated?.();
    } catch (err: any) {
      toast.error(err?.message || 'Could not convert to issue');
    } finally {
      setConverting(false);
    }
  };

  const handleAskCommittee = async () => {
    if (!post || !user) return;
    setAskingCommittee(true);
    try {
      const { data, error } = await supabase.rpc('request_committee_open_issue', {
        _post_id: post.id,
      });
      if (error) throw error;
      if (data?.already_converted) {
        showFeedback({ title: 'Already an issue', variant: 'success' });
      } else if (data?.rate_limited) {
        showFeedback({ title: 'Committee already notified today', variant: 'success' });
      } else {
        showFeedback({ title: 'Committee notified', variant: 'success' });
        (post as any).structured = {
          ...((post as any).structured || {}),
          ask_committee_at: new Date().toISOString(),
        };
      }
      onPostUpdated?.();
    } catch (err: any) {
      toast.error(err?.message || 'Could not notify committee');
    } finally {
      setAskingCommittee(false);
    }
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

  const handlePollVote = async (optionId: string) => {
    if (!post || !user) return;
    if (post.poll_deadline && new Date(post.poll_deadline) < new Date()) {
      const { showFeedback } = useFeedbackPopup();
      showFeedback({
        title: 'Voting has ended',
        variant: 'error'
      });
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
        const { showFeedback } = useFeedbackPopup();
        showFeedback({
          title: 'You already voted',
          variant: 'error'
        });
      }
    } else {
      const { showFeedback } = useFeedbackPopup();
      showFeedback({
        title: 'Vote recorded!',
        variant: 'success'
      });
    }
  };

  const threaded = useMemo(() => {
    const roots = comments.filter((c) => !c.parent_id);
    const byParent: Record<string, Comment[]> = {};
    for (const c of comments) {
      if (!c.parent_id) continue;
      if (!byParent[c.parent_id]) byParent[c.parent_id] = [];
      byParent[c.parent_id].push(c);
    }
    return roots.map((root) => ({
      root,
      children: byParent[root.id] || [],
    }));
  }, [comments]);

  const convertedSnagId = post ? getConvertedSnagId(post.structured) : null;

  const canConvert =
    post &&
    CONVERTIBLE_CATEGORIES.has(post.category) &&
    !convertedSnagId &&
    (user?.id === post.author_id || isSocietyAdmin || isAdmin);

  const canAskCommittee =
    post &&
    isMeterCategory(post.category) &&
    !convertedSnagId &&
    !!user &&
    user.id !== post.author_id &&
    !isSocietyAdmin &&
    !isAdmin &&
    (post.vote_count || 0) >= ISSUE_ASK_COMMITTEE_MIN;

  if (!post) return null;
  const cat = CATEGORY_CONFIG[post.category] || CATEGORY_CONFIG.alert;
  const CatIcon = cat.icon;

  const renderComment = (c: Comment, nested = false) => (
    <div key={c.id} className={cn('space-y-1', nested && 'ml-4 pl-3 border-l border-border')}>
      <div className="flex items-center gap-1.5 flex-wrap">
        <span className="text-xs font-medium text-foreground">{c.author?.name}</span>
        {c.is_recommendation && (
          <Badge variant="secondary" className="text-[10px] gap-0.5">
            <Star size={10} /> Recommend
          </Badge>
        )}
        <span className="text-[10px] text-muted-foreground">
          {c.author?.block}-{c.author?.flat_number} · {formatDistanceToNow(new Date(c.created_at), { addSuffix: true })}
        </span>
        {!nested && (
          <button
            type="button"
            className="text-[10px] text-muted-foreground font-medium inline-flex items-center gap-0.5 hover:text-primary"
            onClick={() => setReplyTo(c)}
          >
            <Reply size={10} /> Reply
          </button>
        )}
        {conversationsOn && c.author_id && c.author_id !== user?.id && (
          <button
            type="button"
            className="text-[10px] text-primary font-medium"
            onClick={() => openDm(c.author_id!, c.author?.name)}
          >
            {c.is_recommendation ? 'Discuss' : 'Message'}
          </button>
        )}
      </div>
      <p className="text-sm text-foreground">{c.body}</p>
    </div>
  );

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent className="max-h-[90vh] overflow-y-auto">
        <DrawerHeader>
          <div className="flex items-center gap-2 flex-wrap">
            <Badge variant="outline" className={cn('text-[10px] gap-1', cat.bg, cat.color)}>
              <CatIcon size={10} />
              {cat.label}
            </Badge>
            {post.is_pinned && <Pin size={12} className="text-primary fill-primary" />}
            {post.status === 'expired' && (
              <Badge variant="outline" className="text-[10px]">Expired</Badge>
            )}
            {post.status === 'closed' && (
              <Badge variant="outline" className="text-[10px]">Closed</Badge>
            )}
          </div>
          <DrawerTitle className="text-left">{post.title}</DrawerTitle>
          <div className="text-xs text-muted-foreground">
            {post.author?.name} · {post.author?.block}-{post.author?.flat_number} · {formatDistanceToNow(new Date(post.created_at), { addSuffix: true })}
          </div>
        </DrawerHeader>

        <div className="mt-4 space-y-4 px-1">
          {post.body && <p className="text-sm text-foreground whitespace-pre-wrap">{post.body}</p>}

          {(isMeterCategory(post.category) || convertedSnagId || post.category === 'find_help') && (
            <IssueMeter
              post={post}
              canConvert={!!canConvert}
              canAskCommittee={!!canAskCommittee}
              askingCommittee={askingCommittee}
              converting={converting}
              onAskCommittee={handleAskCommittee}
              onConvert={handleConvertToIssue}
            />
          )}

          {(localSummary || post.ai_summary || summarizing || summaryHint) && (
            <div className="rounded-xl border border-primary/20 bg-primary/5 p-3 space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-medium flex items-center gap-1.5 text-foreground">
                  <Sparkles size={12} className="text-primary" />
                  Thread summary
                </p>
                {comments.length >= SUMMARY_COMMENT_THRESHOLD && (
                  <button
                    type="button"
                    className="text-[10px] text-primary font-medium disabled:opacity-50"
                    disabled={summarizing}
                    onClick={() => maybeSummarize(post.id, true)}
                  >
                    {summarizing ? 'Updating...' : 'Refresh'}
                  </button>
                )}
              </div>
              {(localSummary || post.ai_summary) && (
                <p className="text-xs text-muted-foreground whitespace-pre-wrap">
                  {localSummary || post.ai_summary}
                </p>
              )}
              {summarizing && !(localSummary || post.ai_summary) && (
                <p className="text-[10px] text-muted-foreground flex items-center gap-1">
                  <Loader2 size={10} className="animate-spin" /> Summarising discussion...
                </p>
              )}
              {summaryHint && !(localSummary || post.ai_summary) && !summarizing && (
                <p className="text-[10px] text-muted-foreground">{summaryHint}</p>
              )}
            </div>
          )}

          {post.attachment_urls?.length > 0 && (
            <div className="grid grid-cols-2 gap-2">
              {post.attachment_urls.map((url, i) => (
                <img key={i} src={url} alt="" className="w-full rounded-lg object-cover max-h-48 border border-border" loading="lazy" />
              ))}
            </div>
          )}

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

          {helphubMatches.length > 0 && (
            <div className="rounded-xl border border-border p-3 space-y-2">
              <p className="text-sm font-medium flex items-center gap-1.5">
                <HandHelping size={14} className="text-primary" />
                Neighbours already recommend
              </p>
              <p className="text-[10px] text-muted-foreground">From HelpHub - not background-verified.</p>
              {helphubMatches.map((m) => (
                <Link
                  key={m.id}
                  to={`/help-hub/${m.id}`}
                  className="block rounded-lg bg-muted/50 px-3 py-2 text-sm hover:bg-muted"
                >
                  <span className="font-medium">{m.display_name}</span>
                  <span className="text-xs text-muted-foreground block">
                    {m.category}
                    {m.recommender_name ? ` · ${m.recommender_name}` : ''}
                  </span>
                </Link>
              ))}
            </div>
          )}

          <div className="flex items-center gap-2 flex-wrap">
            <Button
              variant="outline"
              size="sm"
              className={cn('gap-1', post.user_has_voted && 'text-primary border-primary')}
              onClick={() => onVote(post.id)}
            >
              <ArrowBigUp size={16} className={post.user_has_voted ? 'fill-primary' : ''} />
              {post.vote_count} Upvotes
            </Button>
            {conversationsOn && user?.id && post.author_id && user.id !== post.author_id && (
              <Button
                variant="default"
                size="sm"
                className="gap-1"
                onClick={() => openDm(post.author_id, post.author?.name)}
              >
                <MessageCircle size={14} />
                Message author
              </Button>
            )}
            {convertedSnagId && (
              <Button variant="secondary" size="sm" className="gap-1" asChild>
                <Link to={snagDeepLink(convertedSnagId)}>
                  <Bug size={14} />
                  View issue
                </Link>
              </Button>
            )}
            {user?.id === post.author_id && post.status !== 'closed' && post.status !== 'expired' && (
              <Button variant="outline" size="sm" onClick={handleClosePost}>
                Mark closed
              </Button>
            )}
          </div>

          <Separator />

          <div className="space-y-3">
            <h4 className="font-medium text-sm">
              Comments ({post.comment_count})
              {(post.recommendation_count || 0) > 0 ? ` · ${post.recommendation_count} recommendations` : ''}
            </h4>
            {loadingComments ? (
              <div className="flex justify-center py-4"><Loader2 className="animate-spin text-muted-foreground" /></div>
            ) : threaded.length === 0 ? (
              <p className="text-xs text-muted-foreground text-center py-4">No comments yet. Be the first!</p>
            ) : (
              threaded.map(({ root, children }) => (
                <div key={root.id} className="space-y-2">
                  {renderComment(root, false)}
                  {children.map((child) => renderComment(child, true))}
                </div>
              ))
            )}
          </div>

          <div className="sticky bottom-0 bg-background pt-2 space-y-2">
            {peaceNudge ? (
              <div className="rounded-xl border border-warning/30 bg-warning/10 p-3 space-y-2">
                <p className="text-sm font-medium text-foreground">{peaceNudge.reason}</p>
                <p className="text-xs text-muted-foreground">
                  You can still post as-is. A calmer version often gets better neighbour responses.
                </p>
                <p className="text-xs text-foreground whitespace-pre-wrap rounded-lg bg-background/80 border border-border p-2">
                  {peaceNudge.calmerVersion}
                </p>
                <div className="flex flex-col gap-1.5">
                  <Button
                    size="sm"
                    className="w-full"
                    disabled={sending}
                    onClick={() => {
                      setNewComment(peaceNudge.calmerVersion);
                      insertComment(peaceNudge.calmerVersion, peaceNudge.asRecommendation);
                    }}
                  >
                    {sending ? <Loader2 size={14} className="animate-spin" /> : 'Use calmer version'}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="w-full"
                    disabled={sending}
                    onClick={() => insertComment(newComment, peaceNudge.asRecommendation)}
                  >
                    Post as-is
                  </Button>
                  <Button size="sm" variant="ghost" className="w-full" onClick={() => setPeaceNudge(null)}>
                    Keep editing
                  </Button>
                </div>
              </div>
            ) : (
              <>
                {replyTo && (
                  <div className="flex items-center justify-between rounded-lg bg-muted/60 px-2.5 py-1.5 text-xs">
                    <span className="text-muted-foreground truncate">
                      Replying to <span className="font-medium text-foreground">{replyTo.author?.name || 'comment'}</span>
                    </span>
                    <button type="button" onClick={() => setReplyTo(null)} aria-label="Cancel reply">
                      <X size={14} className="text-muted-foreground" />
                    </button>
                  </div>
                )}
                <div className="flex gap-2">
                  <Input
                    value={newComment}
                    onChange={e => setNewComment(e.target.value)}
                    placeholder={
                      replyTo
                        ? 'Write a reply...'
                        : post.category === 'find_help'
                          ? 'Reply or recommend someone...'
                          : 'Write a comment...'
                    }
                    onKeyDown={e => e.key === 'Enter' && handleSendComment(false)}
                  />
                  <Button size="icon" onClick={() => handleSendComment(false)} disabled={sending || !newComment.trim()}>
                    {sending ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
                  </Button>
                </div>
                {!replyTo && (post.category === 'find_help' || post.category === 'recommendation') && (
                  <Button
                    variant="secondary"
                    size="sm"
                    className="w-full gap-1"
                    disabled={sending || !newComment.trim()}
                    onClick={() => handleSendComment(true)}
                  >
                    <Star size={14} />
                    Recommend
                  </Button>
                )}
              </>
            )}
          </div>
        </div>
      </DrawerContent>

      {dmTarget && (
        <StartConversationSheet
          open={dmOpen}
          onOpenChange={(next) => {
            setDmOpen(next);
            if (!next) setDmTarget(null);
          }}
          targetUserId={dmTarget.id}
          targetName={dmTarget.name}
          contextPostId={post.id}
          contextPostTitle={post.title}
          contextPostCategory={post.category}
        />
      )}
    </Drawer>
  );
}
