// @ts-nocheck
import { AppLayout } from '@/components/layout/AppLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useBuilderAnalytics } from '@/hooks/useBuilderAnalytics';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, LineChart, Line, Legend
} from 'recharts';
import { TrendingUp, AlertTriangle, Clock, CheckCircle, Building2, ShieldAlert, IndianRupee, BarChart3 } from 'lucide-react';

const CHART_COLORS = ['hsl(var(--primary))', 'hsl(var(--destructive))'];

export default function BuilderAnalyticsPage() {
  const ba = useBuilderAnalytics();

  if (ba.isLoading) return <AppLayout headerTitle="Builder Analytics" showLocation={false}><div className="p-4 space-y-4">{[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-28 w-full" />)}</div></AppLayout>;

  const chartStyle = { background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: '8px', fontSize: 12 };

  return (
    <AppLayout headerTitle="Portfolio Analytics" showLocation={false}>
      <div className="p-4 space-y-4">
        {/* KPIs */}
        <div className="grid grid-cols-2 gap-3">
          <Card><CardContent className="p-3 text-center"><CheckCircle className="mx-auto text-success mb-1" size={18} /><p className="text-xl font-bold tabular-nums">{ba.resolutionRate}%</p><p className="text-[10px] text-muted-foreground">Resolution Rate</p></CardContent></Card>
          <Card><CardContent className="p-3 text-center"><Clock className="mx-auto text-warning mb-1" size={18} /><p className="text-xl font-bold tabular-nums">{ba.totals.avgResolution}h</p><p className="text-[10px] text-muted-foreground">Avg Resolution</p></CardContent></Card>
          <Card><CardContent className="p-3 text-center"><AlertTriangle className="mx-auto text-destructive mb-1" size={18} /><p className="text-xl font-bold tabular-nums">{ba.totals.totalBreached}</p><p className="text-[10px] text-muted-foreground">SLA Breached</p></CardContent></Card>
          <Card><CardContent className="p-3 text-center"><IndianRupee className="mx-auto text-primary mb-1" size={18} /><p className="text-xl font-bold tabular-nums">{ba.formatPrice(ba.totals.totalRevenue)}</p><p className="text-[10px] text-muted-foreground">Total Revenue</p></CardContent></Card>
        </div>

        <Tabs defaultValue="trends">
          <TabsList className="w-full grid grid-cols-3">
            <TabsTrigger value="trends" className="text-xs">Trends</TabsTrigger>
            <TabsTrigger value="comparison" className="text-xs">Comparison</TabsTrigger>
            <TabsTrigger value="sla" className="text-xs">SLA</TabsTrigger>
          </TabsList>

          <TabsContent value="trends" className="mt-4">
            <Card><CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><TrendingUp size={16} /> Complaint Volume (6 months)</CardTitle></CardHeader>
              <CardContent className="p-2"><ResponsiveContainer width="100%" height={220}><LineChart data={ba.monthlyTrend}><CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" /><XAxis dataKey="month" tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" /><YAxis tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" /><Tooltip contentStyle={chartStyle} /><Legend wrapperStyle={{ fontSize: 11 }} /><Line type="monotone" dataKey="complaints" stroke="hsl(var(--destructive))" strokeWidth={2} name="Raised" /><Line type="monotone" dataKey="resolved" stroke="hsl(var(--primary))" strokeWidth={2} name="Resolved" /></LineChart></ResponsiveContainer></CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="comparison" className="mt-4">
            <Card><CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><BarChart3 size={16} /> Society Comparison</CardTitle></CardHeader>
              <CardContent className="p-2"><ResponsiveContainer width="100%" height={220}><BarChart data={ba.snagCategoryData}><CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" /><XAxis dataKey="name" tick={{ fontSize: 9 }} stroke="hsl(var(--muted-foreground))" /><YAxis tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" /><Tooltip contentStyle={chartStyle} /><Legend wrapperStyle={{ fontSize: 11 }} /><Bar dataKey="snags" fill="hsl(var(--warning))" name="Snags" radius={[4, 4, 0, 0]} /><Bar dataKey="disputes" fill="hsl(var(--destructive))" name="Disputes" radius={[4, 4, 0, 0]} /><Bar dataKey="resolved" fill="hsl(var(--primary))" name="Resolved" radius={[4, 4, 0, 0]} /></BarChart></ResponsiveContainer></CardContent>
            </Card>
            <div className="space-y-2 mt-4">
              <h3 className="text-sm font-semibold text-muted-foreground">Per Society</h3>
              {ba.societies.map(s => (
                <Card key={s.id}><CardContent className="p-3">
                  <div className="flex items-center justify-between mb-2"><div className="flex items-center gap-2"><Building2 size={14} className="text-primary" /><p className="font-semibold text-sm">{s.name}</p></div><span className="text-xs text-muted-foreground">{s.memberCount} members</span></div>
                  <div className="grid grid-cols-4 gap-2 text-center">
                    <div><p className="text-xs font-bold">{s.totalSnags}</p><p className="text-[9px] text-muted-foreground">Snags</p></div>
                    <div><p className="text-xs font-bold">{s.totalDisputes}</p><p className="text-[9px] text-muted-foreground">Disputes</p></div>
                    <div><p className="text-xs font-bold text-primary">{s.resolvedSnags + s.resolvedDisputes}</p><p className="text-[9px] text-muted-foreground">Resolved</p></div>
                    <div><p className="text-xs font-bold text-destructive">{s.slaBreached}</p><p className="text-[9px] text-muted-foreground">Breached</p></div>
                  </div>
                </CardContent></Card>
              ))}
            </div>
          </TabsContent>

          <TabsContent value="sla" className="mt-4">
            <Card><CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><ShieldAlert size={16} /> SLA Compliance</CardTitle></CardHeader>
              <CardContent className="flex items-center justify-center p-4">
                {(ba.slaData[0].value + ba.slaData[1].value) > 0 ? (
                  <ResponsiveContainer width="100%" height={200}><PieChart><Pie data={ba.slaData} cx="50%" cy="50%" innerRadius={50} outerRadius={80} paddingAngle={4} dataKey="value" label={({ name, value }) => `${name}: ${value}`}><Cell fill={CHART_COLORS[0]} /><Cell fill={CHART_COLORS[1]} /></Pie><Tooltip /></PieChart></ResponsiveContainer>
                ) : <p className="text-sm text-muted-foreground py-8">No open issues to track</p>}
              </CardContent>
            </Card>
            <div className="space-y-2 mt-4">
              {ba.societies.filter(s => s.slaBreached > 0).map(s => (
                <Card key={s.id} className="border-destructive/30"><CardContent className="p-3 flex items-center justify-between">
                  <div><p className="font-semibold text-sm">{s.name}</p><p className="text-xs text-muted-foreground">{s.avgResolutionHours}h avg</p></div>
                  <div className="text-right"><p className="text-sm font-bold text-destructive">{s.slaBreached} breached</p><p className="text-xs text-muted-foreground">{s.slaOnTrack} on track</p></div>
                </CardContent></Card>
              ))}
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </AppLayout>
  );
}
