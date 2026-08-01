// @ts-nocheck
import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Skeleton } from '@/components/ui/skeleton';
import { Users, Building2, Plus, Trash2, Search } from 'lucide-react';
import { toast } from 'sonner';
import { logAudit } from '@/lib/audit';
import { friendlyError } from '@/lib/utils';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  builderId: string;
  builderName: string;
}

interface Member {
  id: string;
  user_id: string;
  role: string;
  created_at: string;
  profile?: { name: string; email: string } | null;
}

interface LinkedSociety {
  id: string;
  society_id: string;
  created_at: string;
  society?: { name: string; address?: string } | null;
}

interface ProfileResult {
  id: string;
  name: string;
  email: string;
}

interface SocietyResult {
  id: string;
  name: string;
}

export function BuilderManagementSheet({ open, onOpenChange, builderId, builderName }: Props) {
  const [members, setMembers] = useState<Member[]>([]);
  const [societies, setSocieties] = useState<LinkedSociety[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Add member
  const [searchTerm, setSearchTerm] = useState('');
  const [searchResults, setSearchResults] = useState<ProfileResult[]>([]);
  const [selectedUserId, setSelectedUserId] = useState('');
  const [memberRole, setMemberRole] = useState('admin');
  const [isSearching, setIsSearching] = useState(false);

  // Add society
  const [availableSocieties, setAvailableSocieties] = useState<SocietyResult[]>([]);
  const [selectedSocietyId, setSelectedSocietyId] = useState('');

  useEffect(() => {
    if (open && builderId) {
      fetchData();
    }
  }, [open, builderId]);

  const fetchData = async () => {
    setIsLoading(true);
    const [membersRes, societiesRes, allSocietiesRes, assignedSocietiesRes] = await Promise.all([
      supabase
        .from('builder_members')
        .select('id, user_id, role, created_at')
        .eq('builder_id', builderId)
        .is('deactivated_at', null),
      supabase
        .from('builder_societies')
        .select('id, society_id, created_at')
        .eq('builder_id', builderId),
      supabase.from('societies').select('id, name').eq('is_active', true).order('name'),
      supabase.from('builder_societies').select('society_id'),
    ]);

    // Enrich members with profile data
    const memberData = (membersRes.data || []) as Member[];
    if (memberData.length > 0) {
      const userIds = memberData.map(m => m.user_id);
      const { data: profiles } = await supabase
        .from('profiles')
        .select('id, name, email')
        .in('id', userIds);
      memberData.forEach(m => {
        m.profile = (profiles || []).find((p: any) => p.id === m.user_id) as any;
      });
    }
    setMembers(memberData);

    // Enrich societies with name
    const societyData = (societiesRes.data || []) as LinkedSociety[];
    if (societyData.length > 0) {
      const socIds = societyData.map(s => s.society_id);
      const { data: socNames } = await supabase
        .from('societies')
        .select('id, name, address')
        .in('id', socIds);
      societyData.forEach(s => {
        s.society = (socNames || []).find((sn: any) => sn.id === s.society_id) as any;
      });
    }
    setSocieties(societyData);

    // Available societies = all active - already assigned to ANY builder
    const assignedIds = new Set((assignedSocietiesRes.data || []).map((a: any) => a.society_id));
    setAvailableSocieties(
      (allSocietiesRes.data || []).filter((s: any) => !assignedIds.has(s.id))
    );

    setIsLoading(false);
  };

  const [hasSearched, setHasSearched] = useState(false);

  const searchProfiles = async (term?: string) => {
    const q = term ?? searchTerm;
    if (q.length < 2) { setSearchResults([]); setHasSearched(false); return; }
    setIsSearching(true);
    const { data } = await supabase
      .from('profiles')
      .select('id, name, email')
      .or(`name.ilike.%${q}%,email.ilike.%${q}%`)
      .limit(10);
    setSearchResults((data || []) as ProfileResult[]);
    setHasSearched(true);
    setIsSearching(false);
  };

  // Debounced auto-search on typing
  useEffect(() => {
    if (searchTerm.length < 2) { setSearchResults([]); setHasSearched(false); return; }
    const timer = setTimeout(() => searchProfiles(searchTerm), 400);
    return () => clearTimeout(timer);
  }, [searchTerm]);

  const addMember = async () => {
    if (!selectedUserId) return;
    const { error } = await supabase.from('builder_members').insert({
      builder_id: builderId,
      user_id: selectedUserId,
      role: memberRole,
    });
    if (error) {
      if (error.code === '23505') toast.error('User is already a member');
      else toast.error(friendlyError(error));
      return;
    }
    await logAudit('builder_member_added', 'builder_members', builderId, null, { user_id: selectedUserId, role: memberRole });
    toast.success('Member added');
    setSelectedUserId('');
    setSearchTerm('');
    setSearchResults([]);
    fetchData();
  };

  const removeMember = async (memberId: string, userId: string) => {
    await supabase.from('builder_members').update({ deactivated_at: new Date().toISOString() }).eq('id', memberId);
    await logAudit('builder_member_removed', 'builder_members', builderId, null, { user_id: userId });
    toast.success('Member removed');
    fetchData();
  };

  const linkSociety = async () => {
    if (!selectedSocietyId) return;
    const { error } = await supabase.from('builder_societies').insert({
      builder_id: builderId,
      society_id: selectedSocietyId,
    });
    if (error) {
      if (error.code === '23505') toast.error('Society already linked');
      else toast.error(friendlyError(error));
      return;
    }
    await logAudit('society_linked_to_builder', 'builder_societies', builderId, null, { society_id: selectedSocietyId });
    toast.success('Society linked');
    setSelectedSocietyId('');
    fetchData();
  };

  const unlinkSociety = async (linkId: string, societyId: string) => {
    await supabase.from('builder_societies').delete().eq('id', linkId);
    await logAudit('society_unlinked_from_builder', 'builder_societies', builderId, null, { society_id: societyId });
    toast.success('Society unlinked');
    fetchData();
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="text-base">Manage: {builderName}</SheetTitle>
        </SheetHeader>

        {isLoading ? (
          <div className="mt-4 space-y-3">
            {[1, 2, 3].map(i => <Skeleton key={i} className="h-12 w-full" />)}
          </div>
        ) : (
          <Tabs defaultValue="members" className="mt-4">
            <TabsList className="w-full grid grid-cols-2">
              <TabsTrigger value="members" className="text-xs gap-1">
                <Users size={12} /> Members ({members.length})
              </TabsTrigger>
              <TabsTrigger value="societies" className="text-xs gap-1">
                <Building2 size={12} /> Societies ({societies.length})
              </TabsTrigger>
            </TabsList>

            {/* MEMBERS TAB */}
            <TabsContent value="members" className="space-y-3 mt-3">
              <Card>
                <CardContent className="p-3 space-y-2">
                  <Label className="text-xs font-semibold">Add Member</Label>
                  <div className="flex gap-2">
                    <Input
                      value={searchTerm}
                      onChange={e => setSearchTerm(e.target.value)}
                      placeholder="Type name or email to search..."
                      className="text-sm"
                    />
                    {isSearching && (
                      <div className="flex items-center px-2">
                        <div className="h-4 w-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                      </div>
                    )}
                  </div>

                  {searchResults.length > 0 && (
                    <div className="border rounded-md max-h-32 overflow-y-auto">
                      {searchResults.map(p => (
                        <button
                          key={p.id}
                          className={`w-full text-left px-3 py-2 text-xs hover:bg-accent transition-colors ${
                            selectedUserId === p.id ? 'bg-accent' : ''
                          }`}
                          onClick={() => setSelectedUserId(p.id)}
                        >
                          <p className="font-medium">{p.name || 'No name'}</p>
                          <p className="text-muted-foreground">{p.email}</p>
                        </button>
                      ))}
                    </div>
                  )}

                  {selectedUserId && (
                    <div className="flex gap-2 items-end">
                      <div className="flex-1">
                        <Label className="text-[10px]">Role</Label>
                        <Select value={memberRole} onValueChange={setMemberRole}>
                          <SelectTrigger className="h-8 text-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="admin">Admin</SelectItem>
                            <SelectItem value="viewer">Viewer</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <Button size="sm" onClick={addMember} className="gap-1">
                        <Plus size={12} /> Add
                      </Button>
                    </div>
                  )}
                </CardContent>
              </Card>

              {members.map(m => (
                <Card key={m.id}>
                  <CardContent className="p-3 flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium">{m.profile?.name || 'Unknown'}</p>
                      <p className="text-[10px] text-muted-foreground">{m.profile?.email}</p>
                      <Badge variant="outline" className="text-[9px] mt-1 capitalize">{m.role}</Badge>
                    </div>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-destructive h-8 w-8 p-0"
                      onClick={() => removeMember(m.id, m.user_id)}
                    >
                      <Trash2 size={14} />
                    </Button>
                  </CardContent>
                </Card>
              ))}
              {hasSearched && searchResults.length === 0 && !isSearching && (
                <p className="text-center text-muted-foreground py-4 text-sm">No matching users found. Try a different name or email.</p>
              )}
              {members.length === 0 && (
                <p className="text-center text-muted-foreground py-4 text-sm">No members yet</p>
              )}
            </TabsContent>

            {/* SOCIETIES TAB */}
            <TabsContent value="societies" className="space-y-3 mt-3">
              <Card>
                <CardContent className="p-3 space-y-2">
                  <Label className="text-xs font-semibold">Link Society</Label>
                  <div className="flex gap-2 items-end">
                    <div className="flex-1">
                      <Select value={selectedSocietyId} onValueChange={setSelectedSocietyId}>
                        <SelectTrigger className="h-8 text-xs">
                          <SelectValue placeholder="Select society" />
                        </SelectTrigger>
                        <SelectContent>
                          {availableSocieties.map(s => (
                            <SelectItem key={s.id} value={s.id} className="text-xs">{s.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <Button size="sm" onClick={linkSociety} disabled={!selectedSocietyId} className="gap-1">
                      <Plus size={12} /> Link
                    </Button>
                  </div>
                  {availableSocieties.length === 0 && (
                    <p className="text-[10px] text-muted-foreground">All societies are already assigned</p>
                  )}
                </CardContent>
              </Card>

              {societies.map(s => (
                <Card key={s.id}>
                  <CardContent className="p-3 flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium">{s.society?.name || 'Unknown Society'}</p>
                      {s.society?.address && (
                        <p className="text-[10px] text-muted-foreground line-clamp-1">{s.society.address}</p>
                      )}
                      <p className="text-[10px] text-muted-foreground">
                        Linked {new Date(s.created_at).toLocaleDateString()}
                      </p>
                    </div>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-destructive h-8 w-8 p-0"
                      onClick={() => unlinkSociety(s.id, s.society_id)}
                    >
                      <Trash2 size={14} />
                    </Button>
                  </CardContent>
                </Card>
              ))}
              {societies.length === 0 && (
                <p className="text-center text-muted-foreground py-4 text-sm">No societies linked</p>
              )}
            </TabsContent>
          </Tabs>
        )}
      </SheetContent>
    </Sheet>
  );
}
