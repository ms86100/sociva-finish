// @ts-nocheck
import { useNavigate } from 'react-router-dom';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Home, Search, LayoutGrid, ShoppingCart, Package, User, Heart, Star,
  Store, Settings, BarChart3, DollarSign, Shield, ClipboardList, Eye,
  Building2, MessageSquare, Wallet, Construction, Bug, AlertTriangle,
  Wrench, FileText, BarChart, Car, Users, CreditCard, Clipboard,
  HelpCircle, Bell, BookOpen, Award, Briefcase, ListChecks, Plus,
  Map, LogIn, Lock, Megaphone, Layers, Cog, Tags, CheckSquare,
  Truck, Globe, PenTool, Boxes, Calendar
} from 'lucide-react';

interface NavItem {
  label: string;
  route: string;
  icon: React.ElementType;
  description: string;
}

interface NavSection {
  title: string;
  color: string;
  items: NavItem[];
}

const sections: NavSection[] = [
  {
    title: '🏠 Core Pages',
    color: 'bg-primary/10 text-primary',
    items: [
      { label: 'Landing Page', route: '/welcome', icon: Globe, description: 'Marketing page for unauthenticated users' },
      { label: 'Home', route: '/', icon: Home, description: 'Main marketplace dashboard' },
      { label: 'Auth', route: '/auth', icon: LogIn, description: 'Login & signup' },
      { label: 'Profile', route: '/profile', icon: User, description: 'User profile & settings' },
      { label: 'Privacy Policy', route: '/privacy-policy', icon: Lock, description: 'Privacy policy page' },
      { label: 'Terms', route: '/terms', icon: FileText, description: 'Terms of service' },
      { label: 'Community Rules', route: '/community-rules', icon: BookOpen, description: 'Community guidelines' },
      { label: 'Help', route: '/help', icon: HelpCircle, description: 'Help & FAQ' },
      { label: 'Pricing', route: '/pricing', icon: DollarSign, description: 'Pricing page' },
    ],
  },
  {
    title: '🛒 Marketplace & Shopping',
    color: 'bg-success/10 text-success',
    items: [
      { label: 'Search', route: '/search', icon: Search, description: 'Search products & sellers with filters' },
      { label: 'Categories', route: '/categories', icon: LayoutGrid, description: 'Browse all categories' },
      { label: 'Cart', route: '/cart', icon: ShoppingCart, description: 'Shopping cart & checkout' },
      { label: 'Orders', route: '/orders', icon: Package, description: 'Order history' },
      { label: 'Favorites', route: '/favorites', icon: Heart, description: 'Saved sellers' },
      { label: 'Subscriptions', route: '/subscriptions', icon: Star, description: 'Active subscriptions' },
      { label: 'Trust Directory', route: '/directory', icon: Award, description: 'Verified sellers directory' },
    ],
  },
  {
    title: '🏪 Seller Tools',
    color: 'bg-warning/10 text-warning',
    items: [
      { label: 'Become Seller', route: '/become-seller', icon: Store, description: 'Seller onboarding flow' },
      { label: 'Seller Dashboard', route: '/seller', icon: BarChart3, description: 'Seller overview & stats' },
      { label: 'Seller Products', route: '/seller/products', icon: Boxes, description: 'Manage products, bulk upload' },
      { label: 'Seller Settings', route: '/seller/settings', icon: Settings, description: 'Store settings, coupons, license' },
      { label: 'Seller Earnings', route: '/seller/earnings', icon: DollarSign, description: 'Earnings & analytics' },
    ],
  },
  {
    title: '🏘️ Society Management',
    color: 'bg-info/10 text-info',
    items: [
      { label: 'Society Dashboard', route: '/society', icon: Building2, description: 'Society health overview' },
      { label: 'Community Bulletin', route: '/community', icon: MessageSquare, description: 'Posts, polls, help requests' },
      { label: 'Society Notices', route: '/society/notices', icon: Megaphone, description: 'Official society notices' },
      { label: 'Society Finances', route: '/society/finances', icon: Wallet, description: 'Expenses, income charts' },
      { label: 'Construction Progress', route: '/society/progress', icon: Construction, description: 'Milestones, timeline, documents' },
      { label: 'Snag List', route: '/society/snags', icon: Bug, description: 'Report & track snags' },
      { label: 'Disputes', route: '/disputes', icon: AlertTriangle, description: 'Dispute tickets' },
      { label: 'Maintenance', route: '/maintenance', icon: Wrench, description: 'Maintenance requests' },
      { label: 'Society Reports', route: '/society/reports', icon: FileText, description: 'Auto-generated reports' },
      { label: 'Society Admin', route: '/society/admin', icon: Cog, description: 'Society-level admin controls' },
      { label: 'Payment Milestones', route: '/payment-milestones', icon: CreditCard, description: 'Construction payment tracking' },
      { label: 'Inspection Checklist', route: '/inspection', icon: CheckSquare, description: 'Property inspection' },
      { label: 'Authorized Persons', route: '/authorized-persons', icon: Users, description: 'Manage authorized flat persons' },
    ],
  },
  {
    title: '🔒 Security & Gate',
    color: 'bg-destructive/10 text-destructive',
    items: [
      { label: 'Guard Kiosk', route: '/guard-kiosk', icon: Shield, description: 'Security officer interface' },
      { label: 'Gate Entry', route: '/gate-entry', icon: LogIn, description: 'QR code & entry management' },
      { label: 'Security Verify', route: '/security/verify', icon: Eye, description: 'Manual entry approval' },
      { label: 'Security Audit', route: '/security/audit', icon: ClipboardList, description: 'Gate audit logs' },
      { label: 'Visitor Management', route: '/visitors', icon: Users, description: 'Visitor tracking' },
      { label: 'Parcel Management', route: '/parcels', icon: Truck, description: 'Parcel tracking' },
    ],
  },
  {
    title: '🏗️ Builder Portal',
    color: 'bg-accent/10 text-accent-foreground',
    items: [
      { label: 'Builder Dashboard', route: '/builder', icon: Building2, description: 'Builder societies & feature plan' },
      { label: 'Builder Analytics', route: '/builder/analytics', icon: BarChart, description: 'Cross-society analytics' },
      { label: 'Builder Inspections', route: '/builder-inspections', icon: CheckSquare, description: 'Builder inspection management' },
    ],
  },
  {
    title: '👷 Workforce & Domestic Help',
    color: 'bg-secondary/10 text-secondary-foreground',
    items: [
      { label: 'Worker Jobs', route: '/worker/jobs', icon: Briefcase, description: 'Available jobs for workers' },
      { label: 'Worker My Jobs', route: '/worker/my-jobs', icon: ListChecks, description: 'Accepted jobs' },
      { label: 'Hire Help', route: '/worker-hire', icon: Users, description: 'Post job requests' },
      { label: 'Create Job Request', route: '/worker-hire/create', icon: Plus, description: 'New job request form' },
      { label: 'Domestic Help', route: '/domestic-help', icon: HelpCircle, description: 'Help entries & attendance' },
      { label: 'Workforce Management', route: '/workforce', icon: Clipboard, description: 'Worker registration & gate validation' },
      { label: 'My Workers', route: '/my-workers', icon: Users, description: 'Manage your assigned workers' },
      { label: 'Worker Attendance', route: '/worker-attendance', icon: ClipboardList, description: 'Track worker attendance' },
      { label: 'Worker Leave', route: '/worker-leave', icon: Calendar, description: 'Manage worker leave requests' },
      { label: 'Worker Salary', route: '/worker-salary', icon: DollarSign, description: 'Worker salary management' },
    ],
  },
  {
    title: '🚗 Amenities',
    color: 'bg-muted text-muted-foreground',
    items: [
      { label: 'Vehicle Parking', route: '/parking', icon: Car, description: 'Parking management' },
    ],
  },
  {
    title: '🚚 Delivery',
    color: 'bg-warning/10 text-warning',
    items: [
      { label: 'Society Deliveries', route: '/society/deliveries', icon: Truck, description: 'Society delivery overview' },
      { label: 'Delivery Partners', route: '/delivery-partners', icon: Users, description: 'Manage delivery partners' },
      { label: 'My Deliveries', route: '/my-deliveries', icon: Package, description: 'Delivery partner dashboard' },
    ],
  },
  {
    title: '🔔 Notifications',
    color: 'bg-primary/10 text-primary',
    items: [
      { label: 'Notifications', route: '/notifications', icon: Bell, description: 'Notification settings' },
      { label: 'Notification Inbox', route: '/notifications/inbox', icon: Bell, description: 'In-app notification center' },
    ],
  },
  {
    title: '⚙️ Admin',
    color: 'bg-destructive/10 text-destructive',
    items: [
      { label: 'Admin Panel', route: '/admin', icon: Settings, description: 'Full admin dashboard' },
    ],
  },
];

export function AppNavigator() {
  const navigate = useNavigate();

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold">App Navigator</h2>
        <Badge variant="secondary">{sections.reduce((sum, s) => sum + s.items.length, 0)} pages</Badge>
      </div>

      {sections.map((section) => (
        <div key={section.title} className="space-y-2">
          <h3 className="text-sm font-bold">{section.title}</h3>
          <div className="grid grid-cols-1 gap-1.5">
            {section.items.map((item) => (
              <Card
                key={item.route}
                className="cursor-pointer hover:bg-muted/50 transition-colors active:scale-[0.98]"
                onClick={() => navigate(`${item.route}${item.route.includes('?') ? '&' : '?'}from=navigator`)}
              >
                <CardContent className="p-3 flex items-center gap-3">
                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${section.color}`}>
                    <item.icon size={16} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{item.label}</p>
                    <p className="text-[11px] text-muted-foreground truncate">{item.description}</p>
                  </div>
                  <Badge variant="outline" className="text-[9px] shrink-0">{item.route}</Badge>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
