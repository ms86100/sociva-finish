// @ts-nocheck
import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { useSystemSettings } from '@/hooks/useSystemSettings';

export default function RefundPolicyPage() {
  const { platformName, supportEmail, refundSlaHours } = useSystemSettings();

  return (
    <div className="min-h-[100dvh] bg-background">
      <div className="max-w-3xl mx-auto px-4 py-8">
        <div className="flex items-center gap-3 mb-8">
          <button onClick={() => window.history.back()} className="inline-flex items-center justify-center w-10 h-10 rounded-full bg-muted shrink-0">
            <ArrowLeft size={18} />
          </button>
          <div>
            <h1 className="text-2xl font-bold text-foreground">Refund & Cancellation Policy</h1>
            <p className="text-sm text-muted-foreground">Effective for all orders placed on {platformName}</p>
          </div>
        </div>

        <div className="bg-card rounded-2xl border border-border p-6 md:p-8 space-y-6 text-sm">
          <section>
            <h2 className="font-semibold text-foreground text-base mb-2">1. Overview</h2>
            <p className="text-muted-foreground leading-relaxed">
              {platformName} is a marketplace facilitator connecting buyers with independent sellers within verified residential communities. All products sold are physical goods or in-person services fulfilled directly by sellers. {platformName} does not sell digital goods or digital content. This policy applies to all transactions facilitated through the platform.
            </p>
          </section>

          <section>
            <h2 className="font-semibold text-foreground text-base mb-2">2. Order Cancellation</h2>
            <ul className="list-disc list-inside text-muted-foreground space-y-2 leading-relaxed">
              <li><strong className="text-foreground">Before preparation:</strong> Buyers may cancel an order at any time before the seller begins preparing the order. No charges apply.</li>
              <li><strong className="text-foreground">After preparation begins:</strong> Once the seller has accepted and started preparing the order, cancellation may not be possible. Buyers should contact the seller directly through in-app chat.</li>
              <li><strong className="text-foreground">Seller cancellation:</strong> Sellers may cancel an order if they are unable to fulfill it. The buyer will be notified immediately.</li>
              <li><strong className="text-foreground">Auto-cancellation:</strong> Orders not accepted by the seller within the configured timeframe are automatically cancelled.</li>
            </ul>
          </section>

          <section>
            <h2 className="font-semibold text-foreground text-base mb-2">3. Refund Eligibility</h2>
            <ul className="list-disc list-inside text-muted-foreground space-y-2 leading-relaxed">
              <li>Order cancelled before preparation — full refund</li>
              <li>Seller cancels after accepting — full refund</li>
              <li>Product not delivered or significantly different from description — eligible for refund after dispute review</li>
              <li>Quality complaints — reviewed on a case-by-case basis through the dispute resolution system</li>
            </ul>
          </section>

          <section>
            <h2 className="font-semibold text-foreground text-base mb-2">4. Refund Process</h2>
            <ul className="list-disc list-inside text-muted-foreground space-y-2 leading-relaxed">
              <li><strong className="text-foreground">Cash on Delivery (COD):</strong> No refund processing needed for cancelled orders, as no payment was collected. For delivered items requiring a refund, the seller will arrange a direct refund.</li>
              <li><strong className="text-foreground">UPI Payments:</strong> Refunds for UPI transactions are processed within {refundSlaHours} hours of approval. The refund is credited back to the original payment method via Razorpay.</li>
            </ul>
          </section>

          <section>
            <h2 className="font-semibold text-foreground text-base mb-2">5. Dispute Resolution</h2>
            <p className="text-muted-foreground leading-relaxed">
              If you are unsatisfied with an order, you can raise a dispute through the app's Help & Support section or the in-app dispute resolution feature. Disputes are reviewed by society-level administrators and the {platformName} support team. We aim to resolve all disputes within 7 business days.
            </p>
          </section>

          <section>
            <h2 className="font-semibold text-foreground text-base mb-2">6. Platform's Role</h2>
            <p className="text-muted-foreground leading-relaxed">
              {platformName} acts solely as an intermediary marketplace facilitator. Refunds and cancellations are ultimately the responsibility of the seller. The platform facilitates communication, dispute resolution, and payment reversal processing, but does not guarantee refunds on behalf of individual sellers.
            </p>
          </section>

          <section>
            <h2 className="font-semibold text-foreground text-base mb-2">7. Contact</h2>
            <p className="text-muted-foreground leading-relaxed">
              For refund inquiries, contact us at{' '}
              <a href={`mailto:${supportEmail}`} className="text-primary hover:underline">{supportEmail}</a>{' '}
              or use the Help & Support section within the app.
            </p>
          </section>
        </div>

        <div className="mt-6 text-center text-xs text-muted-foreground space-x-4">
          <Link to="/terms" className="hover:text-foreground">Terms & Conditions</Link>
          <span>•</span>
          <Link to="/privacy-policy" className="hover:text-foreground">Privacy Policy</Link>
          <span>•</span>
          <Link to="/pricing" className="hover:text-foreground">Pricing</Link>
        </div>
      </div>
    </div>
  );
}
