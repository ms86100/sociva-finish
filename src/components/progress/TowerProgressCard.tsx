// @ts-nocheck
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { AlertTriangle, Calendar, Building2 } from 'lucide-react';
import { format } from 'date-fns';

interface Tower {
  id: string;
  name: string;
  total_floors: number;
  expected_completion: string | null;
  revised_completion: string | null;
  delay_reason: string | null;
  delay_category: string | null;
  current_stage: string;
  current_percentage: number;
}

const DELAY_LABELS: Record<string, string> = {
  weather: 'Weather',
  material_shortage: 'Material Shortage',
  government_approval: 'Govt. Approval',
  labour: 'Labour',
  other: 'Other',
};

export function TowerProgressCard({ tower }: { tower: Tower }) {
  const hasDelay = tower.revised_completion && tower.expected_completion &&
    new Date(tower.revised_completion) > new Date(tower.expected_completion);

  return (
    <Card>
      <CardContent className="p-3 space-y-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Building2 size={14} className="text-primary" />
            <span className="font-semibold text-sm">{tower.name}</span>
            {tower.total_floors > 0 && (
              <span className="text-[10px] text-muted-foreground">{tower.total_floors}F</span>
            )}
          </div>
          <span className="text-xs font-bold text-primary">{tower.current_percentage}%</span>
        </div>

        <div className="h-2 w-full rounded-full bg-secondary overflow-hidden">
          <div
            className="h-full bg-primary rounded-full transition-all"
            style={{ width: `${tower.current_percentage}%` }}
          />
        </div>

        <div className="flex items-center gap-3 text-[10px]">
          {tower.expected_completion && (
            <div className="flex items-center gap-1 text-muted-foreground">
              <Calendar size={10} />
              <span>Expected: {format(new Date(tower.expected_completion), 'MMM yyyy')}</span>
            </div>
          )}
          {tower.revised_completion && (
            <div className={`flex items-center gap-1 ${hasDelay ? 'text-destructive font-medium' : 'text-muted-foreground'}`}>
              <Calendar size={10} />
              <span>Revised: {format(new Date(tower.revised_completion), 'MMM yyyy')}</span>
            </div>
          )}
        </div>

        {hasDelay && tower.delay_reason && (
          <div className="flex items-start gap-1.5 bg-destructive/5 rounded-md p-2">
            <AlertTriangle size={12} className="text-destructive mt-0.5 shrink-0" />
            <div>
              {tower.delay_category && (
                <Badge variant="outline" className="text-[9px] h-4 mb-1 border-destructive/30 text-destructive">
                  {DELAY_LABELS[tower.delay_category] || tower.delay_category}
                </Badge>
              )}
              <p className="text-[10px] text-muted-foreground">{tower.delay_reason}</p>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
