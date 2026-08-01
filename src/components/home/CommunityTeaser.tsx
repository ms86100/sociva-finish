// @ts-nocheck
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { MessageCircle, ChevronRight, Heart, ArrowRight } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { jitteredStaleTime } from '@/lib/query-utils';
import { useMarketplaceLabels } from '@/hooks/useMarketplaceLabels';
import { staggerContainer, listItem, glassFadeIn } from '@/lib/motion-variants';

interface RecentPost {
  id: string;
  title: string;
  category: string;
  comment_count: number;
  vote_count: number;
  created_at: string;
}

export function CommunityTeaser() {
  const { effectiveSocietyId } = useAuth();
  const ml = useMarketplaceLabels();

  const { data } = useQuery({
    queryKey: ['community-teaser', effectiveSocietyId],
    queryFn: async () => {
      const [postsRes, helpRes] = await Promise.all([
        supabase
          .from('bulletin_posts')
          .select('id, title, category, comment_count, vote_count, created_at')
          .eq('society_id', effectiveSocietyId!)
          .eq('is_archived', false)
          .order('created_at', { ascending: false })
          .limit(2),
        supabase
          .from('help_requests')
          .select('id', { count: 'exact', head: true })
          .eq('society_id', effectiveSocietyId!)
          .eq('status', 'open'),
      ]);
      return {
        posts: (postsRes.data || []) as RecentPost[],
        helpCount: helpRes.count || 0,
      };
    },
    enabled: !!effectiveSocietyId,
    staleTime: jitteredStaleTime(3 * 60 * 1000),
  });

  const posts = data?.posts || [];
  const helpCount = data?.helpCount || 0;

  if (!effectiveSocietyId) return null;
  if (posts.length === 0 && helpCount === 0) return null;

  return (
    <div className="px-4 mt-2 mb-2">
      <div className="flex items-center justify-between mb-3">
        <h3 className="section-header">
          <div className="w-8 h-8 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
            <MessageCircle size={14} className="text-primary" />
          </div>
          {ml.label('label_section_community')}
        </h3>
        <Link to="/community" className="text-xs font-bold text-primary flex items-center gap-0.5 hover:underline">
          View all <ChevronRight size={13} />
        </Link>
      </div>

      <motion.div
        variants={staggerContainer}
        initial="hidden"
        animate="show"
        className="space-y-2"
      >
        {helpCount > 0 && (
          <motion.div variants={glassFadeIn}>
            <Link to="/community">
              <div className="flex items-center gap-3 py-2.5 px-3 rounded-xl bg-warning/5 border border-warning/10 active:opacity-70 transition-opacity">
                <Heart size={14} className="text-warning shrink-0" />
                <span className="text-xs font-semibold text-foreground flex-1 truncate">
                  {helpCount} neighbor{helpCount !== 1 ? 's' : ''} need{helpCount === 1 ? 's' : ''} help
                </span>
                <ArrowRight size={13} className="text-muted-foreground shrink-0" />
              </div>
            </Link>
          </motion.div>
        )}
        
        {posts.map((post) => (
          <motion.div key={post.id} variants={listItem}>
            <Link to="/community">
              <div className="flex items-center gap-3 py-2.5 px-3 rounded-xl hover:bg-secondary/50 active:opacity-70 transition-all">
                <span className="text-xs font-medium text-foreground flex-1 truncate">{post.title}</span>
                <span className="text-[10px] text-muted-foreground whitespace-nowrap tabular-nums">
                  {post.comment_count}💬 {post.vote_count}↑
                </span>
              </div>
            </Link>
          </motion.div>
        ))}
      </motion.div>
    </div>
  );
}
