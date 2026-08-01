// @ts-nocheck
import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { AppLayout } from '@/components/layout/AppLayout';
import { SafeHeader } from '@/components/layout/SafeHeader';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { 
  ArrowLeft, 
  ShoppingBag, 
  Store, 
  CreditCard, 
  MessageCircle, 
  Shield, 
  HelpCircle,
  ChevronRight,
  BookOpen,
  RefreshCw,
  Package, Users, Wrench, Car, Bell, MapPin, Home, Settings,
  DoorOpen, ClipboardCheck, Landmark, Bug, Scale, IndianRupee,
  Building2, Briefcase, HardHat, Truck, Calendar, Star,
  type LucideIcon,
} from 'lucide-react';
import { useOnboarding } from '@/components/onboarding/OnboardingWalkthrough';
import { useSystemSettings } from '@/hooks/useSystemSettings';

export interface HelpSection {
  icon: LucideIcon;
  title: string;
  items: string[];
}

const DEFAULT_HELP_SECTIONS: HelpSection[] = [
  {
    icon: ShoppingBag,
    title: 'How to Order',
    items: [
      'Browse sellers on the Home screen',
      'Tap on a seller to see their listings',
      'Add items to your cart',
      'Choose payment method (UPI or Cash)',
      'Place your order and track status',
    ],
  },
  {
    icon: Store,
    title: 'Becoming a Seller',
    items: [
      'Go to Profile → Become a Seller',
      'Fill in your business details',
      'Wait for admin approval',
      'Add your products and set prices',
      'Start receiving orders!',
    ],
  },
  {
    icon: CreditCard,
    title: 'Payments',
    items: [
      'UPI: Pay instantly via supported UPI apps',
      'Cash on Delivery: Pay when you receive',
      'All transactions are within the community',
      'No extra charges or hidden fees',
    ],
  },
  {
    icon: MessageCircle,
    title: 'Chat & Communication',
    items: [
      'Chat with seller after placing an order',
      'Discuss special requests or timing',
      'Get notified of order updates',
      'Chat disabled after order completion',
    ],
  },
];

interface HelpPageProps {
  /** Override default sections for white-label customization */
  sections?: HelpSection[];
}

export default function HelpPage({ sections: customSections }: HelpPageProps) {
  const { resetOnboarding } = useOnboarding(); // No userId needed for reset
  const settings = useSystemSettings();

  // Priority: prop > DB > default
  const helpSections = useMemo(() => {
    if (customSections) return customSections;
    if (settings.helpSectionsJson) {
      try {
        const parsed = JSON.parse(settings.helpSectionsJson) as { icon: string; title: string; items: string[] }[];
        const ICON_MAP: Record<string, LucideIcon> = {
          ShoppingBag, Store, CreditCard, MessageCircle, Shield, HelpCircle,
          Package, Users, Wrench, Car, Bell, MapPin, Home, Settings,
          DoorOpen, ClipboardCheck, Landmark, Bug, Scale, IndianRupee,
          Building2, Briefcase, HardHat, Truck, Calendar, Star,
          BookOpen, RefreshCw, ArrowLeft, ChevronRight,
        };
        return parsed.map(s => ({
          icon: ICON_MAP[s.icon] || HelpCircle,
          title: s.title,
          items: s.items,
        }));
      } catch { /* fall through to defaults */ }
    }
    return DEFAULT_HELP_SECTIONS;
  }, [customSections, settings.helpSectionsJson]);

  return (
    <AppLayout showHeader={false} showNav={false}>
      <div className="pb-8">
        <SafeHeader>
          <div className="px-4 pb-3.5 flex items-center gap-3">
          <Link to="/profile" className="inline-flex items-center justify-center w-10 h-10 rounded-full bg-muted shrink-0">
            <ArrowLeft size={18} />
          </Link>
          <h1 className="text-lg font-bold text-foreground">Help & Guide</h1>
          </div>
        </SafeHeader>

        <div className="text-center mb-6 px-4 pt-4">
          <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-primary/10 flex items-center justify-center">
            <HelpCircle className="text-primary" size={32} />
          </div>
          <h2 className="text-xl font-bold">How can we help?</h2>
          <p className="text-muted-foreground mt-1 text-sm">
            Learn how to use the platform
          </p>
        </div>

        {/* Replay Onboarding */}
        <Card className="mb-6 mx-4">
          <CardContent className="p-4">
            <button
              onClick={resetOnboarding}
              className="w-full flex items-center gap-4"
            >
              <div className="w-10 h-10 rounded-full bg-info/10 flex items-center justify-center">
                <RefreshCw className="text-info" size={20} />
              </div>
              <div className="flex-1 text-left">
                <p className="font-medium">Replay Introduction</p>
                <p className="text-xs text-muted-foreground">
                  View the app walkthrough again
                </p>
              </div>
              <ChevronRight size={18} className="text-muted-foreground" />
            </button>
          </CardContent>
        </Card>

        {/* Help Sections */}
        <div className="space-y-4 px-4">
          {helpSections.map(({ icon: Icon, title, items }) => (
            <Card key={title}>
              <CardContent className="p-4">
                <div className="flex items-center gap-3 mb-3">
                  <Icon className="text-primary" size={20} />
                  <h3 className="font-semibold">{title}</h3>
                </div>
                <ul className="space-y-2">
                  {items.map((item, index) => (
                    <li key={index} className="flex items-start gap-2 text-sm text-muted-foreground">
                      <span className="text-primary">•</span>
                      {item}
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Grievance Officer */}
        <Card className="mt-6 mx-4">
          <CardContent className="p-4">
            <div className="flex items-center gap-3 mb-3">
              <Shield className="text-primary" size={20} />
              <h3 className="font-semibold">Grievance Officer</h3>
            </div>
            <p className="text-sm text-muted-foreground mb-2">
              In accordance with the Consumer Protection (E-Commerce) Rules, 2020:
            </p>
            <div className="bg-muted rounded-lg p-3 space-y-1 text-sm">
              <p><span className="font-medium">Name:</span> {settings.grievanceOfficerName}</p>
              <p><span className="font-medium">Email:</span> {settings.grievanceEmail}</p>
              <p><span className="font-medium">Response:</span> Within 48 hours</p>
              <p><span className="font-medium">Resolution:</span> Within 30 days</p>
            </div>
          </CardContent>
        </Card>

        {/* Community Rules Link */}
        <Link to="/community-rules">
          <Card className="mt-4 mx-4">
            <CardContent className="p-4 flex items-center gap-4">
              <div className="w-10 h-10 rounded-full bg-warning/10 flex items-center justify-center">
                <BookOpen className="text-warning" size={20} />
              </div>
              <div className="flex-1">
                <p className="font-medium">Community Guidelines</p>
                <p className="text-xs text-muted-foreground">
                  Code of conduct for buyers and sellers
                </p>
              </div>
              <ChevronRight size={18} className="text-muted-foreground" />
            </CardContent>
          </Card>
        </Link>
      </div>
    </AppLayout>
  );
}
