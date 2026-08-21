// @ts-nocheck
import { useState } from 'react';
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from '@/components/ui/drawer';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { CATEGORY_CONFIG, type BulletinCategory } from './CategoryFilter';
import { cn, friendlyError } from '@/lib/utils';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import { Loader2, Plus, X, ImagePlus } from 'lucide-react';
import { notify } from '@/lib/notify';
import { showFeedback, useFeedbackPopup } from '@/components/FeedbackPopupProvider';

interface CreatePostSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
}

export function CreatePostSheet({ open, onOpenChange, onCreated }: CreatePostSheetProps) {
  const { profile, viewAsSocietyId } = useAuth();
  const [category, setCategory] = useState<BulletinCategory>('alert');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [loading, setLoading] = useState(false);

  // Event fields
  const [eventDate, setEventDate] = useState('');
  const [eventLocation, setEventLocation] = useState('');
  const [rsvpEnabled, setRsvpEnabled] = useState(false);

  // Poll fields
  const [pollOptions, setPollOptions] = useState<string[]>(['', '']);
  const [pollDeadline, setPollDeadline] = useState('');

  // Attachments
  const [attachments, setAttachments] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);

  const resetForm = () => {
    setCategory('alert');
    setTitle('');
    setBody('');
    setEventDate('');
    setEventLocation('');
    setRsvpEnabled(false);
    setPollOptions(['', '']);
    setPollDeadline('');
    setAttachments([]);
  };

  const handleAttachmentPick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (attachments.length + files.length > 4) {
      toast.error('Max 4 images allowed');
      return;
    }
    setAttachments(prev => [...prev, ...files]);
  };

  const uploadAttachments = async (): Promise<string[]> => {
    const urls: string[] = [];
    for (const file of attachments) {
      const ext = file.name.split('.').pop();
      const path = `bulletin/${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`;
      const { error } = await supabase.storage.from('app-images').upload(path, file);
      if (error) throw error;
      const { data: urlData } = supabase.storage.from('app-images').getPublicUrl(path);
      urls.push(urlData.publicUrl);
    }
    return urls;
  };

  const handleSubmit = async () => {
    if (!title.trim()) {
      toast.error('Title is required');
      return;
    }
    if (!profile?.society_id) {
      notify.block('You must belong to a society');
      return;
    }
    if (category === 'poll') {
      const validOptions = pollOptions.filter(o => o.trim());
      if (validOptions.length < 2) {
        toast.error('At least 2 poll options required');
        return;
      }
    }

    setLoading(true);
    try {
      let attachment_urls: string[] = [];
      if (attachments.length > 0) {
        setUploading(true);
        attachment_urls = await uploadAttachments();
        setUploading(false);
      }

      const postData: any = {
        society_id: profile.society_id,
        author_id: profile.id,
        category: category === 'all' ? 'alert' : category,
        title: title.trim(),
        body: body.trim() || null,
        attachment_urls,
      };

      if (category === 'event') {
        postData.event_date = eventDate || null;
        postData.event_location = eventLocation.trim() || null;
        postData.rsvp_enabled = rsvpEnabled;
      }

      if (category === 'poll') {
        const validOptions = pollOptions.filter(o => o.trim());
        postData.poll_options = validOptions.map((text, i) => ({
          id: `opt_${i}`,
          text,
          votes: 0,
        }));
        postData.poll_deadline = pollDeadline || null;
      }

      // Bug 3 fix: Synchronous content moderation before publishing
      const contentToCheck = `${title.trim()} ${body.trim()}`;
      try {
        const { data: reviewResult } = await supabase.functions.invoke('ai-auto-review', {
          body: { target_type: 'bulletin_post', content: contentToCheck, society_id: profile.society_id },
        });
        if (reviewResult?.decision === 'reject') {
          toast.error(reviewResult?.reason || 'Your post was flagged for inappropriate content. Please revise and try again.');
          setLoading(false);
          return;
        }
      } catch (reviewErr) {
        // If moderation service is down, allow post through (fail-open) but log
        console.warn('[CreatePostSheet] Content moderation unavailable, allowing post:', reviewErr);
      }

      const { error } = await supabase.from('bulletin_posts').insert(postData);
      if (error) throw error;

      const { showFeedback } = useFeedbackPopup();
      showFeedback({
        title: 'Post created!',
        variant: 'success'
      });
      resetForm();
      onOpenChange(false);
      onCreated();
    } catch (err: any) {
      toast.error('Failed to create post: ' + friendlyError(err));
    } finally {
      setLoading(false);
    }
  };

  const catKeys = Object.keys(CATEGORY_CONFIG) as BulletinCategory[];

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent className="max-h-[85vh] overflow-y-auto">
        <DrawerHeader>
          <DrawerTitle>New Post</DrawerTitle>
        </DrawerHeader>

        <div className="space-y-4 mt-4">
          {/* Category picker */}
          <div className="flex gap-2 flex-wrap">
            {catKeys.map((key) => {
              const c = CATEGORY_CONFIG[key];
              const Icon = c.icon;
              return (
                <button
                  key={key}
                  onClick={() => setCategory(key)}
                  className={cn(
                    'flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border transition-all',
                    category === key
                      ? 'bg-primary text-primary-foreground border-primary'
                      : 'bg-card border-border text-muted-foreground'
                  )}
                >
                  <Icon size={12} />
                  {c.label}
                </button>
              );
            })}
          </div>

          {/* Title */}
          <div>
            <Label htmlFor="title">Title</Label>
            <Input
              id="title"
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="What's this about?"
              maxLength={200}
            />
          </div>

          {/* Body */}
          <div>
            <Label htmlFor="body">Description (optional)</Label>
            <Textarea
              id="body"
              value={body}
              onChange={e => setBody(e.target.value)}
              placeholder="Share more details..."
              rows={4}
            />
          </div>

          {/* Attachments */}
          <div>
            <Label>Images (max 4)</Label>
            <div className="flex gap-2 mt-1 flex-wrap">
              {attachments.map((file, i) => (
                <div key={i} className="relative w-16 h-16">
                  <img
                    src={URL.createObjectURL(file)}
                    alt=""
                    className="w-full h-full rounded-lg object-cover border border-border"
                  />
                  <button
                    onClick={() => setAttachments(prev => prev.filter((_, j) => j !== i))}
                    className="absolute -top-1 -right-1 w-5 h-5 bg-destructive text-destructive-foreground rounded-full flex items-center justify-center"
                  >
                    <X size={10} />
                  </button>
                </div>
              ))}
              {attachments.length < 4 && (
                <label className="w-16 h-16 rounded-lg border-2 border-dashed border-border flex items-center justify-center cursor-pointer hover:border-primary/50 transition-colors">
                  <ImagePlus size={18} className="text-muted-foreground" />
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={handleAttachmentPick}
                  />
                </label>
              )}
            </div>
          </div>

          {/* Event fields */}
          {category === 'event' && (
            <div className="space-y-3 p-3 rounded-lg bg-muted/50 border border-border">
              <div>
                <Label htmlFor="eventDate">Event Date & Time</Label>
                <Input
                  id="eventDate"
                  type="datetime-local"
                  value={eventDate}
                  onChange={e => setEventDate(e.target.value)}
                />
              </div>
              <div>
                <Label htmlFor="eventLocation">Location</Label>
                <Input
                  id="eventLocation"
                  value={eventLocation}
                  onChange={e => setEventLocation(e.target.value)}
                  placeholder="e.g. Clubhouse, Garden"
                />
              </div>
              <div className="flex items-center justify-between">
                <Label htmlFor="rsvp">Enable RSVP</Label>
                <Switch id="rsvp" checked={rsvpEnabled} onCheckedChange={setRsvpEnabled} />
              </div>
            </div>
          )}

          {/* Poll fields */}
          {category === 'poll' && (
            <div className="space-y-3 p-3 rounded-lg bg-muted/50 border border-border">
              <Label>Poll Options</Label>
              {pollOptions.map((opt, i) => (
                <div key={i} className="flex gap-2">
                  <Input
                    value={opt}
                    onChange={e => {
                      const next = [...pollOptions];
                      next[i] = e.target.value;
                      setPollOptions(next);
                    }}
                    placeholder={`Option ${i + 1}`}
                  />
                  {pollOptions.length > 2 && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="shrink-0"
                      onClick={() => setPollOptions(prev => prev.filter((_, j) => j !== i))}
                    >
                      <X size={14} />
                    </Button>
                  )}
                </div>
              ))}
              {pollOptions.length < 6 && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPollOptions(prev => [...prev, ''])}
                  className="w-full gap-1"
                >
                  <Plus size={14} /> Add Option
                </Button>
              )}
              <div>
                <Label htmlFor="deadline">Voting Deadline (optional)</Label>
                <Input
                  id="deadline"
                  type="datetime-local"
                  value={pollDeadline}
                  onChange={e => setPollDeadline(e.target.value)}
                />
              </div>
            </div>
          )}

          {/* Preview before posting */}
          {title.trim() && !loading && (
            <div className="p-3 rounded-lg bg-muted/50 border border-border">
              <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-1">Preview</p>
              <div className="flex items-center gap-1.5 mb-1">
                <span className="text-xs px-1.5 py-0.5 rounded-full bg-primary/10 text-primary font-medium">
                  {CATEGORY_CONFIG[category]?.label || category}
                </span>
              </div>
              <p className="text-sm font-semibold">{title}</p>
              {body.trim() && (
                <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{body}</p>
              )}
              {attachments.length > 0 && (
                <p className="text-[10px] text-muted-foreground mt-1">📎 {attachments.length} image{attachments.length > 1 ? 's' : ''} attached</p>
              )}
            </div>
          )}

          <Button
            className="w-full"
            onClick={handleSubmit}
            disabled={loading || !title.trim() || !!viewAsSocietyId}
          >
            {loading ? (
              <>
                <Loader2 size={16} className="animate-spin mr-2" />
                {uploading ? 'Uploading...' : 'Posting...'}
              </>
            ) : (
              'Post to Community'
            )}
          </Button>
          {viewAsSocietyId && (
            <p className="text-xs text-muted-foreground text-center">You are viewing another society. Switch back to create content.</p>
          )}
        </div>
      </DrawerContent>
    </Drawer>
  );
}
