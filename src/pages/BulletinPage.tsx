// @ts-nocheck
import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { AppLayout } from '@/components/layout/AppLayout';
import { FeatureGate } from '@/components/ui/FeatureGate';
import { CategoryFilter, type BulletinCategory, CATEGORY_CONFIG } from '@/components/bulletin/CategoryFilter';
import { PostCard, type BulletinPost } from '@/components/bulletin/PostCard';
import { CreatePostSheet } from '@/components/bulletin/CreatePostSheet';
import { SmartPostComposer } from '@/components/bulletin/SmartPostComposer';
import { PostDetailSheet } from '@/components/bulletin/PostDetailSheet';
import { MostDiscussedSection } from '@/components/bulletin/MostDiscussedSection';
import { HelpRequestCard, type HelpRequest } from '@/components/bulletin/HelpRequestCard';
import { CreateHelpSheet } from '@/components/bulletin/CreateHelpSheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from '@/components/ui/drawer';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/integrations/supabase/client';
import { escapeIlike } from '@/lib/query-utils';
import { useAuth } from '@/contexts/AuthContext';
import { useEffectiveFeatures } from '@/hooks/useEffectiveFeatures';
import { toast } from 'sonner';
import {
  Plus, Search, Loader2, Send, MessageCircle, Sparkles, Bell, Wrench, Heart, VolumeX,
} from 'lucide-react';
import { useRegisterScreenRefresh } from '@/hooks/usePullToRefresh';
import { useSearchPlaceholder } from '@/hooks/useSearchPlaceholder';
import { showFeedback } from '@/components/FeedbackPopupProvider';
import { getConvertedSnagId } from '@/lib/community-issue';

const LAST_VISIT_KEY = 'sociva_smart_groups_last_visit';

type CategoryPref = { category: string; mode: 'follow' | 'mute' };

