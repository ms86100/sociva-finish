// @ts-nocheck
import { useState } from 'react';
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerTrigger } from '@/components/ui/drawer';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ImageUpload } from '@/components/ui/image-upload';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Plus, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { friendlyError } from '@/lib/utils';

export function AddDocumentSheet({ onAdded }: { onAdded: () => void }) {
  const { user, profile, viewAsSocietyId } = useAuth();
  const [open, setOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('other');
  const [fileUrl, setFileUrl] = useState<string | null>(null);

  const handleSubmit = async () => {
    if (!user || !profile?.society_id || !title.trim() || !fileUrl) return;
    setIsSubmitting(true);

    try {
      const { error } = await supabase.from('project_documents').insert({
        society_id: profile.society_id,
        title: title.trim(),
        description: description.trim() || null,
        category,
        file_url: fileUrl,
        uploaded_by: user.id,
      });
      if (error) throw error;

      toast.success('Document uploaded! It will appear in the vault shortly.');
      setTitle(''); setDescription(''); setCategory('other'); setFileUrl(null);
      setOpen(false);
      onAdded();
    } catch (error: any) {
      toast.error(friendlyError(error));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Drawer open={open} onOpenChange={setOpen}>
      <DrawerTrigger asChild>
        <Button size="sm" variant="outline" className="gap-1 h-7 text-xs">
          <Plus size={12} /> Upload
        </Button>
      </DrawerTrigger>
      <DrawerContent className="max-h-[85vh] overflow-y-auto">
        <DrawerHeader><DrawerTitle>Upload Document</DrawerTitle></DrawerHeader>
        <div className="space-y-4 px-4 pb-6">
          <div>
            <label className="text-sm font-medium">Category</label>
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="rera_registration">RERA Registration</SelectItem>
                <SelectItem value="commencement_certificate">Commencement Certificate</SelectItem>
                <SelectItem value="environmental_clearance">Environmental Clearance</SelectItem>
                <SelectItem value="fire_noc">Fire NOC</SelectItem>
                <SelectItem value="oc_status">OC Status</SelectItem>
                <SelectItem value="layout_approval">Layout Approval</SelectItem>
                <SelectItem value="other">Other</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-sm font-medium">Title *</label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g., RERA Certificate" />
          </div>
          <div>
            <label className="text-sm font-medium">Description</label>
            <Textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Optional details..." rows={2} />
          </div>
          <div>
            <label className="text-sm font-medium">File *</label>
            <ImageUpload value={fileUrl} onChange={setFileUrl} folder="documents" userId={user?.id || ''} />
          </div>
          <Button onClick={handleSubmit} disabled={isSubmitting || !title.trim() || !fileUrl || !!viewAsSocietyId} className="w-full">
            {isSubmitting && <Loader2 className="animate-spin mr-2" size={16} />}
            Upload Document
          </Button>
          {viewAsSocietyId && (
            <p className="text-xs text-muted-foreground text-center">You are viewing another society. Switch back to create content.</p>
          )}
        </div>
      </DrawerContent>
    </Drawer>
  );
}
