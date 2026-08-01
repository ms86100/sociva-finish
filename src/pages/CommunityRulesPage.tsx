// @ts-nocheck
import { Link } from 'react-router-dom';
import { AppLayout } from '@/components/layout/AppLayout';
import { Card, CardContent } from '@/components/ui/card';
import { ArrowLeft, Shield, Check, X, AlertTriangle } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useSystemSettings } from '@/hooks/useSystemSettings';

const DEFAULT_RULES = [
  {
    title: 'For Buyers',
    do: [
      'Be respectful when communicating with sellers',
      'Provide accurate delivery details',
      'Pick up orders on time or be available for delivery',
      'Give honest and fair reviews',
      'Report issues through the app',
    ],
    dont: [
      'Use abusive language in chat or reviews',
      'Cancel orders repeatedly without reason',
      'Negotiate prices outside the app',
      'Share personal contact details publicly',
    ],
  },
  {
    title: 'For Sellers',
    do: [
      'Maintain quality and safety standards',
      'Keep your menu and availability up to date',
      'Respond to orders promptly',
      'Communicate clearly with buyers',
      'Honor all accepted orders',
    ],
    dont: [
      'Accept orders you cannot fulfill',
      'Misrepresent products or services',
      'Share buyer contact details with others',
      'Charge differently than listed prices',
    ],
  },
];

const DEFAULT_VIOLATIONS = [
  { level: 'Warning', description: 'First-time minor violations', action: 'Written warning' },
  { level: 'Temporary Suspension', description: 'Repeated violations or serious misconduct', action: '7-day account suspension' },
  { level: 'Permanent Ban', description: 'Severe violations or repeated serious misconduct', action: 'Account permanently disabled' },
];

export default function CommunityRulesPage() {
  const { society } = useAuth();
  const settings = useSystemSettings();
  const customRulesText = (society as any)?.rules_text as string | null;
  const RULES = customRulesText ? null : DEFAULT_RULES;

  // M3: Read violations from system_settings, fallback to defaults
  let violations = DEFAULT_VIOLATIONS;
  try {
    if (settings.violationPolicyJson) {
      const parsed = JSON.parse(settings.violationPolicyJson);
      if (Array.isArray(parsed) && parsed.length > 0) violations = parsed;
    }
  } catch { /* use defaults */ }

  return (
    <AppLayout showHeader={false} showNav={false}>
      <div className="p-4 pb-8">
        <Link to="/help" className="inline-flex items-center justify-center w-10 h-10 rounded-full bg-muted shrink-0 mb-4">
          <ArrowLeft size={18} className="text-foreground" />
        </Link>

        <div className="text-center mb-6">
          <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-warning/10 flex items-center justify-center">
            <Shield className="text-warning" size={32} />
          </div>
          <h1 className="text-2xl font-bold">Community Guidelines</h1>
          <p className="text-muted-foreground mt-1">
            Rules for a safe and trusted marketplace
          </p>
        </div>

        {customRulesText && (
          <Card className="mb-4">
            <CardContent className="p-4">
              <h3 className="font-semibold mb-3">Society Rules</h3>
              <div className="text-sm text-muted-foreground whitespace-pre-line">{customRulesText}</div>
            </CardContent>
          </Card>
        )}

        {RULES && RULES.map(({ title, do: doList, dont: dontList }) => (
          <Card key={title} className="mb-4">
            <CardContent className="p-4">
              <h3 className="font-semibold mb-4">{title}</h3>
              <div className="space-y-4">
                <div>
                  <p className="text-sm font-medium text-success flex items-center gap-2 mb-2">
                    <Check size={16} /> Do
                  </p>
                  <ul className="space-y-1.5">
                    {doList.map((item, index) => (
                      <li key={index} className="flex items-start gap-2 text-sm text-muted-foreground">
                        <span className="text-success mt-0.5">✓</span>{item}
                      </li>
                    ))}
                  </ul>
                </div>
                <div>
                  <p className="text-sm font-medium text-destructive flex items-center gap-2 mb-2">
                    <X size={16} /> Don't
                  </p>
                  <ul className="space-y-1.5">
                    {dontList.map((item, index) => (
                      <li key={index} className="flex items-start gap-2 text-sm text-muted-foreground">
                        <span className="text-destructive mt-0.5">✗</span>{item}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-4">
              <AlertTriangle className="text-warning" size={18} />
              <h3 className="font-semibold">Violation Consequences</h3>
            </div>
            <div className="space-y-3">
              {violations.map(({ level, description, action }) => (
                <div key={level} className="p-3 bg-muted rounded-lg">
                  <p className="font-medium text-sm">{level}</p>
                  <p className="text-xs text-muted-foreground">{description}</p>
                  <p className="text-xs text-warning mt-1">{action}</p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <p className="text-center text-xs text-muted-foreground mt-6">
          By using {settings.platformName}, you agree to follow these guidelines.
          Report violations through the app or contact the admin.
        </p>
      </div>
    </AppLayout>
  );
}
