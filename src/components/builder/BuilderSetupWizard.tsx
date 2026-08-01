// @ts-nocheck
import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerTrigger } from '@/components/ui/drawer';
import { toast } from 'sonner';
import { Wand2, CheckCircle, Circle, Building2, Layers, CreditCard, ParkingCircle } from 'lucide-react';

interface SetupStep {
  key: string;
  label: string;
  icon: typeof Building2;
  description: string;
  featureKey?: string;
}

const SETUP_STEPS: SetupStep[] = [
  { key: 'towers', label: 'Add Towers', icon: Building2, description: 'Define tower names for your society', featureKey: 'construction_progress' },
  { key: 'parking', label: 'Set Up Parking', icon: ParkingCircle, description: 'Configure parking slot capacity', featureKey: 'vehicle_parking' },
  { key: 'milestones', label: 'Payment Milestones', icon: CreditCard, description: 'Set construction-linked payment stages', featureKey: 'payment_milestones' },
  { key: 'categories', label: 'Marketplace Categories', icon: Layers, description: 'Enable product categories for sellers', featureKey: 'marketplace' },
];

interface Props {
  societyId: string;
  societyName: string;
  enabledFeatures?: string[];
}

export function BuilderSetupWizard({ societyId, societyName, enabledFeatures = [] }: Props) {
  const [open, setOpen] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);
  const [completed, setCompleted] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);

  // Tower form
  const [towerNames, setTowerNames] = useState('');
  // Parking form
  const [twoWheeler, setTwoWheeler] = useState('');
  const [fourWheeler, setFourWheeler] = useState('');
  // Milestones form
  const [milestoneNames, setMilestoneNames] = useState('');

  const visibleSteps = SETUP_STEPS.filter(
    s => !s.featureKey || enabledFeatures.length === 0 || enabledFeatures.includes(s.featureKey)
  );

  const handleAddTowers = async () => {
    if (!towerNames.trim()) return;
    setLoading(true);
    const names = towerNames.split(',').map(n => n.trim()).filter(Boolean);
    const rows = names.map(name => ({ society_id: societyId, tower_name: name }));
    const { error } = await supabase.from('project_towers').insert(rows as any);
    if (error) { toast.error('Failed to add towers'); }
    else { toast.success(`Added ${names.length} towers`); markDone('towers'); }
    setLoading(false);
  };

  const handleSetupParking = async () => {
    setLoading(true);
    const slots: any[] = [];
    const tw = parseInt(twoWheeler) || 0;
    const fw = parseInt(fourWheeler) || 0;
    for (let i = 1; i <= tw; i++) slots.push({ society_id: societyId, slot_number: `2W-${i}`, slot_type: 'two_wheeler' });
    for (let i = 1; i <= fw; i++) slots.push({ society_id: societyId, slot_number: `4W-${i}`, slot_type: 'four_wheeler' });
    if (slots.length === 0) { toast.error('Enter slot counts'); setLoading(false); return; }
    const { error } = await supabase.from('parking_slots').insert(slots);
    if (error) { toast.error('Failed to create slots'); }
    else { toast.success(`Created ${slots.length} parking slots`); markDone('parking'); }
    setLoading(false);
  };

  const handleAddMilestones = async () => {
    if (!milestoneNames.trim()) return;
    setLoading(true);
    const names = milestoneNames.split(',').map(n => n.trim()).filter(Boolean);
    const rows = names.map((name, i) => ({
      society_id: societyId,
      title: name,
      milestone_order: i + 1,
      status: 'upcoming',
    }));
    const { error } = await supabase.from('payment_milestones').insert(rows as any);
    if (error) { toast.error('Failed to add milestones'); }
    else { toast.success(`Added ${names.length} milestones`); markDone('milestones'); }
    setLoading(false);
  };

  const markDone = (key: string) => {
    setCompleted(prev => [...prev, key]);
    if (currentStep < visibleSteps.length - 1) setCurrentStep(prev => prev + 1);
  };

  const step = visibleSteps[currentStep];

  return (
    <Drawer open={open} onOpenChange={setOpen}>
      <DrawerTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1.5">
          <Wand2 size={14} /> Setup Wizard
        </Button>
      </DrawerTrigger>
      <DrawerContent className="max-h-[80vh] overflow-y-auto">
        <DrawerHeader>
          <DrawerTitle>Setup: {societyName}</DrawerTitle>
        </DrawerHeader>
        <div className="mt-4 space-y-4">
          {/* Progress */}
          <div className="flex gap-2 flex-wrap">
            {visibleSteps.map((s, i) => (
              <Badge
                key={s.key}
                variant={completed.includes(s.key) ? 'default' : i === currentStep ? 'secondary' : 'outline'}
                className="gap-1 cursor-pointer text-xs"
                onClick={() => setCurrentStep(i)}
              >
                {completed.includes(s.key) ? <CheckCircle size={10} /> : <Circle size={10} />}
                {s.label}
              </Badge>
            ))}
          </div>

          {/* Current Step Form */}
          {step && (
            <Card>
              <CardContent className="p-4 space-y-3">
                <div className="flex items-center gap-2">
                  <step.icon size={18} className="text-primary" />
                  <div>
                    <p className="font-semibold text-sm">{step.label}</p>
                    <p className="text-xs text-muted-foreground">{step.description}</p>
                  </div>
                </div>

                {step.key === 'towers' && (
                  <>
                    <Label className="text-xs">Tower names (comma-separated)</Label>
                    <Input value={towerNames} onChange={e => setTowerNames(e.target.value)} placeholder="Tower A, Tower B, Tower C" />
                    <Button onClick={handleAddTowers} disabled={loading || !towerNames.trim()} className="w-full">
                      {loading ? 'Adding...' : 'Add Towers'}
                    </Button>
                  </>
                )}

                {step.key === 'parking' && (
                  <>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <Label className="text-xs">2-Wheeler Slots</Label>
                        <Input type="number" value={twoWheeler} onChange={e => setTwoWheeler(e.target.value)} placeholder="50" />
                      </div>
                      <div>
                        <Label className="text-xs">4-Wheeler Slots</Label>
                        <Input type="number" value={fourWheeler} onChange={e => setFourWheeler(e.target.value)} placeholder="100" />
                      </div>
                    </div>
                    <Button onClick={handleSetupParking} disabled={loading} className="w-full">
                      {loading ? 'Creating...' : 'Create Parking Slots'}
                    </Button>
                  </>
                )}

                {step.key === 'milestones' && (
                  <>
                    <Label className="text-xs">Milestone names (comma-separated)</Label>
                    <Input value={milestoneNames} onChange={e => setMilestoneNames(e.target.value)} placeholder="Booking, Foundation, Slab, Finishing, Possession" />
                    <Button onClick={handleAddMilestones} disabled={loading || !milestoneNames.trim()} className="w-full">
                      {loading ? 'Adding...' : 'Add Milestones'}
                    </Button>
                  </>
                )}

                {step.key === 'categories' && (
                  <div className="text-center py-4 text-muted-foreground text-sm">
                    <p>Marketplace categories are configured from the Admin panel.</p>
                    <Button variant="link" size="sm" onClick={() => { setOpen(false); markDone('categories'); }}>
                      Skip for now
                    </Button>
                  </div>
                )}

                {completed.includes(step.key) && (
                  <div className="flex items-center gap-2 text-success text-sm">
                    <CheckCircle size={16} /> Completed
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {completed.length === visibleSteps.length && (
            <div className="text-center py-4">
              <CheckCircle size={32} className="mx-auto text-success mb-2" />
              <p className="font-semibold">Setup Complete!</p>
              <p className="text-xs text-muted-foreground">All initial configuration is done.</p>
              <Button variant="outline" className="mt-3" onClick={() => setOpen(false)}>Close</Button>
            </div>
          )}
        </div>
      </DrawerContent>
    </Drawer>
  );
}
