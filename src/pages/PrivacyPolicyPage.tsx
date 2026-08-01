// @ts-nocheck
import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { useSystemSettings } from '@/hooks/useSystemSettings';
import ReactMarkdown from 'react-markdown';

export default function PrivacyPolicyPage() {
  const settings = useSystemSettings();
  const hasDbContent = !!settings.privacyContentMd;
  const platformName = settings.platformName;

  return (
    <div className="min-h-[100dvh] bg-background">
      <div className="max-w-3xl mx-auto px-4 py-8">
        <div className="flex items-center gap-3 mb-8">
          <button onClick={() => window.history.back()} className="inline-flex items-center justify-center w-10 h-10 rounded-full bg-muted shrink-0">
            <ArrowLeft size={18} />
          </button>
          <div>
            <h1 className="text-2xl font-bold text-foreground">Privacy Policy</h1>
            <p className="text-sm text-muted-foreground">Last updated: {settings.privacyLastUpdated}</p>
          </div>
        </div>

        <div className="bg-card rounded-2xl border border-border p-6 md:p-8 space-y-4 text-sm">
          {hasDbContent ? (
            <div className="prose prose-sm max-w-none text-muted-foreground">
              <ReactMarkdown>{settings.privacyContentMd}</ReactMarkdown>
            </div>
          ) : (
            <>
              <section>
                <h3 className="font-semibold mb-2">1. Introduction</h3>
                <p className="text-muted-foreground">
                  Welcome to {platformName} ("we", "our", or "us"). This Privacy Policy explains how we collect, use, disclose, and safeguard your information when you use our platform, in compliance with the Digital Personal Data Protection Act, 2023 (DPDPA) and applicable Indian laws.
                </p>
              </section>

              <section>
                <h3 className="font-semibold mb-2">2. Information We Collect</h3>
                <ul className="list-disc list-inside text-muted-foreground space-y-1">
                  <li><strong>Personal Information:</strong> Name, phone number, email address, block number, flat number, and society membership for identity verification and delivery.</li>
                  <li><strong>Location Data:</strong> GPS coordinates during signup for residence verification using geofencing. Location data is used solely for verification and is not continuously tracked.</li>
                  <li><strong>Order Information:</strong> Order history, items purchased, delivery preferences, and coupon usage.</li>
                  <li><strong>Payment Information:</strong> UPI IDs for payment processing. We do not store sensitive payment credentials.</li>
                  <li><strong>Communication Data:</strong> Messages exchanged between buyers and sellers regarding orders.</li>
                  <li><strong>Device Information:</strong> Device type, OS, push notification tokens, and app version for service delivery and troubleshooting.</li>
                </ul>
              </section>

              <section>
                <h3 className="font-semibold mb-2">3. Purpose of Data Collection</h3>
                <ul className="list-disc list-inside text-muted-foreground space-y-1">
                  <li>Verify your residence in your registered society</li>
                  <li>Process and fulfill orders</li>
                  <li>Facilitate buyer-seller communication</li>
                  <li>Send order updates and push notifications</li>
                  <li>Enforce society-level content isolation</li>
                  <li>Improve platform services and prevent fraud</li>
                  <li>Comply with legal and regulatory requirements</li>
                </ul>
              </section>

              <section>
                <h3 className="font-semibold mb-2">4. Consent</h3>
                <p className="text-muted-foreground">
                  By creating an account on {platformName}, you provide explicit consent for the collection and processing of your personal data as described in this policy. You may withdraw consent at any time by deleting your account, though this will terminate your access to the Platform.
                </p>
              </section>

              <section>
                <h3 className="font-semibold mb-2">5. Information Sharing</h3>
                <ul className="list-disc list-inside text-muted-foreground space-y-1">
                  <li><strong>Sellers:</strong> Your name, block, and flat number for order delivery (within your society only)</li>
                  <li><strong>Society Admins:</strong> For verification and dispute resolution</li>
                  <li><strong>Razorpay:</strong> Order amount, email address, and phone number for payment processing. Razorpay privacy policy applies to data they collect.</li>
                  <li><strong>Google Maps:</strong> GPS coordinates during signup for residence verification. Google privacy policy applies.</li>
                  <li><strong>Push Notification Services:</strong> Device tokens for delivering order updates and community alerts.</li>
                </ul>
                <p className="text-muted-foreground mt-2">
                  We do not sell your personal information to third parties. Data is never shared across society boundaries.
                </p>
              </section>

              <section>
                <h3 className="font-semibold mb-2">6. Data Security</h3>
                <p className="text-muted-foreground">
                  We implement appropriate technical and organizational measures including encryption in transit (TLS) and at rest, Row-Level Security policies at the database level, and access controls to protect your personal information.
                </p>
              </section>

              <section>
                <h3 className="font-semibold mb-2">7. Data Retention</h3>
                <p className="text-muted-foreground">
                  Personal information is retained while your account is active. Order history is retained for 2 years for reference and legal compliance. GPS location data used for verification is not stored after the verification process. Upon account deletion, personal data is removed within 30 days, subject to legal retention requirements.
                </p>
              </section>

              <section>
                <h3 className="font-semibold mb-2">8. Your Rights (Data Principal Rights under DPDPA)</h3>
                <p className="text-muted-foreground mb-2">As a data principal, you have the right to:</p>
                <ul className="list-disc list-inside text-muted-foreground space-y-1">
                  <li>Access your personal data held by us</li>
                  <li>Correct inaccurate or incomplete data</li>
                  <li>Request erasure/deletion of your data</li>
                  <li>Withdraw consent for data processing</li>
                  <li>Nominate another person to exercise your rights</li>
                  <li>Lodge grievances regarding data processing</li>
                </ul>
              </section>

              <section>
                <h3 className="font-semibold mb-2">9. Push Notifications</h3>
                <p className="text-muted-foreground">
                  We collect device tokens for sending push notifications about order updates, new messages, and important announcements. You may disable push notifications through your device settings at any time.
                </p>
              </section>

              <section>
                <h3 className="font-semibold mb-2">10. Children's Privacy</h3>
                <p className="text-muted-foreground">
                  Our platform is not intended for users under 18 years of age. We do not knowingly collect information from children.
                </p>
              </section>

              <section>
                <h3 className="font-semibold mb-2">11. Data Protection Officer</h3>
                <p className="text-muted-foreground">
                  For any data privacy concerns or to exercise your rights, contact our Data Protection Officer through the app's Help & Support section or email {settings.dpoEmail}.
                </p>
              </section>

              <section>
                <h3 className="font-semibold mb-2">12. Changes to This Policy</h3>
                <p className="text-muted-foreground">
                  We may update this Privacy Policy from time to time. We will notify you of material changes through in-app notifications and update the "Last updated" date.
                </p>
              </section>

              <section>
                <h3 className="font-semibold mb-2">13. Grievance Redressal</h3>
                <p className="text-muted-foreground">
                  If you have any concerns about data privacy or wish to file a complaint, contact our Grievance Officer through the Help & Support section. We will acknowledge your complaint within 48 hours and resolve it within 30 days.
                </p>
              </section>
            </>
          )}
        </div>

        <div className="mt-6 text-center text-xs text-muted-foreground space-x-4">
          <Link to="/terms" className="hover:text-foreground">Terms & Conditions</Link>
          <span>•</span>
          <Link to="/refund-policy" className="hover:text-foreground">Refund Policy</Link>
          <span>•</span>
          <Link to="/pricing" className="hover:text-foreground">Pricing</Link>
        </div>
      </div>
    </div>
  );
}