export default function BulletinPage() {
  const { user, effectiveSocietyId } = useAuth();
  const { isFeatureEnabled } = useEffectiveFeatures();
  const smartGroups = isFeatureEnabled('smart_groups');
  const conversationsOn = isFeatureEnabled('conversations');

  const [activeTab, setActiveTab] = useState('board');
  const [category, setCategory] = useState<BulletinCategory>('all');
  const [posts, setPosts] = useState<BulletinPost[]>([]);
  const [mostDiscussed, setMostDiscussed] = useState<BulletinPost[]>([]);
  const [helpRequests, setHelpRequests] = useState<HelpRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const bulletinPlaceholder = useSearchPlaceholder('bulletin');
  const [showCreate, setShowCreate] = useState(false);
  const [showCreateHelp, setShowCreateHelp] = useState(false);
  const [selectedPost, setSelectedPost] = useState<BulletinPost | null>(null);
  const [selectedHelp, setSelectedHelp] = useState<HelpRequest | null>(null);
  const [userVotes, setUserVotes] = useState<Set<string>>(new Set());
  const [showResolved, setShowResolved] = useState(false);
  const [categoryPrefs, setCategoryPrefs] = useState<CategoryPref[]>([]);
  const [digestFilter, setDigestFilter] = useState<'none' | 'new' | 'alerts' | 'summarised'>('none');
  const [sinceVisitIso, setSinceVisitIso] = useState<string | null>(null);
  const [digest, setDigest] = useState({
    newSinceVisit: 0,
    openMaintenanceAlerts: 0,
    withSummary: 0,
    messageRequests: 0,
    openCommunityIssues: 0,
  });

  const [helpResponses, setHelpResponses] = useState<any[]>([]);
  const [newResponse, setNewResponse] = useState('');
  const [sendingResponse, setSendingResponse] = useState(false);

  const followedCats = categoryPrefs.filter((p) => p.mode === 'follow').map((p) => p.category);
  const mutedCats = new Set(categoryPrefs.filter((p) => p.mode === 'mute').map((p) => p.category));

  const fetchCategoryPrefs = useCallback(async () => {
    if (!user || !effectiveSocietyId) return;
    const { data } = await supabase
      .from('bulletin_category_prefs')
      .select('category, mode')
      .eq('user_id', user.id)
      .eq('society_id', effectiveSocietyId);
    setCategoryPrefs((data as CategoryPref[]) || []);
  }, [user, effectiveSocietyId]);

  const setCategoryMode = async (cat: string, mode: 'follow' | 'mute' | null) => {
    if (!user || !effectiveSocietyId) return;
    if (!mode) {
      await supabase
        .from('bulletin_category_prefs')
        .delete()
        .eq('user_id', user.id)
        .eq('society_id', effectiveSocietyId)
        .eq('category', cat);
    } else {
      await supabase.from('bulletin_category_prefs').upsert({
        user_id: user.id,
        society_id: effectiveSocietyId,
        category: cat,
        mode,
        updated_at: new Date().toISOString(),
      });
    }
    await fetchCategoryPrefs();
    showFeedback({
      title: mode === 'follow' ? `Following ${CATEGORY_CONFIG[cat]?.label || cat}`
        : mode === 'mute' ? `Muted ${CATEGORY_CONFIG[cat]?.label || cat}`
          : 'Preference cleared',
      variant: 'success',
    });
  };

  const fetchDigest = useCallback(async () => {
    if (!effectiveSocietyId || !smartGroups) return;
    const lastVisitRaw = localStorage.getItem(LAST_VISIT_KEY);
    const since = lastVisitRaw || new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    setSinceVisitIso(since);

    const [newRes, openRes, summaryRes, issueRes] = await Promise.all([
      supabase
        .from('bulletin_posts')
        .select('id', { count: 'exact', head: true })
        .eq('society_id', effectiveSocietyId)
        .eq('is_archived', false)
        .gte('created_at', since)
        .neq('status', 'expired'),
      supabase
        .from('bulletin_posts')
        .select('id', { count: 'exact', head: true })
        .eq('society_id', effectiveSocietyId)
        .eq('is_archived', false)
        .in('category', ['maintenance', 'alert'])
        .or('status.eq.open,status.is.null'),
      supabase
        .from('bulletin_posts')
        .select('id', { count: 'exact', head: true })
        .eq('society_id', effectiveSocietyId)
        .eq('is_archived', false)
        .not('ai_summary', 'is', null),
      supabase
        .from('snag_tickets')
        .select('id', { count: 'exact', head: true })
        .eq('society_id', effectiveSocietyId)
        .not('source_post_id', 'is', null)
        .neq('status', 'closed'),
    ]);

    let messageRequests = 0;
    if (conversationsOn) {
      try {
        const { data } = await supabase.rpc('conversations_unread_count');
        messageRequests = typeof data === 'number' ? data : (data?.total || data?.unread || 0);
      } catch {
        messageRequests = 0;
      }
    }

    setDigest({
      newSinceVisit: newRes.count || 0,
      openMaintenanceAlerts: openRes.count || 0,
      withSummary: summaryRes.count || 0,
      messageRequests: Number(messageRequests) || 0,
      openCommunityIssues: issueRes.count || 0,
    });

    localStorage.setItem(LAST_VISIT_KEY, new Date().toISOString());
  }, [effectiveSocietyId, smartGroups, conversationsOn]);

  const toggleDigestFilter = (next: 'new' | 'alerts' | 'summarised') => {
    setDigestFilter((prev) => (prev === next ? 'none' : next));
    if (next === 'alerts') setCategory('all');
  };

  const fetchPosts = useCallback(async (opts?: { silent?: boolean }) => {
    if (!effectiveSocietyId) return;
    if (!opts?.silent) setLoading(true);

    let query = supabase
      .from('bulletin_posts')
      .select('*, author:profiles!bulletin_posts_author_id_fkey(name, block, flat_number, avatar_url)')
      .eq('society_id', effectiveSocietyId)
      .order('is_pinned', { ascending: false })
      .order('created_at', { ascending: false });

    if (!showResolved) {
      query = query.eq('is_archived', false);
    }

    if (category === 'following') {
      if (followedCats.length === 0) {
        setPosts([]);
        setLoading(false);
        return;
      }
      const { data: mappedIds } = await supabase
        .from('bulletin_post_categories')
        .select('post_id')
        .in('category', followedCats);
      const ids = (mappedIds || []).map((r: any) => r.post_id);
      if (ids.length > 0) {
        query = query.or(`id.in.(${ids.join(',')}),category.in.(${followedCats.join(',')})`);
      } else {
        query = query.in('category', followedCats);
      }
    } else if (category !== 'all') {
      if (smartGroups) {
        const { data: mappedIds } = await supabase
          .from('bulletin_post_categories')
          .select('post_id')
          .eq('category', category);
        const ids = (mappedIds || []).map((r: any) => r.post_id);
        if (ids.length > 0) {
          query = query.or(`id.in.(${ids.join(',')}),category.eq.${category}`);
        } else {
          query = query.eq('category', category);
        }
      } else {
        query = query.eq('category', category);
      }
    }
    if (search.trim()) {
      const escaped = escapeIlike(search);
      query = query.or(`title.ilike.%${escaped}%,body.ilike.%${escaped}%`);
    }

    const { data, error } = await query;
    let rows: BulletinPost[] = [];
    if (error) {
      console.error('[BulletinPage] fetchPosts failed', error);
      let fallback = supabase
        .from('bulletin_posts')
        .select('*')
        .eq('society_id', effectiveSocietyId)
        .order('is_pinned', { ascending: false })
        .order('created_at', { ascending: false });
      if (!showResolved) fallback = fallback.eq('is_archived', false);
      if (category !== 'all' && category !== 'following') fallback = fallback.eq('category', category);
      if (search.trim()) {
        const escaped = escapeIlike(search);
        fallback = fallback.or(`title.ilike.%${escaped}%,body.ilike.%${escaped}%`);
      }
      const { data: plain } = await fallback;
      rows = (plain as any) || [];
    } else {
      rows = (data as any) || [];
    }

    // Client-side: hide expired unless Show resolved (avoids clashing .or filters)
    if (!showResolved) {
      rows = rows.filter((p) => p.status !== 'expired');
    }

    // Drop muted categories from All (and Following already scoped)
    if (category === 'all' && mutedCats.size > 0) {
      rows = rows.filter((p) => !mutedCats.has(p.category));
    }

    setPosts(rows);
    setLoading(false);
  }, [effectiveSocietyId, category, search, smartGroups, showResolved, followedCats.join(','), [...mutedCats].join(',')]);

  const fetchMostDiscussed = useCallback(async () => {
    if (!effectiveSocietyId) return;
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);

    const { data, error } = await supabase
      .from('bulletin_posts')
      .select('*, author:profiles!bulletin_posts_author_id_fkey(name, block, flat_number, avatar_url)')
      .eq('society_id', effectiveSocietyId)
      .eq('is_archived', false)
      .gte('created_at', yesterday.toISOString())
      .order('comment_count', { ascending: false })
      .limit(5);

    if (error) {
      const { data: plain } = await supabase
        .from('bulletin_posts')
        .select('*')
        .eq('society_id', effectiveSocietyId)
        .eq('is_archived', false)
        .gte('created_at', yesterday.toISOString())
        .order('comment_count', { ascending: false })
        .limit(5);
      setMostDiscussed(((plain as any) || []).filter((p: any) => p.comment_count > 0 && p.status !== 'expired'));
      return;
    }

    setMostDiscussed(((data as any) || []).filter((p: any) => p.comment_count > 0 && p.status !== 'expired'));
  }, [effectiveSocietyId]);

  const fetchUserVotes = useCallback(async () => {
    if (!user) return;
    const { data } = await supabase
      .from('bulletin_votes')
      .select('post_id')
      .eq('user_id', user.id)
      .eq('vote_type', 'upvote');
    setUserVotes(new Set((data || []).map(v => v.post_id)));
  }, [user]);

  const fetchHelpRequests = useCallback(async () => {
    if (!effectiveSocietyId) return;
    const { data } = await supabase
      .from('help_requests')
      .select('*, author:profiles!help_requests_author_id_fkey(name, block, flat_number)')
      .eq('society_id', effectiveSocietyId)
      .order('created_at', { ascending: false });
    setHelpRequests((data as any) || []);
  }, [effectiveSocietyId]);

  useEffect(() => {
    fetchPosts();
    fetchMostDiscussed();
    fetchUserVotes();
    fetchHelpRequests();
    fetchCategoryPrefs();
    fetchDigest();
  }, [fetchPosts, fetchMostDiscussed, fetchUserVotes, fetchHelpRequests, fetchCategoryPrefs, fetchDigest]);

  useRegisterScreenRefresh(async () => {
    await Promise.all([
      fetchPosts({ silent: true }),
      fetchMostDiscussed(),
      fetchUserVotes(),
      fetchHelpRequests(),
      fetchCategoryPrefs(),
      fetchDigest(),
    ]);
  });

  useEffect(() => {
    if (!effectiveSocietyId) return;
    const channel = supabase
      .channel(`bulletin-feed-${effectiveSocietyId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'bulletin_posts', filter: `society_id=eq.${effectiveSocietyId}` }, () => {
        fetchPosts(); fetchMostDiscussed();
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'bulletin_comments' }, () => {
        fetchPosts(); fetchMostDiscussed();
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [effectiveSocietyId, fetchPosts, fetchMostDiscussed]);

  const handleUpvote = async (postId: string) => {
    if (!user) return;
    if (userVotes.has(postId)) {
      await supabase.from('bulletin_votes').delete().eq('post_id', postId).eq('user_id', user.id).eq('vote_type', 'upvote');
      setUserVotes(prev => { const n = new Set(prev); n.delete(postId); return n; });
    } else {
      await supabase.from('bulletin_votes').insert({ post_id: postId, user_id: user.id, vote_type: 'upvote' });
      setUserVotes(prev => new Set(prev).add(postId));
    }
    fetchPosts();
  };

  const handleOpenHelp = async (req: HelpRequest) => {
    setSelectedHelp(req);
    const { data } = await supabase
      .from('help_responses')
      .select('*, responder:profiles!help_responses_responder_id_fkey(name, block, flat_number)')
      .eq('request_id', req.id)
      .order('created_at', { ascending: true });
    setHelpResponses((data as any) || []);
  };

  const handleSendResponse = async () => {
    if (!newResponse.trim() || !selectedHelp || !user) return;
    setSendingResponse(true);
    const { error } = await supabase.from('help_responses').insert({
      request_id: selectedHelp.id,
      responder_id: user.id,
      message: newResponse.trim(),
    });
    if (error) {
      toast.error('Failed');
    } else {
      setNewResponse('');
      handleOpenHelp(selectedHelp);
    }
    setSendingResponse(false);
  };

  const handleMarkFulfilled = async () => {
    if (!selectedHelp) return;
    await supabase.from('help_requests').update({ status: 'fulfilled' }).eq('id', selectedHelp.id);
    showFeedback({
      title: 'Marked as fulfilled!',
      variant: 'success',
    });
    setSelectedHelp(null);
    fetchHelpRequests();
  };

  const enrichedPosts = posts
    .map(p => ({ ...p, user_has_voted: userVotes.has(p.id) }))
    .filter((p) => {
      if (digestFilter === 'new' && sinceVisitIso) {
        return new Date(p.created_at).getTime() >= new Date(sinceVisitIso).getTime();
      }
      if (digestFilter === 'alerts') {
        return ['maintenance', 'alert'].includes(p.category)
          && (p.status === 'open' || !p.status)
          && !getConvertedSnagId(p.structured);
      }
      if (digestFilter === 'summarised') {
        return !!(p.ai_summary && String(p.ai_summary).trim());
      }
      return true;
    });
  const openLegacyHelp = helpRequests.filter((r) => r.status === 'open');
  const showLegacyHelpInFindHelp =
    smartGroups && digestFilter === 'none' && (category === 'all' || category === 'find_help') && openLegacyHelp.length > 0;

  const headerTitle = smartGroups ? 'Smart Groups' : 'Community';
  const currentPref =
    category !== 'all' && category !== 'following'
      ? categoryPrefs.find((p) => p.category === category)
      : null;

  return (
    <AppLayout headerTitle={headerTitle} showLocation={false}>
      <FeatureGate feature={['bulletin', 'help_requests']}>
        {smartGroups ? (
          <div className="pt-2 space-y-3">
            <div className="px-4 space-y-2">
              <div className="rounded-xl border border-primary/20 bg-primary/5 px-3 py-2.5 flex items-start gap-2">
                <Sparkles size={16} className="text-primary shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-medium text-foreground">Less noise. More connection.</p>
                  <p className="text-xs text-muted-foreground">
                    Better communities - post once, follow what matters, keep private chats in Messages.
                  </p>
                </div>
              </div>

              <div className="rounded-xl border border-border bg-card px-3 py-2.5 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-medium text-foreground">Your community today</p>
                  {digestFilter !== 'none' && (
                    <button
                      type="button"
                      className="text-[10px] text-primary font-medium"
                      onClick={() => setDigestFilter('none')}
                    >
                      Clear filter
                    </button>
                  )}
                </div>
                <div className="flex flex-wrap gap-2 text-[11px]">
                  <button type="button" onClick={() => toggleDigestFilter('new')}>
                    <Badge
                      variant={digestFilter === 'new' ? 'default' : 'secondary'}
                      className="gap-1 cursor-pointer"
                    >
                      {digest.newSinceVisit} new since last visit
                    </Badge>
                  </button>
                  <button type="button" onClick={() => toggleDigestFilter('alerts')}>
                    <Badge
                      variant={digestFilter === 'alerts' ? 'default' : 'outline'}
                      className="gap-1 cursor-pointer"
                    >
                      <Wrench size={10} /> {digest.openMaintenanceAlerts} open alerts
                    </Badge>
                  </button>
                  <button type="button" onClick={() => toggleDigestFilter('summarised')}>
                    <Badge
                      variant={digestFilter === 'summarised' ? 'default' : 'outline'}
                      className="gap-1 cursor-pointer"
                    >
                      <Sparkles size={10} /> {digest.withSummary} summarised
                    </Badge>
                  </button>
                  <Link to="/society/snags">
                    <Badge variant="outline" className="gap-1 cursor-pointer">
                      <Wrench size={10} /> {digest.openCommunityIssues} open issues
                    </Badge>
                  </Link>
                  {conversationsOn && (
                    <Link to="/messages">
                      <Badge variant="outline" className="gap-1 cursor-pointer">
                        <Bell size={10} /> {digest.messageRequests} messages
                      </Badge>
                    </Link>
                  )}
                </div>
                {digestFilter !== 'none' && (
                  <p className="text-[10px] text-muted-foreground">
                    Showing {digestFilter === 'new' ? 'posts since your last visit'
                      : digestFilter === 'alerts' ? 'open maintenance and alerts'
                        : 'posts with a thread summary'}
                    . Tap again or Clear filter to reset.
                  </p>
                )}
              </div>
            </div>

            <div className="px-4">
              <button
                type="button"
                onClick={() => setShowCreate(true)}
                className="w-full text-left rounded-xl border border-border bg-card px-4 py-3 hover:border-primary/30 transition-colors"
              >
                <p className="text-sm font-medium text-foreground">What&apos;s happening in your community?</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Ask for help, share something, find a service or announce an event...
                </p>
              </button>
            </div>

            <div className="px-4">
              <div className="relative">
                <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder={bulletinPlaceholder || 'Search community posts...'}
                  className="pl-9 h-9 text-sm"
                />
              </div>
            </div>

            <CategoryFilter
              selected={category}
              onSelect={setCategory}
              smartGroups
              showFollowing
            />

            {category !== 'all' && category !== 'following' && (
              <div className="px-4 flex items-center gap-2">
                <Button
                  size="sm"
                  variant={currentPref?.mode === 'follow' ? 'default' : 'outline'}
                  className="h-7 text-xs gap-1"
                  onClick={() => setCategoryMode(category, currentPref?.mode === 'follow' ? null : 'follow')}
                >
                  <Heart size={12} />
                  {currentPref?.mode === 'follow' ? 'Following' : 'Follow'}
                </Button>
                <Button
                  size="sm"
                  variant={currentPref?.mode === 'mute' ? 'default' : 'outline'}
                  className="h-7 text-xs gap-1"
                  onClick={() => setCategoryMode(category, currentPref?.mode === 'mute' ? null : 'mute')}
                >
                  <VolumeX size={12} />
                  {currentPref?.mode === 'mute' ? 'Muted' : 'Mute'}
                </Button>
              </div>
            )}

            <div className="px-4 flex justify-end">
              <button
                type="button"
                className="text-[11px] text-muted-foreground underline-offset-2 hover:underline"
                onClick={() => setShowResolved((v) => !v)}
              >
                {showResolved ? 'Hide resolved / expired' : 'Show resolved'}
              </button>
            </div>

            {category === 'all' && <MostDiscussedSection posts={mostDiscussed} onOpen={setSelectedPost} />}

            <div className="px-4 space-y-3 pb-24">
              {loading ? (
                <div className="flex justify-center py-12">
                  <Loader2 className="animate-spin text-muted-foreground" size={24} />
                </div>
              ) : enrichedPosts.length === 0 && !showLegacyHelpInFindHelp ? (
                <div className="text-center py-12 space-y-2">
                  <p className="text-muted-foreground text-sm">
                    {digestFilter !== 'none'
                      ? 'Nothing matches this community filter right now.'
                      : category === 'following'
                        ? 'Follow a category to build this feed.'
                        : 'No posts yet. Be the first to share!'}
                  </p>
                  {digestFilter !== 'none' ? (
                    <button
                      type="button"
                      className="text-xs text-primary font-medium"
                      onClick={() => setDigestFilter('none')}
                    >
                      Clear filter
                    </button>
                  ) : category !== 'following' ? (
                    <p className="text-xs text-muted-foreground">Try Find Help - cooks, maids, electricians and more.</p>
                  ) : null}
                </div>
              ) : (
                <>
                  {enrichedPosts.map((post) => (
                    <PostCard
                      key={post.id}
                      post={post}
                      onUpvote={handleUpvote}
                      onOpen={setSelectedPost}
                      onRefresh={fetchPosts}
                    />
                  ))}
                  {showLegacyHelpInFindHelp && (
                    <div className="space-y-2 pt-2">
                      <div className="flex items-center gap-2">
                        <Badge variant="secondary" className="text-[10px]">Legacy Quick Help</Badge>
                        <span className="text-[10px] text-muted-foreground">Open threads from before Smart Groups</span>
                      </div>
                      {openLegacyHelp.map((req) => (
                        <HelpRequestCard key={req.id} request={req} onOpen={handleOpenHelp} />
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>

            <Button
              size="icon"
              className="fixed bottom-[calc(5rem+env(safe-area-inset-bottom))] right-4 z-40 w-12 h-12 rounded-full shadow-lg"
              onClick={() => setShowCreate(true)}
            >
              <Plus size={22} />
            </Button>

            <SmartPostComposer open={showCreate} onOpenChange={setShowCreate} onCreated={fetchPosts} />
          </div>
        ) : (
          <div className="pt-2">
            <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
              <TabsList className="w-full grid grid-cols-2 mb-3 mx-4" style={{ width: 'calc(100% - 2rem)' }}>
                <TabsTrigger value="board">Board</TabsTrigger>
                <TabsTrigger value="help">Quick Help</TabsTrigger>
              </TabsList>

              <TabsContent value="board" className="space-y-3">
                <div className="px-4">
                  <div className="relative">
                    <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      placeholder={bulletinPlaceholder}
                      className="pl-9 h-9 text-sm"
                    />
                  </div>
                </div>
                <CategoryFilter selected={category} onSelect={setCategory} />
                {category === 'all' && <MostDiscussedSection posts={mostDiscussed} onOpen={setSelectedPost} />}
                <div className="px-4 space-y-3">
                  {loading ? (
                    <div className="flex justify-center py-12">
                      <Loader2 className="animate-spin text-muted-foreground" size={24} />
                    </div>
                  ) : enrichedPosts.length === 0 ? (
                    <div className="text-center py-12">
                      <p className="text-muted-foreground text-sm">No posts yet. Be the first to share!</p>
                    </div>
                  ) : (
                    enrichedPosts.map((post) => (
                      <PostCard
                        key={post.id}
                        post={post}
                        onUpvote={handleUpvote}
                        onOpen={setSelectedPost}
                        onRefresh={fetchPosts}
                      />
                    ))
                  )}
                </div>
                <Button
                  size="icon"
                  className="fixed bottom-[calc(5rem+env(safe-area-inset-bottom))] right-4 z-40 w-12 h-12 rounded-full shadow-lg"
                  onClick={() => setShowCreate(true)}
                >
                  <Plus size={22} />
                </Button>
              </TabsContent>

              <TabsContent value="help" className="px-4 space-y-3">
                {helpRequests.length === 0 ? (
                  <div className="text-center py-12">
                    <p className="text-muted-foreground text-sm">No help requests yet</p>
                    <p className="text-xs text-muted-foreground mt-1">Need something from a neighbor? Ask away!</p>
                  </div>
                ) : (
                  helpRequests.map((req) => (
                    <HelpRequestCard key={req.id} request={req} onOpen={handleOpenHelp} />
                  ))
                )}
                <Button
                  size="icon"
                  className="fixed bottom-[calc(5rem+env(safe-area-inset-bottom))] right-4 z-40 w-12 h-12 rounded-full shadow-lg"
                  onClick={() => setShowCreateHelp(true)}
                >
                  <Plus size={22} />
                </Button>
              </TabsContent>
            </Tabs>

            <CreatePostSheet open={showCreate} onOpenChange={setShowCreate} onCreated={fetchPosts} />
            <CreateHelpSheet open={showCreateHelp} onOpenChange={setShowCreateHelp} onCreated={fetchHelpRequests} />
          </div>
        )}

        <PostDetailSheet
          post={selectedPost}
          open={!!selectedPost}
          onOpenChange={(o) => !o && setSelectedPost(null)}
          onVote={handleUpvote}
          onPostUpdated={fetchPosts}
        />

        <Drawer open={!!selectedHelp} onOpenChange={(o) => !o && setSelectedHelp(null)}>
          <DrawerContent className="max-h-[80dvh] overflow-y-auto">
            {selectedHelp && (
              <>
                <DrawerHeader>
                  <DrawerTitle>{selectedHelp.title}</DrawerTitle>
                  <p className="text-xs text-muted-foreground">
                    {selectedHelp.author?.name} · {selectedHelp.author?.block}-{selectedHelp.author?.flat_number}
                  </p>
                </DrawerHeader>
                <div className="mt-4 space-y-4">
                  {selectedHelp.description && (
                    <p className="text-sm text-foreground">{selectedHelp.description}</p>
                  )}

                  {selectedHelp.author_id === user?.id && selectedHelp.status === 'open' && (
                    <Button variant="outline" size="sm" onClick={handleMarkFulfilled}>
                      Mark as Fulfilled
                    </Button>
                  )}

                  <div className="space-y-3">
                    <h4 className="font-medium text-sm flex items-center gap-1">
                      <MessageCircle size={14} /> Responses ({helpResponses.length})
                    </h4>
                    {helpResponses.length === 0 ? (
                      <p className="text-xs text-muted-foreground text-center py-4">No responses yet</p>
                    ) : (
                      helpResponses.map((r: any) => (
                        <div key={r.id} className="p-3 rounded-lg bg-muted/50 space-y-1">
                          <span className="text-xs font-medium">
                            {r.responder?.name} · {r.responder?.block}-{r.responder?.flat_number}
                          </span>
                          <p className="text-sm">{r.message}</p>
                        </div>
                      ))
                    )}
                  </div>

                  {selectedHelp.status === 'open' && selectedHelp.author_id !== user?.id && (
                    <div className="flex gap-2 sticky bottom-0 bg-background pt-2">
                      <Input
                        value={newResponse}
                        onChange={(e) => setNewResponse(e.target.value)}
                        placeholder="Offer to help..."
                        onKeyDown={(e) => e.key === 'Enter' && handleSendResponse()}
                      />
                      <Button
                        size="icon"
                        onClick={handleSendResponse}
                        disabled={sendingResponse || !newResponse.trim()}
                      >
                        {sendingResponse ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
                      </Button>
                    </div>
                  )}
                </div>
              </>
            )}
          </DrawerContent>
        </Drawer>
      </FeatureGate>
    </AppLayout>
  );
}
