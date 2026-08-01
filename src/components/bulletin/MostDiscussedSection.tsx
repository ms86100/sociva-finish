// @ts-nocheck
import { MessageCircle, TrendingUp } from 'lucide-react';
import type { BulletinPost } from './PostCard';

interface MostDiscussedSectionProps {
  posts: BulletinPost[];
  onOpen: (post: BulletinPost) => void;
}

export function MostDiscussedSection({ posts, onOpen }: MostDiscussedSectionProps) {
  if (posts.length === 0) return null;

  return (
    <div className="px-4 pb-2">
      <div className="flex items-center gap-1.5 mb-2">
        <TrendingUp size={14} className="text-primary" />
        <span className="text-xs font-semibold text-foreground">Most Discussed Today</span>
      </div>
      <div className="flex gap-2 overflow-x-auto scrollbar-hide">
        {posts.map((post) => (
          <button
            key={post.id}
            onClick={() => onOpen(post)}
            className="shrink-0 w-48 p-3 rounded-lg bg-primary/5 border border-primary/10 text-left hover:bg-primary/10 transition-colors"
          >
            <p className="text-xs font-medium text-foreground line-clamp-2 leading-snug">
              {post.title}
            </p>
            <span className="flex items-center gap-1 mt-1.5 text-[10px] text-muted-foreground">
              <MessageCircle size={10} />
              {post.comment_count} comments
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
