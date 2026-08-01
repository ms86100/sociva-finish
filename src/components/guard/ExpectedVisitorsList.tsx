// @ts-nocheck
import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { User, Phone, Car, Clock, CheckCircle, Users, Home, Truck } from 'lucide-react';
import { toast } from 'sonner';

interface ExpectedVisitor {
  id: string;
  visitor_name: string;
  visitor_phone: string | null;
  visitor_type: string;
  vehicle_number: string | null;
  flat_number: string | null;
  expected_time: string | null;
  status: string;
  is_preapproved: boolean;
  is_recurring: boolean;
  checked_in_at: string | null;
}

interface Props {
  societyId: string;
}

export function ExpectedVisitorsList({ societyId }: Props) {
  const [visitors, setVisitors] = useState<ExpectedVisitor[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const today = new Date().toISOString().split('T')[0];

  const fetchVisitors = async () => {
    setIsLoading(true);
    const { data } = await supabase
      .from('visitor_entries')
      .select('id, visitor_name, visitor_phone, visitor_type, vehicle_number, flat_number, expected_time, status, is_preapproved, is_recurring, checked_in_at')
      .eq('society_id', societyId)
      .or(`expected_date.eq.${today},is_recurring.eq.true`)
      .in('status', ['expected', 'checked_in'])
      .order('expected_time', { ascending: true });
    setVisitors((data as ExpectedVisitor[]) || []);
    setIsLoading(false);
  };

  useEffect(() => { fetchVisitors(); }, [societyId]);

  const handleQuickCheckIn = async (visitor: ExpectedVisitor) => {
    const { error } = await supabase.from('visitor_entries')
      .update({ status: 'checked_in', checked_in_at: new Date().toISOString() })
      .eq('id', visitor.id);
    if (!error) {
      // G7 fix: Log gate entry for audit completeness
      await supabase.from('gate_entries').insert({
        society_id: societyId,
        entry_type: 'visitor',
        person_name: visitor.visitor_name,
        flat_number: visitor.flat_number,
        confirmation_status: visitor.is_preapproved ? 'pre_approved' : 'confirmed',
        notes: `Quick check-in from expected visitors list`,
      });
      toast.success(`${visitor.visitor_name} checked in`);
      fetchVisitors();
    }
  };

  const checkedInCount = visitors.filter(v => v.status === 'checked_in').length;
  const expectedCount = visitors.filter(v => v.status === 'expected').length;

  if (isLoading) {
    return <div className="space-y-2">{[1,2,3].map(i => <Skeleton key={i} className="h-16 w-full" />)}</div>;
  }

  return (
    <div className="space-y-4">
      {/* Counters */}
      <div className="grid grid-cols-2 gap-3">
        <Card>
          <CardContent className="p-3 text-center">
            <Clock className="mx-auto text-warning mb-1" size={18} />
            <p className="text-lg font-bold">{expectedCount}</p>
            <p className="text-[10px] text-muted-foreground">Expected Today</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3 text-center">
            <Users className="mx-auto text-success mb-1" size={18} />
            <p className="text-lg font-bold">{checkedInCount}</p>
            <p className="text-[10px] text-muted-foreground">Currently Inside</p>
          </CardContent>
        </Card>
      </div>

      {/* Visitor List */}
      {visitors.length === 0 ? (
        <div className="text-center py-8 text-muted-foreground">
          <Users className="mx-auto mb-2" size={32} />
          <p className="text-sm">No expected visitors today</p>
        </div>
      ) : (
        <div className="space-y-2">
          {visitors.map(v => (
            <Card key={v.id} className={v.status === 'checked_in' ? 'border-success/30 bg-success/5' : ''}>
              <CardContent className="p-3">
                <div className="flex items-center justify-between">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="font-semibold text-sm truncate">{v.visitor_name}</p>
                      <Badge variant="outline" className={`text-[10px] capitalize shrink-0 ${v.visitor_type === 'delivery' ? 'bg-primary/10 text-primary border-primary/30' : ''}`}>
                        {v.visitor_type === 'delivery' && <Truck size={10} className="mr-0.5" />}
                        {v.visitor_type.replace('_', ' ')}
                      </Badge>
                      {v.is_preapproved && (
                        <Badge variant="outline" className="text-[10px] bg-success/10 text-success shrink-0">Pre-approved</Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                      {v.flat_number && <span className="flex items-center gap-0.5"><Home size={10} /> {v.flat_number}</span>}
                      {v.expected_time && <span className="flex items-center gap-0.5"><Clock size={10} /> {v.expected_time}</span>}
                      {v.vehicle_number && <span className="flex items-center gap-0.5"><Car size={10} /> {v.vehicle_number}</span>}
                    </div>
                  </div>
                  {v.status === 'expected' && (
                    <Button size="sm" variant="outline" className="shrink-0 ml-2" onClick={() => handleQuickCheckIn(v)}>
                      <CheckCircle size={14} className="mr-1" /> In
                    </Button>
                  )}
                  {v.status === 'checked_in' && (
                    <Badge className="bg-success/10 text-success text-[10px] shrink-0">Inside</Badge>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
