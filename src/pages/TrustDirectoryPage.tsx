// @ts-nocheck
import { useState, useEffect, useCallback } from 'react';
import { AppLayout } from '@/components/layout/AppLayout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from '@/components/ui/drawer';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { escapeIlike } from '@/lib/query-utils';
import { toast } from '@/hooks/use-toast';
import { cn, friendlyError } from '@/lib/utils';
import { Search, Plus, Loader2, Award, ThumbsUp, Star } from 'lucide-react';

interface SkillListing {
  id: string;
  user_id: string;
  skill_name: string;
  description: string | null;
  availability: string | null;
  trust_score: number;
  endorsement_count: number;
  created_at: string;
  user?: { name: string; block: string; flat_number: string; avatar_url: string | null };
  user_has_endorsed?: boolean;
}

export default function TrustDirectoryPage() {
  const { user, profile } = useAuth();
  const [skills, setSkills] = useState<SkillListing[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [newSkill, setNewSkill] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [newAvail, setNewAvail] = useState('');
  const [saving, setSaving] = useState(false);
  const [userEndorsements, setUserEndorsements] = useState<Set<string>>(new Set());

  const fetchSkills = useCallback(async () => {
    setLoading(true);
    let query = supabase
      .from('skill_listings')
      .select('*, user:profiles!skill_listings_user_id_fkey(name, block, flat_number, avatar_url)')
      .order('trust_score', { ascending: false });

    if (search.trim()) {
      query = query.ilike('skill_name', `%${escapeIlike(search)}%`);
    }

    const { data } = await query;
    setSkills((data as any) || []);
    setLoading(false);
  }, [search]);

  const fetchEndorsements = useCallback(async () => {
    if (!user) return;
    const { data } = await supabase
      .from('skill_endorsements')
      .select('skill_id')
      .eq('endorser_id', user.id);
    setUserEndorsements(new Set((data || []).map(e => e.skill_id)));
  }, [user]);

  useEffect(() => { fetchSkills(); fetchEndorsements(); }, [fetchSkills, fetchEndorsements]);

  const handleAddSkill = async () => {
    if (!newSkill.trim() || !profile?.society_id || !user) return;
    setSaving(true);
    try {
      const { error } = await supabase.from('skill_listings').insert({
        user_id: user.id,
        society_id: profile.society_id,
        skill_name: newSkill.trim(),
        description: newDesc.trim() || null,
        availability: newAvail.trim() || null,
      });
      if (error) throw error;
      toast({ title: 'Skill added!' });
      setNewSkill(''); setNewDesc(''); setNewAvail('');
      setShowAdd(false);
      fetchSkills();
    } catch (err: any) {
      toast({ title: 'Failed', description: friendlyError(err), variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const handleEndorse = async (skillId: string) => {
    if (!user) return;
    if (userEndorsements.has(skillId)) {
      await supabase.from('skill_endorsements').delete().eq('skill_id', skillId).eq('endorser_id', user.id);
      setUserEndorsements(prev => { const n = new Set(prev); n.delete(skillId); return n; });
    } else {
      await supabase.from('skill_endorsements').insert({ skill_id: skillId, endorser_id: user.id });
      setUserEndorsements(prev => new Set(prev).add(skillId));
    }
    fetchSkills();
  };

  return (
    <AppLayout headerTitle="Community Directory" showLocation={false}>
      <div className="p-4 space-y-4">
        <div className="relative">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search skills..." className="pl-9 h-9 text-sm" />
        </div>

        {loading ? (
          <div className="flex justify-center py-12"><Loader2 className="animate-spin text-muted-foreground" /></div>
        ) : skills.length === 0 ? (
          <div className="text-center py-12">
            <Award size={32} className="mx-auto text-muted-foreground mb-3" />
            <p className="text-muted-foreground text-sm">No skills listed yet</p>
            <p className="text-xs text-muted-foreground mt-1">Add your skills to help your neighbors find you</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3">
            {skills.map(skill => (
              <div key={skill.id} className="bg-card rounded-xl border border-border p-4 space-y-2">
                <div className="flex items-start justify-between">
                  <div>
                    <h4 className="font-semibold text-sm">{skill.skill_name}</h4>
                    <p className="text-xs text-muted-foreground">{skill.user?.name} · {skill.user?.block}-{skill.user?.flat_number}</p>
                  </div>
                  <div className="flex items-center gap-1">
                    <Star size={12} className="text-rating-star fill-rating-star" />
                    <span className="text-xs font-medium tabular-nums">{skill.trust_score}</span>
                  </div>
                </div>
                {skill.description && <p className="text-xs text-muted-foreground">{skill.description}</p>}
                {skill.availability && (
                  <p className="text-[10px] text-muted-foreground">Available: {skill.availability}</p>
                )}
                <div className="flex items-center justify-between pt-1">
                  <span className="text-[10px] text-muted-foreground">{skill.endorsement_count} endorsements</span>
                  {skill.user_id !== user?.id && (
                    <Button
                      variant={userEndorsements.has(skill.id) ? 'default' : 'outline'}
                      size="sm"
                      className="h-7 text-xs gap-1"
                      onClick={() => handleEndorse(skill.id)}
                    >
                      <ThumbsUp size={12} />
                      {userEndorsements.has(skill.id) ? 'Endorsed' : 'Endorse'}
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <Button
        size="icon"
        className="fixed bottom-24 right-4 z-40 w-12 h-12 rounded-full shadow-lg"
        onClick={() => setShowAdd(true)}
      >
        <Plus size={22} />
      </Button>

      <Drawer open={showAdd} onOpenChange={setShowAdd}>
        <DrawerContent>
          <DrawerHeader><DrawerTitle>Add Your Skill</DrawerTitle></DrawerHeader>
          <div className="space-y-4 mt-4">
            <div>
              <Label>Skill Name</Label>
              <Input value={newSkill} onChange={e => setNewSkill(e.target.value)} placeholder="e.g. Math Tutoring, Plumbing" />
            </div>
            <div>
              <Label>Description (optional)</Label>
              <Textarea value={newDesc} onChange={e => setNewDesc(e.target.value)} placeholder="What can you help with?" rows={3} />
            </div>
            <div>
              <Label>Availability (optional)</Label>
              <Input value={newAvail} onChange={e => setNewAvail(e.target.value)} placeholder="e.g. Weekends, After 6 PM" />
            </div>
            <Button className="w-full" onClick={handleAddSkill} disabled={saving || !newSkill.trim()}>
              {saving ? <Loader2 size={16} className="animate-spin mr-2" /> : null}
              Add Skill
            </Button>
          </div>
        </DrawerContent>
      </Drawer>
    </AppLayout>
  );
}
