// @ts-nocheck
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

/**
 * Unit 1 admin stub. Full ops (verification, rides, safety) land in Unit 12.
 */
export function AdminCleanerCityTab() {
  return (
    <div className="space-y-4" data-testid="admin-cleaner-city-tab">
      <div className="flex items-center gap-2">
        <h2 className="text-lg font-semibold">A Cleaner City</h2>
        <Badge variant="secondary">Unit 1 foundation</Badge>
      </div>
      <p className="text-sm text-muted-foreground max-w-2xl">
        Society-first commute sharing. Enable the <code className="text-xs">cleaner_city</code> feature
        per society in Feature Management for the Greenfield pilot. Matching, ride ops and safety
        dashboards ship in later units.
      </p>

      <div className="grid gap-3 md:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Configuration</CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground space-y-1">
            <p>Feature key: cleaner_city</p>
            <p>Route: /cleaner-city</p>
            <p>Match scope: same_society | neighbours | city (cleaner_city_settings)</p>
            <p>Default scope: neighbours (city-ready via same helper)</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Coming next</CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground space-y-1">
            <p>Work email domain approvals</p>
            <p>Ride monitoring and safety centre</p>
            <p>Match failure analytics</p>
            <p>Fuel cost-share reconciliation (legal-gated)</p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
