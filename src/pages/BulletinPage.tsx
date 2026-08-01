// @ts-nocheck
import { useState, useEffect, useCallback } from 'react';
import { AppLayout } from '@/components/layout/AppLayout';
import { FeatureGate } from '@/components/ui/FeatureGate';
import { CategoryFilter, type BulletinCategory } from '@/components/bulletin/CategoryFilter';
import { PostCard, type BulletinPost } from '@/components/bulletin/PostCard';
import { CreatePostSheet } from '@/components/bulletin/CreatePostSheet';
import { PostDetailSheet } from '@/components/bulletin/PostDetailSheet';
import { MostDiscussedSection } from '@/components/bulletin/MostDiscussedSection';
import { HelpRequestCard, type HelpRequest } from '@/components/bulletin/HelpRequestCard';
import { CreateHelpSheet } from '@/components/bulletin/CreateHelpSheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from '@/components/ui/drawer';
import { supabase } from '@/integrations/supabase/client';
import { escapeIlike } from '@/lib/query-utils';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from '@/hooks/use-toast';
import { Plus, Search, Loader2, Send, MessageCircle } from 'lucide-react';
import { useSearchPlaceholder } from '@/hooks/useSearchPlaceholder';

export default function BulletinPage() {
  const { user, profile, effectiveSocietyId } = useAuth();
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
  
  // Help response state
  const [helpResponses, setHelpResponses] = useState<any[]>([]);
  const [newResponse, setNewResponse] = useState('');
  const [sendingResponse, setSendingResponse] = useState(false);

  const fetchPosts = useCallback(async () => {
    if (!effectiveSocietyId) return;
    setLoading(true);

    let query = supabase
      .from('bulletin_posts')
      .select('*, author:profiles!bulletin_posts_author_id_fkey(name, block, flat_number, avatar_url)')
      .eq('society_id', effectiveSocietyId)
      .eq('is_archived', false)
      .order('is_pinned', { ascending: false })
      .order('created_at', { ascending: false });

    if (category !== 'all') {
      query = query.eq('category', category);
    }
    if (search.trim()) {
      const escaped = escapeIlike(search);
      query = query.or(`title.ilike.%${escaped}%,body.ilike.%${escaped}%`);
    }

    const { data } = await query;
    setPosts((data as any) || []);
    setLoading(false);
  }, [effectiveSocietyId, category, search]);

  const fetchMostDiscussed = useCallback(async () => {
    if (!effectiveSocietyId) return;
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);

    const { data } = await supabase
      .from('bulletin_posts')
      .select('*, author:profiles!bulletin_posts_author_id_fkey(name, block, flat_number, avatar_url)')
      .eq('society_id', effectiveSocietyId)
      .eq('is_archived', false)
      .gte('created_at', yesterday.toISOString())
      .order('comment_count', { ascending: false })
      .limit(5);

    setMostDiscussed(((data as any) || []).filter((p: any) => p.comment_count > 0));
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
  }, [fetchPosts, fetchMostDiscussed, fetchUserVotes, fetchHelpRequests]);

  // Realtime — BULLETIN-01 FIX: filter by society_id to avoid cross-society triggers
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
    // Fetch responses (only visible to author + responder)
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
      toast({ title: 'Failed', variant: 'destructive' });
    } else {
      setNewResponse('');
      handleOpenHelp(selectedHelp);
    }
    setSendingResponse(false);
  };

  const handleMarkFulfilled = async () => {
    if (!selectedHelp) return;
    await supabase.from('help_requests').update({ status: 'fulfilled' }).eq('id', selectedHelp.id);
    toast({ title: 'Marked as fulfilled!' });
    setSelectedHelp(null);
    fetchHelpRequests();
  };

  const enrichedPosts = posts.map(p => ({ ...p, user_has_voted: userVotes.has(p.id) }));

  return (
    <AppLayout headerTitle="Community" showLocation={false}>
      <FeatureGate feature={["bulletin", "help_requests"]}>
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
                <Input value={search} onChange={e => setSearch(e.target.value)} placeholder={bulletinPlaceholder} className="pl-9 h-9 text-sm" />
              </div>
            </div>
            <CategoryFilter selected={category} onSelect={setCategory} />
            {category === 'all' && <MostDiscussedSection posts={mostDiscussed} onOpen={setSelectedPost} />}
            <div className="px-4 space-y-3">
              {loading ? (
                <div className="flex justify-center py-12"><Loader2 className="animate-spin text-muted-foreground" size={24} /></div>
              ) : enrichedPosts.length === 0 ? (
                <div className="text-center py-12">
                  <p className="text-muted-foreground text-sm">No posts yet. Be the first to share!</p>
                </div>
              ) : (
                enrichedPosts.map(post => (
                  <PostCard key={post.id} post={post} onUpvote={handleUpvote} onOpen={setSelectedPost} onRefresh={fetchPosts} />
                ))
              )}
            </div>
            <Button size="icon" className="fixed bottom-[calc(5rem+env(safe-area-inset-bottom))] right-4 z-40 w-12 h-12 rounded-full shadow-lg" onClick={() => setShowCreate(true)}>
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
              helpRequests.map(req => (
                <HelpRequestCard key={req.id} request={req} onOpen={handleOpenHelp} />
              ))
            )}
            <Button size="icon" className="fixed bottom-[calc(5rem+env(safe-area-inset-bottom))] right-4 z-40 w-12 h-12 rounded-full shadow-lg" onClick={() => setShowCreateHelp(true)}>
              <Plus size={22} />
            </Button>
          </TabsContent>
        </Tabs>
      </div>

      <CreatePostSheet open={showCreate} onOpenChange={setShowCreate} onCreated={fetchPosts} />
      <CreateHelpSheet open={showCreateHelp} onOpenChange={setShowCreateHelp} onCreated={fetchHelpRequests} />
      <PostDetailSheet
        post={selectedPost}
        open={!!selectedPost}
        onOpenChange={(o) => !o && setSelectedPost(null)}
        onVote={handleUpvote}
      />

      {/* Help Request Detail Sheet */}
      <Drawer open={!!selectedHelp} onOpenChange={(o) => !o && setSelectedHelp(null)}>
        <DrawerContent className="max-h-[80vh] overflow-y-auto">
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
                        <span className="text-xs font-medium">{r.responder?.name} · {r.responder?.block}-{r.responder?.flat_number}</span>
                        <p className="text-sm">{r.message}</p>
                      </div>
                    ))
                  )}
                </div>

                {selectedHelp.status === 'open' && selectedHelp.author_id !== user?.id && (
                  <div className="flex gap-2 sticky bottom-0 bg-background pt-2">
                    <Input value={newResponse} onChange={e => setNewResponse(e.target.value)} placeholder="Offer to help..." onKeyDown={e => e.key === 'Enter' && handleSendResponse()} />
                    <Button size="icon" onClick={handleSendResponse} disabled={sendingResponse || !newResponse.trim()}>
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
