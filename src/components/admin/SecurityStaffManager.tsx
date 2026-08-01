// @ts-nocheck
import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { escapeIlike } from '@/lib/query-utils';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import { logAudit } from '@/lib/audit';
import { Shield, UserPlus, Trash2, Search } from 'lucide-react';
import type { Profile } from '@/types/database';

interface SecurityStaffEntry {
  id: string;
  user_id: string;
  society_id: string;
  is_active: boolean;
  assigned_by: string | null;
  created_at: string;
  user?: { name: string; flat_number: string | null; block: string | null };
}

export function SecurityStaffManager() {
  const { profile, effectiveSocietyId } = useAuth();
  const [staff, setStaff] = useState<SecurityStaffEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [addOpen, setAddOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<Profile[]>([]);

  const societyId = effectiveSocietyId;

  useEffect(() => {
    if (!societyId) return;
    fetchStaff();
  }, [societyId]);

  const fetchStaff = async () => {
    if (!societyId) return;
    setIsLoading(true);
    const { data } = await supabase
      .from('security_staff')
      .select('*, user:profiles!security_staff_user_id_fkey(name, flat_number, block)')
      .eq('society_id', societyId)
      .is('deactivated_at', null)
      .eq('is_active', true);
    setStaff((data as any) || []);
    setIsLoading(false);
  };

  const searchResidents = async (query: string) => {
    setSearchQuery(query);
    if (query.length < 2 || !societyId) { setSearchResults([]); return; }
    const { data } = await supabase
      .from('profiles')
      .select('*')
      .eq('society_id', societyId)
      .eq('verification_status', 'approved')
      .ilike('name', `%${escapeIlike(query)}%`)
      .limit(10);
    setSearchResults((data as Profile[]) || []);
  };

  const addSecurityOfficer = async (userId: string) => {
    if (!societyId || !profile) return;
    try {
      const { error: staffError } = await supabase.from('security_staff').insert({
        user_id: userId,
        society_id: societyId,
        assigned_by: profile.id,
      });
      if (staffError) {
        if (staffError.code === '23505') {
          toast.error('This user is already a security officer');
          return;
        }
        throw staffError;
      }
      await supabase.from('user_roles').upsert(
        { user_id: userId, role: 'security_officer' as any },
        { onConflict: 'user_id,role' }
      );
      await logAudit('security_officer_added', 'security_staff', userId, societyId, {});
      toast.success('Security officer added');
      setAddOpen(false);
      setSearchQuery('');
      setSearchResults([]);
      fetchStaff();
    } catch (error) {
      toast.error('Failed to add security officer');
    }
  };

  const removeSecurityOfficer = async (staffId: string, userId: string) => {
    if (!societyId) return;
    try {
      await supabase.from('security_staff').update({
        is_active: false,
        deactivated_at: new Date().toISOString(),
      }).eq('id', staffId);
      await supabase.from('user_roles').delete()
        .eq('user_id', userId)
        .eq('role', 'security_officer' as any);
      await logAudit('security_officer_removed', 'security_staff', userId, societyId, {});
      toast.success('Security officer removed');
      fetchStaff();
    } catch (error) {
      toast.error('Failed to remove security officer');
    }
  };

  const existingUserIds = new Set(staff.map(s => s.user_id));
  const filteredResults = searchResults.filter(r => !existingUserIds.has(r.id));

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-xl bg-violet-500/10 flex items-center justify-center">
            <Shield size={15} className="text-violet-600" />
          </div>
          <h3 className="text-sm font-bold text-foreground">Security Officers <span className="text-muted-foreground font-normal text-xs">({staff.length})</span></h3>
        </div>
        <Sheet open={addOpen} onOpenChange={setAddOpen}>
          <SheetTrigger asChild>
            <Button size="sm" variant="outline" className="gap-1.5 rounded-xl font-semibold">
              <UserPlus size={14} /> Add Officer
            </Button>
          </SheetTrigger>
          <SheetContent>
            <SheetHeader><SheetTitle className="font-bold">Add Security Officer</SheetTitle></SheetHeader>
            <div className="mt-4 space-y-4">
              <div className="relative">
                <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Search residents by name..."
                  value={searchQuery}
                  onChange={(e) => searchResidents(e.target.value)}
                  className="pl-9 rounded-xl"
                />
              </div>
              <div className="space-y-2 max-h-96 overflow-y-auto">
                {filteredResults.map((resident) => (
                  <Card key={resident.id} className="border-0 shadow-[var(--shadow-card)] rounded-2xl">
                    <CardContent className="p-3.5 flex items-center justify-between">
                      <div>
                        <p className="font-bold text-sm">{resident.name}</p>
                        <p className="text-xs text-muted-foreground">
                          Block {resident.block}, Flat {resident.flat_number}
                        </p>
                      </div>
                      <Button size="sm" className="rounded-xl font-semibold" onClick={() => addSecurityOfficer(resident.id)}>
                        Add
                      </Button>
                    </CardContent>
                  </Card>
                ))}
                {searchQuery.length >= 2 && filteredResults.length === 0 && (
                  <p className="text-sm text-center text-muted-foreground py-4 font-medium">No matching residents found</p>
                )}
              </div>
            </div>
          </SheetContent>
        </Sheet>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground text-center py-4 font-medium">Loading...</p>
      ) : staff.length === 0 ? (
        <div className="text-center py-12 text-sm text-muted-foreground font-medium">No security officers assigned</div>
      ) : (
        staff.map((officer) => (
          <Card key={officer.id} className="border-0 shadow-[var(--shadow-card)] rounded-2xl">
            <CardContent className="p-3.5 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-violet-500/10 flex items-center justify-center">
                  <Shield size={14} className="text-violet-600" />
                </div>
                <div>
                  <p className="font-bold text-sm">{(officer as any).user?.name || 'Unknown'}</p>
                  <p className="text-xs text-muted-foreground">
                    {(officer as any).user?.block && `Block ${(officer as any).user.block}`}
                    {(officer as any).user?.flat_number && `, Flat ${(officer as any).user.flat_number}`}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant="secondary" className="text-[10px] rounded-md font-semibold bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400">Active</Badge>
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-destructive h-8 w-8 p-0 rounded-xl"
                  onClick={() => removeSecurityOfficer(officer.id, officer.user_id)}
                >
                  <Trash2 size={14} />
                </Button>
              </div>
            </CardContent>
          </Card>
        ))
      )}
    </div>
  );
}
