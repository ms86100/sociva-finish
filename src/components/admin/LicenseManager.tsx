// @ts-nocheck
import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Check, X, FileText, Eye, Clock, Shield } from 'lucide-react';
import { DynamicIcon } from '@/components/ui/DynamicIcon';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { sendPushNotification } from '@/lib/notifications';

interface GroupConfig {
  id: string;
  name: string;
  slug: string;
  icon: string;
  requires_license: boolean;
  license_type_name: string | null;
  license_description: string | null;
  license_mandatory: boolean;
}

interface LicenseSubmission {
  id: string;
  seller_id: string;
  group_id: string;
  license_type: string;
  license_number: string | null;
  document_url: string;
  status: string;
  admin_notes: string | null;
  submitted_at: string;
  reviewed_at: string | null;
  seller?: { business_name: string; profile?: { name: string } };
  group?: { name: string; icon: string };
}

export function LicenseManager() {
  const [groups, setGroups] = useState<GroupConfig[]>([]);
  const [submissions, setSubmissions] = useState<LicenseSubmission[]>([]);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [adminNotes, setAdminNotes] = useState('');
  const [editingGroup, setEditingGroup] = useState<GroupConfig | null>(null);
  const [editForm, setEditForm] = useState({ license_type_name: '', license_description: '' });
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      const [groupsRes, submissionsRes] = await Promise.all([
        supabase.from('parent_groups').select('id, name, slug, icon, requires_license, license_type_name, license_description, license_mandatory').order('sort_order'),
        supabase
          .from('seller_licenses')
          .select('*, seller:seller_profiles!seller_licenses_seller_id_fkey(business_name, profile:profiles!seller_profiles_user_id_fkey(name)), group:parent_groups!seller_licenses_group_id_fkey(name, icon)')
          .order('submitted_at', { ascending: false }),
      ]);

      setGroups((groupsRes.data as any) || []);
      setSubmissions((submissionsRes.data as any) || []);
    } catch (error) {
      console.error('Error fetching license data:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const toggleRequiresLicense = async (group: GroupConfig, checked: boolean) => {
    try {
      await supabase.from('parent_groups').update({ requires_license: checked } as any).eq('id', group.id);
      toast.success(checked ? `License requirement enabled for ${group.name}` : `License requirement disabled for ${group.name}`);
      fetchData();
    } catch (error) {
      toast.error('Failed to update');
    }
  };

  const toggleMandatory = async (group: GroupConfig, checked: boolean) => {
    try {
      await supabase.from('parent_groups').update({ license_mandatory: checked } as any).eq('id', group.id);
      toast.success(checked ? 'License is now mandatory (blocks selling)' : 'License is now optional');
      fetchData();
    } catch (error) {
      toast.error('Failed to update');
    }
  };

  const saveGroupConfig = async () => {
    if (!editingGroup) return;
    try {
      await supabase.from('parent_groups').update({
        license_type_name: editForm.license_type_name.trim() || null,
        license_description: editForm.license_description.trim() || null,
      } as any).eq('id', editingGroup.id);
      toast.success('License config updated');
      setEditingGroup(null);
      fetchData();
    } catch (error) {
      toast.error('Failed to update');
    }
  };

  const updateLicenseStatus = async (licenseId: string, status: 'approved' | 'rejected') => {
    try {
      await supabase
        .from('seller_licenses')
        .update({
          status,
          reviewed_at: new Date().toISOString(),
          admin_notes: adminNotes.trim() || null,
        } as any)
        .eq('id', licenseId);

      // Notify the seller
      const sub = submissions.find(s => s.id === licenseId);
      if (sub) {
        const { data: sellerData } = await supabase
          .from('seller_profiles')
          .select('user_id')
          .eq('id', sub.seller_id)
          .single();

        if (sellerData?.user_id) {
          const licenseType = sub.license_type || 'license';
          const notifTitle = status === 'approved'
            ? `✅ Your ${licenseType} has been verified!`
            : `❌ Your ${licenseType} was rejected`;
          const notifBody = status === 'approved'
            ? `Your ${licenseType} has been verified. You're all set!`
            : `Your ${licenseType} was rejected.${adminNotes.trim() ? ` Reason: ${adminNotes.trim()}` : ' Please re-upload a valid document.'}`;

          const { error: notifError } = await supabase.from('user_notifications').insert({
            user_id: sellerData.user_id,
            title: notifTitle,
            body: notifBody,
            type: status === 'approved' ? 'license_approved' : 'license_rejected',
            is_read: false,
          });
          if (notifError) {
            console.error('Failed to insert license notification:', notifError);
          }

          sendPushNotification({
            userId: sellerData.user_id,
            title: notifTitle,
            body: notifBody,
          }).catch(() => {});
        }
      }

      toast.success(`License ${status}`);
      setAdminNotes('');
      fetchData();
    } catch (error) {
      toast.error('Failed to update license status');
    }
  };

  const statusBadge = (status: string) => {
    switch (status) {
      case 'pending': return <Badge variant="outline" className="text-warning border-warning"><Clock size={10} className="mr-1" /> Pending</Badge>;
      case 'approved': return <Badge variant="outline" className="text-success border-success"><Check size={10} className="mr-1" /> Approved</Badge>;
      case 'rejected': return <Badge variant="outline" className="text-destructive border-destructive"><X size={10} className="mr-1" /> Rejected</Badge>;
      default: return null;
    }
  };

  const pendingCount = submissions.filter(s => s.status === 'pending').length;

  return (
    <div className="space-y-4">
      {/* License Configuration per Group */}
      <Card>
        <CardContent className="p-4 space-y-3">
          <h3 className="font-semibold text-sm flex items-center gap-2">
            <Shield size={16} className="text-primary" />
            License Requirements by Category
          </h3>
          <p className="text-xs text-muted-foreground">
            Configure which category groups require sellers to upload a license before selling.
          </p>
          <div className="space-y-2">
            {groups.map((group) => (
              <div key={group.id} className="flex items-center justify-between p-3 bg-muted rounded-lg">
                <div className="flex items-center gap-2 flex-1 min-w-0">
                  <DynamicIcon name={group.icon} size={18} />
                  <div className="min-w-0">
                    <p className="font-medium text-sm">{group.name}</p>
                    {group.requires_license && group.license_type_name && (
                      <p className="text-[10px] text-muted-foreground truncate">{group.license_type_name}</p>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {group.requires_license && (
                    <>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 text-[10px] px-2"
                        onClick={() => {
                          setEditingGroup(group);
                          setEditForm({
                            license_type_name: group.license_type_name || '',
                            license_description: group.license_description || '',
                          });
                        }}
                      >
                        Edit
                      </Button>
                      <div className="flex items-center gap-1">
                        <span className="text-[10px] text-muted-foreground">Mandatory</span>
                        <Switch
                          checked={group.license_mandatory}
                          onCheckedChange={(checked) => toggleMandatory(group, checked)}
                        />
                      </div>
                    </>
                  )}
                  <Switch
                    checked={group.requires_license}
                    onCheckedChange={(checked) => toggleRequiresLicense(group, checked)}
                  />
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* License Submissions */}
      <h3 className="text-sm font-semibold text-muted-foreground">
        License Submissions ({pendingCount} pending)
      </h3>

      {submissions.length > 0 ? submissions.map((sub) => (
        <Card key={sub.id}>
          <CardContent className="p-3">
            <div className="flex items-start justify-between">
              <div>
                <p className="font-medium text-sm">{(sub as any).seller?.business_name}</p>
                <p className="text-xs text-muted-foreground">{(sub as any).seller?.profile?.name}</p>
                <div className="flex items-center gap-1 mt-0.5">
                  <DynamicIcon name={(sub as any).group?.icon || 'FileText'} size={14} />
                  <span className="text-[10px] text-muted-foreground">{sub.license_type}</span>
                </div>
                {sub.license_number && (
                  <p className="text-[10px] text-muted-foreground">License #: {sub.license_number}</p>
                )}
                {sub.submitted_at && (
                  <p className="text-[10px] text-muted-foreground mt-0.5">
                    Submitted {format(new Date(sub.submitted_at), 'dd MMM yyyy')}
                  </p>
                )}
                <div className="mt-1">{statusBadge(sub.status)}</div>
              </div>
              <div className="flex gap-1.5">
                {sub.document_url && (
                  <Button size="sm" variant="outline" className="h-8 w-8 p-0" onClick={() => setPreviewUrl(sub.document_url)}>
                    <Eye size={14} />
                  </Button>
                )}
              </div>
            </div>
            {sub.status === 'pending' && (
              <div className="mt-3 space-y-2 pt-2 border-t">
                <Textarea
                  placeholder="Admin notes (optional) — feedback for seller"
                  value={adminNotes}
                  onChange={(e) => setAdminNotes(e.target.value)}
                  rows={2}
                  className="text-xs"
                />
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" className="text-destructive flex-1" onClick={() => updateLicenseStatus(sub.id, 'rejected')}>
                    <X size={14} className="mr-1" /> Reject
                  </Button>
                  <Button size="sm" className="flex-1" onClick={() => updateLicenseStatus(sub.id, 'approved')}>
                    <Check size={14} className="mr-1" /> Approve
                  </Button>
                </div>
              </div>
            )}
            {sub.admin_notes && sub.status !== 'pending' && (
              <p className="text-[10px] text-muted-foreground mt-2 pt-2 border-t">
                Admin note: {sub.admin_notes}
              </p>
            )}
          </CardContent>
        </Card>
      )) : (
        <p className="text-center text-muted-foreground py-4 text-sm">No license submissions</p>
      )}

      {/* Document Preview Dialog */}
      <Dialog open={!!previewUrl} onOpenChange={() => setPreviewUrl(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>License Document</DialogTitle>
          </DialogHeader>
          {previewUrl && (
            previewUrl.match(/\.(jpg|jpeg|png|webp)$/i) ? (
              <img src={previewUrl} alt="License Document" className="w-full rounded-lg" />
            ) : (
              <div className="text-center py-8">
                <FileText size={48} className="mx-auto text-muted-foreground mb-4" />
                <a href={previewUrl} target="_blank" rel="noopener noreferrer" className="text-primary underline">
                  Open Document
                </a>
              </div>
            )
          )}
        </DialogContent>
      </Dialog>

      {/* Edit Group License Config Dialog */}
      <Dialog open={!!editingGroup} onOpenChange={() => setEditingGroup(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Configure License for {editingGroup?.name}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">License Type Name</label>
              <Input
                placeholder="e.g., FSSAI Certificate, Clinical License"
                value={editForm.license_type_name}
                onChange={(e) => setEditForm({ ...editForm, license_type_name: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Description / Guidance for Sellers</label>
              <Textarea
                placeholder="Instructions for sellers about what to upload..."
                value={editForm.license_description}
                onChange={(e) => setEditForm({ ...editForm, license_description: e.target.value })}
                rows={3}
              />
            </div>
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={() => setEditingGroup(null)}>Cancel</Button>
              <Button className="flex-1" onClick={saveGroupConfig}>Save</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
