// @ts-nocheck
import { useState, useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { AppLayout } from '@/components/layout/AppLayout';
import { SafeHeader } from '@/components/layout/SafeHeader';
import { Input } from '@/components/ui/input';
import { SocietyTrustBadge } from '@/components/trust/SocietyTrustBadge';
import { useAuth } from '@/contexts/AuthContext';
import { useEffectiveFeatures, type FeatureKey } from '@/hooks/useEffectiveFeatures';
import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';
import { 
  IndianRupee, Building2, Bug, ShieldAlert, FileText, 
  MessageCircle, Radio, ChevronRight, CreditCard, Clock, BarChart3, Shield,
  Users, ClipboardCheck, Landmark, Package, UserCheck, ShieldCheck, Car,
  Wrench, Briefcase, Megaphone, Truck, UserPlus, CalendarDays, Wallet, ClipboardList,
  Search, X, ArrowLeft
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useNavigate } from 'react-router-dom';
import { useSearchPlaceholder } from '@/hooks/useSearchPlaceholder';

interface DashboardItem {
  icon: typeof IndianRupee;
  label: string;
  to: string;
  stat: string;
  iconBg: string;
  iconColor: string;
  adminOnly?: boolean;
  featureKey?: FeatureKey;
  keywords?: string[]; // extra deep-search keywords
}

interface Section {
  title: string;
  emoji: string;
  items: DashboardItem[];
}

export default function SocietyDashboardPage() {
  const navigate = useNavigate();
  const { profile, effectiveSociety, effectiveSocietyId, isAdmin, isSocietyAdmin } = useAuth();
  const { isFeatureEnabled } = useEffectiveFeatures();
  const [searchQuery, setSearchQuery] = useState('');
  const [stats, setStats] = useState({
    openSnags: 0,
    openDisputes: 0,
    recentExpenses: 0,
    recentMilestones: 0,
    documents: 0,
    unansweredQs: 0,
    pendingDues: 0,
  });
  const [avgResponseHours, setAvgResponseHours] = useState<number | null>(null);

  useEffect(() => {
    if (!effectiveSocietyId) return;
    fetchStats();
    fetchCommitteeResponseTime();
  }, [effectiveSocietyId]);

  const fetchStats = async () => {
    const sid = effectiveSocietyId!;
    const [snags, disputes, expenses, milestones, docs, questions, dues] = await Promise.all([
      supabase.from('snag_tickets').select('id', { count: 'exact', head: true }).eq('society_id', sid).not('status', 'in', '("fixed","verified","closed")'),
      supabase.from('dispute_tickets').select('id', { count: 'exact', head: true }).eq('society_id', sid).not('status', 'in', '("resolved","closed")'),
      supabase.from('society_expenses').select('id', { count: 'exact', head: true }).eq('society_id', sid).gte('created_at', new Date(Date.now() - 30 * 86400000).toISOString()),
      supabase.from('construction_milestones').select('id', { count: 'exact', head: true }).eq('society_id', sid).gte('created_at', new Date(Date.now() - 7 * 86400000).toISOString()),
      supabase.from('project_documents').select('id', { count: 'exact', head: true }).eq('society_id', sid),
      supabase.from('project_questions').select('id', { count: 'exact', head: true }).eq('society_id', sid).eq('is_answered', false),
      supabase.from('maintenance_dues').select('id', { count: 'exact', head: true }).eq('society_id', sid).eq('status', 'pending'),
    ]);

    setStats({
      openSnags: snags.count || 0,
      openDisputes: disputes.count || 0,
      recentExpenses: expenses.count || 0,
      recentMilestones: milestones.count || 0,
      documents: docs.count || 0,
      unansweredQs: questions.count || 0,
      pendingDues: dues.count || 0,
    });
  };

  const fetchCommitteeResponseTime = async () => {
    const sid = effectiveSocietyId!;
    const { data: disputes } = await supabase
      .from('dispute_tickets')
      .select('created_at, acknowledged_at')
      .eq('society_id', sid)
      .not('acknowledged_at', 'is', null)
      .gte('created_at', new Date(Date.now() - 90 * 86400000).toISOString());

    const { data: snags } = await supabase
      .from('snag_tickets')
      .select('created_at, acknowledged_at')
      .eq('society_id', sid)
      .not('acknowledged_at', 'is', null)
      .gte('created_at', new Date(Date.now() - 90 * 86400000).toISOString());

    const allItems = [...(disputes || []), ...(snags || [])];
    if (allItems.length === 0) {
      setAvgResponseHours(null);
      return;
    }

    const totalHours = allItems.reduce((sum, item) => {
      const created = new Date(item.created_at).getTime();
      const acked = new Date(item.acknowledged_at!).getTime();
      return sum + (acked - created) / 3600000;
    }, 0);

    setAvgResponseHours(Math.round(totalHours / allItems.length));
  };

  const sections: Section[] = useMemo(() => {
    const allSections: Section[] = [
      {
        title: 'Security & Access',
        emoji: '🔐',
        items: [
          { icon: Users, label: 'Visitors', to: '/visitors', stat: 'Gate Management', iconBg: 'bg-info/10', iconColor: 'text-info', featureKey: 'visitor_management', keywords: ['guest', 'entry', 'otp', 'gate', 'security', 'pass', 'invite'] },
          { icon: UserPlus, label: 'Authorized Persons', to: '/authorized-persons', stat: 'Family gate access', iconBg: 'bg-primary/10', iconColor: 'text-primary', featureKey: 'visitor_management', keywords: ['family', 'relative', 'permanent', 'access', 'approve'] },
          { icon: Car, label: 'Parking', to: '/parking', stat: 'Slots & violations', iconBg: 'bg-info/10', iconColor: 'text-info', featureKey: 'vehicle_parking', keywords: ['vehicle', 'car', 'bike', 'slot', 'sticker', 'violation'] },
          { icon: Package, label: 'Parcels', to: '/parcels', stat: 'Delivery tracking', iconBg: 'bg-warning/10', iconColor: 'text-warning', featureKey: 'parcel_management', keywords: ['courier', 'amazon', 'flipkart', 'package', 'collect'] },
        ],
      },
      {
        title: 'Workforce',
        emoji: '👷',
        items: [
          { icon: UserCheck, label: 'My Workers', to: '/my-workers', stat: 'Registered help', iconBg: 'bg-success/10', iconColor: 'text-success', featureKey: 'workforce_management', keywords: ['maid', 'cook', 'driver', 'nanny', 'domestic', 'help', 'staff'] },
          { icon: Wrench, label: 'Workforce Mgmt', to: '/workforce', stat: 'Manage workers', iconBg: 'bg-warning/10', iconColor: 'text-warning', featureKey: 'workforce_management', keywords: ['manage', 'register', 'worker', 'employee', 'staff'] },
          { icon: Briefcase, label: 'Hire Workers', to: '/worker-hire', stat: 'Find local help', iconBg: 'bg-primary/10', iconColor: 'text-primary', featureKey: 'worker_marketplace', keywords: ['plumber', 'electrician', 'carpenter', 'cleaner', 'job', 'hire'] },
        ],
      },
      {
        title: 'Finances & Payments',
        emoji: '💰',
        items: [
          { icon: IndianRupee, label: 'Finances', to: '/society/finances', stat: `${stats.recentExpenses} this month`, iconBg: 'bg-success/10', iconColor: 'text-success', featureKey: 'finances', keywords: ['expense', 'income', 'budget', 'money', 'billing', 'account', 'revenue'] },
          { icon: Landmark, label: 'Payment Schedule', to: '/payment-milestones', stat: 'Track milestones', iconBg: 'bg-info/10', iconColor: 'text-info', featureKey: 'payment_milestones', keywords: ['emi', 'installment', 'due', 'schedule', 'builder', 'payment'] },
          { icon: CreditCard, label: 'Maintenance', to: '/maintenance', stat: stats.pendingDues > 0 ? `${stats.pendingDues} pending` : 'All clear', iconBg: 'bg-success/10', iconColor: 'text-success', featureKey: 'maintenance', keywords: ['dues', 'monthly', 'charge', 'fee', 'bill', 'society charge'] },
        ],
      },
      {
        title: 'Construction & Quality',
        emoji: '🏗️',
        items: [
          { icon: Building2, label: 'Construction', to: '/society/progress', stat: `${stats.recentMilestones} updates`, iconBg: 'bg-primary/10', iconColor: 'text-primary', featureKey: 'construction_progress', keywords: ['building', 'progress', 'milestone', 'tower', 'flat', 'handover'] },
          { icon: Bug, label: 'Snag Reports', to: '/society/snags', stat: `${stats.openSnags} open`, iconBg: 'bg-destructive/10', iconColor: 'text-destructive', featureKey: 'snag_management', keywords: ['defect', 'issue', 'complaint', 'repair', 'fix', 'damage', 'broken'] },
          { icon: ClipboardCheck, label: 'Inspection', to: '/inspection', stat: 'Pre-handover check', iconBg: 'bg-success/10', iconColor: 'text-success', featureKey: 'inspection', keywords: ['checklist', 'pre-handover', 'quality', 'check', 'verify'] },
          { icon: FileText, label: 'Documents', to: '/society/progress', stat: `${stats.documents} uploaded`, iconBg: 'bg-info/10', iconColor: 'text-info', featureKey: 'construction_progress', keywords: ['file', 'pdf', 'agreement', 'plan', 'blueprint', 'approval', 'noc'] },
          { icon: MessageCircle, label: 'Q&A', to: '/society/progress', stat: `${stats.unansweredQs} unanswered`, iconBg: 'bg-primary/10', iconColor: 'text-primary', featureKey: 'construction_progress', keywords: ['question', 'answer', 'ask', 'query', 'doubt'] },
        ],
      },
      {
        title: 'Community',
        emoji: '🏘️',
        items: [
          { icon: ShieldAlert, label: 'Disputes', to: '/disputes', stat: `${stats.openDisputes} open`, iconBg: 'bg-destructive/10', iconColor: 'text-destructive', featureKey: 'disputes', keywords: ['complaint', 'issue', 'grievance', 'escalate', 'resolve', 'ticket'] },
          { icon: Truck, label: 'Deliveries', to: '/society/deliveries', stat: 'Track deliveries', iconBg: 'bg-warning/10', iconColor: 'text-warning', featureKey: 'delivery_management', keywords: ['delivery', 'rider', 'order', 'track', 'shipping'] },
          { icon: Megaphone, label: 'Notices', to: '/society/notices', stat: 'Official circulars', iconBg: 'bg-warning/10', iconColor: 'text-warning', featureKey: 'society_notices', keywords: ['announcement', 'circular', 'notice', 'news', 'update', 'alert'] },
        ],
      },
    ];

    // Admin-only section
    if (isSocietyAdmin) {
      allSections.push({
        title: 'Admin Tools',
        emoji: '⚙️',
        items: [
          { icon: CalendarDays, label: 'Worker Attendance', to: '/worker-attendance', stat: 'Track attendance', iconBg: 'bg-primary/10', iconColor: 'text-primary', featureKey: 'workforce_management', keywords: ['attendance', 'check-in', 'present', 'absent'] },
          { icon: ClipboardList, label: 'Worker Leave', to: '/worker-leave', stat: 'Leave records', iconBg: 'bg-primary/10', iconColor: 'text-primary', featureKey: 'workforce_management', keywords: ['leave', 'off', 'holiday', 'absence'] },
          { icon: Wallet, label: 'Worker Salary', to: '/worker-salary', stat: 'Salary records', iconBg: 'bg-success/10', iconColor: 'text-success', featureKey: 'workforce_management', keywords: ['salary', 'pay', 'wage', 'payment'] },
          { icon: Truck, label: 'Delivery Partners', to: '/delivery-partners', stat: 'Manage partners', iconBg: 'bg-warning/10', iconColor: 'text-warning', featureKey: 'delivery_management', keywords: ['delivery', 'partner', 'rider', 'logistics'] },
          { icon: ShieldCheck, label: 'Guard Kiosk', to: '/guard-kiosk', stat: 'Verify visitor OTPs', iconBg: 'bg-success/10', iconColor: 'text-success', featureKey: 'guard_kiosk', keywords: ['guard', 'security', 'otp', 'verify', 'gate', 'watchman'] },
          { icon: Shield, label: 'Society Admin', to: '/society/admin', stat: 'Manage society', iconBg: 'bg-info/10', iconColor: 'text-info', keywords: ['admin', 'settings', 'manage', 'configure', 'committee'] },
        ],
      });
    }

    if (isAdmin) {
      allSections.push({
        title: 'Platform',
        emoji: '🌐',
        items: [
          { icon: Radio, label: 'Platform Admin', to: '/admin', stat: 'Global admin', iconBg: 'bg-destructive/10', iconColor: 'text-destructive', adminOnly: true },
        ],
      });
    }

    // Filter items by feature gates
    return allSections
      .map(section => ({
        ...section,
        items: section.items.filter(item => !item.featureKey || isFeatureEnabled(item.featureKey)),
      }))
      .filter(section => section.items.length > 0);
  }, [stats, isAdmin, isSocietyAdmin, isFeatureEnabled]);

  // Deep search: filter sections by query matching label, stat, section title, and keywords
  const filteredSections = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    if (!q) return sections;
    return sections
      .map(section => ({
        ...section,
        items: section.items.filter(item => {
          const haystack = [
            item.label,
            item.stat,
            section.title,
            ...(item.keywords || []),
          ].join(' ').toLowerCase();
          return haystack.includes(q);
        }),
      }))
      .filter(section => section.items.length > 0);
  }, [sections, searchQuery]);

  const societyPlaceholder = useSearchPlaceholder('society');

  return (
    <AppLayout showHeader={false}>
      {/* Custom Society Header */}
      <SafeHeader zIndex="z-40">
        <div className="px-3 pt-2.5 pb-2">
          <div className="flex items-center gap-2 mb-2">
            <Button
              variant="ghost"
              size="icon"
              className="h-10 w-10 rounded-full shrink-0"
              onClick={() => navigate(-1)}
            >
              <ArrowLeft size={18} />
            </Button>
            <h1 className="text-base font-bold text-foreground flex-1 truncate">
              {effectiveSociety?.name || 'Society'}
            </h1>
          </div>

          {/* Society-contextual search */}
          <div className="relative">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder={societyPlaceholder}
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="pl-8 pr-7 h-9 bg-muted border-0 rounded-xl text-xs"
            />
            {searchQuery && (
              <button onClick={() => setSearchQuery('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground">
                <X size={12} />
              </button>
            )}
          </div>
        </div>
      </SafeHeader>

      <div className="px-4 py-3 space-y-4">
        {/* Trust Badge - gated */}
        {!searchQuery && isFeatureEnabled('trust_score') && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3 }}
          >
            <SocietyTrustBadge />
          </motion.div>
        )}

        {/* Committee Response Time */}
        {!searchQuery && avgResponseHours !== null && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.05, duration: 0.3 }}
            className="flex items-center gap-3 px-3 py-2.5 rounded-xl bg-primary/5 border border-primary/15"
          >
            <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center">
              <Clock size={18} className="text-primary" />
            </div>
            <div className="flex-1">
              <p className="text-[10px] text-muted-foreground font-medium">Avg. committee response</p>
              <p className="text-base font-bold text-primary leading-tight tabular-nums">
                {avgResponseHours < 1 ? '<1 hour' : `${avgResponseHours}h`}
              </p>
            </div>
          </motion.div>
        )}

        {/* Grouped Sections */}
        {filteredSections.length === 0 && searchQuery ? (
          <div className="text-center py-12">
            <Search size={32} className="mx-auto text-muted-foreground mb-3" />
            <p className="text-sm font-semibold text-foreground">No results for "{searchQuery}"</p>
            <p className="text-xs text-muted-foreground mt-1">Try a different keyword</p>
          </div>
        ) : filteredSections.length === 0 && !searchQuery ? (
          <div className="text-center py-12">
            <Building2 size={32} className="mx-auto text-muted-foreground mb-3" />
            <p className="text-sm font-semibold text-foreground">No features enabled</p>
            <p className="text-xs text-muted-foreground mt-1 max-w-[240px] mx-auto">Society features haven't been configured yet. Contact your society admin to get started.</p>
          </div>
        ) : (
          filteredSections.map((section, sIdx) => (
            <motion.div
              key={section.title}
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.08 + sIdx * 0.06, duration: 0.35 }}
            >
              {/* Section header */}
              <div className="flex items-center gap-2 mb-2">
                <span className="text-sm">{section.emoji}</span>
                <h3 className="text-xs font-bold text-foreground uppercase tracking-wider">{section.title}</h3>
                <div className="flex-1 h-px bg-border" />
              </div>

              {/* Cards */}
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {section.items.map((item, iIdx) => {
                  const Icon = item.icon;
                  return (
                    <motion.div
                      key={item.label}
                      initial={{ opacity: 0, scale: 0.93 }}
                      animate={{ opacity: 1, scale: 1 }}
                      transition={{ delay: 0.08 + sIdx * 0.06 + iIdx * 0.03, duration: 0.25 }}
                    >
                      <Link
                        to={item.to}
                        className="flex flex-col items-center gap-1.5 p-3 rounded-2xl bg-card border border-border active:scale-[0.97] transition-transform text-center"
                      >
                        <div className={cn('w-10 h-10 rounded-xl flex items-center justify-center', item.iconBg)}>
                          <Icon size={20} className={item.iconColor} />
                        </div>
                        <span className="text-[11px] font-semibold text-foreground leading-tight line-clamp-1">{item.label}</span>
                        <span className="text-[9px] text-muted-foreground leading-tight line-clamp-1">{item.stat}</span>
                      </Link>
                    </motion.div>
                  );
                })}
              </div>
            </motion.div>
          ))
        )}

        {/* Monthly Report Link - gated */}
        {!searchQuery && isFeatureEnabled('monthly_report_card') && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.4, duration: 0.3 }}
          >
            <Link to="/society/reports">
              <div className="flex items-center gap-3 px-4 py-3 rounded-2xl bg-gradient-to-r from-primary/10 via-primary/5 to-transparent border border-primary/15 active:scale-[0.98] transition-transform">
                <div className="w-10 h-10 rounded-xl bg-primary/15 flex items-center justify-center">
                  <BarChart3 size={20} className="text-primary" />
                </div>
                <div className="flex-1">
                  <p className="text-sm font-bold text-foreground">Monthly Report Card</p>
                  <p className="text-[10px] text-muted-foreground">Auto-generated transparency report</p>
                </div>
                <ChevronRight size={16} className="text-muted-foreground" />
              </div>
            </Link>
          </motion.div>
        )}
      </div>
    </AppLayout>
  );
}
