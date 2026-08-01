// @ts-nocheck
import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Building2 } from 'lucide-react';

interface SocietyOption {
  id: string;
  name: string;
}

export function SocietySwitcher() {
  const { isAdmin, isBuilderMember, managedBuilderIds, effectiveSocietyId, setViewAsSociety, profile } = useAuth();
  const [societies, setSocieties] = useState<SocietyOption[]>([]);
  const [pendingSwitch, setPendingSwitch] = useState<string | null>(null);

  useEffect(() => {
    fetchSocieties();
  }, [isAdmin, isBuilderMember, managedBuilderIds]);

  const fetchSocieties = async () => {
    if (isAdmin) {
      const { data } = await supabase
        .from('societies')
        .select('id, name')
        .eq('is_active', true)
        .order('name');
      setSocieties((data as SocietyOption[]) || []);
    } else if (isBuilderMember && managedBuilderIds.length > 0) {
      const { data } = await supabase
        .from('builder_societies')
        .select('society:societies!builder_societies_society_id_fkey(id, name)')
        .in('builder_id', managedBuilderIds);
      const mapped = (data || [])
        .map((d: any) => d.society)
        .filter(Boolean) as SocietyOption[];
      setSocieties(mapped);
    }
  };

  if (!isAdmin && !isBuilderMember) return null;
  if (societies.length === 0) return null;

  const currentLabel = effectiveSocietyId && effectiveSocietyId !== profile?.society_id
    ? societies.find(s => s.id === effectiveSocietyId)?.name || 'Society'
    : 'My Society';

  return (
    <>
      <Select
        value={effectiveSocietyId || 'all'}
        onValueChange={(val) => {
          const targetId = val === 'my' || val === 'all' ? null : val;
          const currentId = effectiveSocietyId === profile?.society_id ? null : effectiveSocietyId;
          if (targetId !== currentId) {
            setPendingSwitch(val);
          }
        }}
      >
        <SelectTrigger className="h-8 w-auto max-w-[160px] text-xs border-border/60 bg-background shadow-sm rounded-xl gap-1.5 px-2.5">
          <Building2 size={12} className="text-muted-foreground shrink-0" />
          <SelectValue placeholder="Society" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={profile?.society_id || 'my'} className="text-xs">
            My Society
          </SelectItem>
          {societies
            .filter(s => s.id !== profile?.society_id)
            .map(s => (
              <SelectItem key={s.id} value={s.id} className="text-xs">
                {s.name}
              </SelectItem>
            ))}
        </SelectContent>
      </Select>

      <AlertDialog open={!!pendingSwitch} onOpenChange={(open) => { if (!open) setPendingSwitch(null); }}>
        <AlertDialogContent className="rounded-2xl">
          <AlertDialogHeader>
            <AlertDialogTitle>Switch Society View?</AlertDialogTitle>
            <AlertDialogDescription>
              You are about to view{' '}
              <strong>
                {pendingSwitch === 'my' || pendingSwitch === 'all' || pendingSwitch === profile?.society_id
                  ? 'your home society'
                  : societies.find(s => s.id === pendingSwitch)?.name || 'another society'}
              </strong>.
              Your cart and active orders remain in your home society.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="rounded-xl">Cancel</AlertDialogCancel>
            <AlertDialogAction className="rounded-xl" onClick={() => {
              if (pendingSwitch === 'my' || pendingSwitch === 'all') {
                setViewAsSociety(null);
              } else {
                setViewAsSociety(pendingSwitch!);
              }
              setPendingSwitch(null);
            }}>
              Switch
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
