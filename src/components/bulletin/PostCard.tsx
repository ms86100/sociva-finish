// @ts-nocheck
import { useState } from 'react';
import { formatDistanceToNow } from 'date-fns';
import { ArrowBigUp, MessageCircle, Pin, MapPin, Calendar, Users, Flag, Archive, Trash2, MoreVertical } from 'lucide-react';
import { ReportSheet } from '@/components/report/ReportSheet';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import { CATEGORY_CONFIG } from './CategoryFilter';

export interface BulletinPost {
  id: string;
  society_id: string;
  author_id: string;
  category: string;
  title: string;
  body: string | null;
  attachment_urls: string[];
  is_pinned: boolean;
  is_archived: boolean;
  poll_options: any;
  poll_deadline: string | null;
  event_date: string | null;
  event_location: string | null;
  rsvp_enabled: boolean;
  comment_count: number;
  vote_count: number;
  ai_summary: string | null;
  created_at: string;
  updated_at: string;
  author?: { name: string; block: string; flat_number: string; avatar_url: string | null };
  user_has_voted?: boolean;
}

interface PostCardProps {
  post: BulletinPost;
  onUpvote: (postId: string) => void;
  onOpen: (post: BulletinPost) => void;
  onRefresh?: () => void;
}

export function PostCard({ post, onUpvote, onOpen, onRefresh }: PostCardProps) {
  const { isSocietyAdmin, isAdmin } = useAuth();
  const [reportOpen, setReportOpen] = useState(false);
  const canModerate = isSocietyAdmin || isAdmin;
  const cat = CATEGORY_CONFIG[post.category] || CATEGORY_CONFIG.alert;
  const CatIcon = cat.icon;

  const handleModAction = async (action: 'pin' | 'archive' | 'delete', e: React.MouseEvent) => {
    e.stopPropagation();
    if (action === 'pin') {
      await supabase.from('bulletin_posts').update({ is_pinned: !post.is_pinned }).eq('id', post.id);
      toast.success(post.is_pinned ? 'Unpinned' : 'Pinned');
    } else if (action === 'archive') {
      await supabase.from('bulletin_posts').update({ is_archived: true }).eq('id', post.id);
      toast.success('Post archived');
    } else if (action === 'delete') {
      await supabase.from('bulletin_posts').delete().eq('id', post.id);
      toast.success('Post deleted');
    }
    onRefresh?.();
  };

  return (
    <div
      className="bg-card rounded-xl border border-border p-4 space-y-3 animate-fade-in cursor-pointer active:scale-[0.99] transition-transform"
      onClick={() => onOpen(post)}
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <Badge variant="outline" className={cn('text-[10px] gap-1 shrink-0', cat.bg, cat.color)}>
            <CatIcon size={10} />
            {cat.label}
          </Badge>
          {post.is_pinned && (
            <Pin size={12} className="text-primary shrink-0 fill-primary" />
          )}
        </div>
        <span className="text-[10px] text-muted-foreground whitespace-nowrap">
          {formatDistanceToNow(new Date(post.created_at), { addSuffix: true })}
        </span>
      </div>

      {/* Title */}
      <h3 className="font-semibold text-sm leading-snug text-foreground">{post.title}</h3>

      {/* Body preview */}
      {post.body && (
        <p className="text-xs text-muted-foreground line-clamp-2">{post.body}</p>
      )}

      {/* Attachment preview */}
      {post.attachment_urls && post.attachment_urls.length > 0 && (
        <div className="flex gap-2 overflow-x-auto scrollbar-hide">
          {post.attachment_urls.slice(0, 3).map((url, i) => (
            <img
              key={i}
              src={url}
              alt=""
              className="w-20 h-20 rounded-lg object-cover border border-border shrink-0"
              loading="lazy"
            />
          ))}
          {post.attachment_urls.length > 3 && (
            <div className="w-20 h-20 rounded-lg bg-muted flex items-center justify-center text-xs text-muted-foreground shrink-0">
              +{post.attachment_urls.length - 3}
            </div>
          )}
        </div>
      )}

      {/* Event info */}
      {post.category === 'event' && post.event_date && (
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <span className="flex items-center gap-1">
            <Calendar size={12} />
            {new Date(post.event_date).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })}
          </span>
          {post.event_location && (
            <span className="flex items-center gap-1">
              <MapPin size={12} />
              {post.event_location}
            </span>
          )}
          {post.rsvp_enabled && (
            <span className="flex items-center gap-1 text-primary font-medium">
              <Users size={12} />
              RSVP Open
            </span>
          )}
        </div>
      )}

      {/* Poll preview */}
      {post.category === 'poll' && post.poll_options && (
        <div className="text-xs text-muted-foreground">
          {Array.isArray(post.poll_options) ? `${post.poll_options.length} options` : 'Poll'} 
          {post.poll_deadline && ` · Ends ${formatDistanceToNow(new Date(post.poll_deadline), { addSuffix: true })}`}
        </div>
      )}

      {/* Author + actions */}
      <div className="flex items-center justify-between pt-1 border-t border-border">
        <span className="text-[10px] text-muted-foreground">
          {post.author?.name || 'Member'} · {post.author?.block}-{post.author?.flat_number}
        </span>
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="sm"
            className={cn(
              'h-7 px-2 gap-1 text-xs',
              post.user_has_voted && 'text-primary'
            )}
            onClick={(e) => { e.stopPropagation(); onUpvote(post.id); }}
          >
            <ArrowBigUp size={16} className={post.user_has_voted ? 'fill-primary' : ''} />
            {post.vote_count}
          </Button>
          <span className="flex items-center gap-1 text-xs text-muted-foreground">
            <MessageCircle size={14} />
            {post.comment_count}
          </span>
          <button
            className="text-muted-foreground hover:text-destructive transition-colors"
            onClick={(e) => { e.stopPropagation(); setReportOpen(true); }}
            aria-label="Report post"
          >
            <Flag size={13} />
          </button>
          {canModerate && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="text-muted-foreground hover:text-foreground" onClick={e => e.stopPropagation()}>
                  <MoreVertical size={14} />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={(e) => handleModAction('pin', e as any)}>
                  <Pin size={12} className="mr-2" /> {post.is_pinned ? 'Unpin' : 'Pin'}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={(e) => handleModAction('archive', e as any)}>
                  <Archive size={12} className="mr-2" /> Archive
                </DropdownMenuItem>
                <DropdownMenuItem className="text-destructive" onClick={(e) => handleModAction('delete', e as any)}>
                  <Trash2 size={12} className="mr-2" /> Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </div>

      <ReportSheet
        open={reportOpen}
        onOpenChange={setReportOpen}
        targetType="post"
        targetId={post.id}
        targetName={post.title}
      />
    </div>
  );
}
