import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';

/**
 * Public account-deletion instructions for Google Play / App Store reviewers
 * and users who need a web URL (Data safety "Delete account URL").
 */
export default function DeleteAccountPage() {
  return (
    <div className="min-h-[100dvh] bg-background">
      <div className="max-w-3xl mx-auto px-4 py-8">
        <div className="flex items-center gap-3 mb-8">
          <Link
            to="/"
            className="inline-flex items-center justify-center w-10 h-10 rounded-full bg-muted shrink-0"
            aria-label="Back"
          >
            <ArrowLeft size={18} />
          </Link>
          <div>
            <h1 className="text-2xl font-bold text-foreground">Delete your Sociva account</h1>
            <p className="text-sm text-muted-foreground">Sociva — Your Society, Your Store</p>
          </div>
        </div>

        <div className="bg-card rounded-2xl border border-border p-6 md:p-8 space-y-6 text-sm text-muted-foreground">
          <section className="space-y-2">
            <h2 className="text-base font-semibold text-foreground">How to delete your account in the app</h2>
            <ol className="list-decimal list-inside space-y-1.5">
              <li>Open the <strong className="text-foreground">Sociva</strong> app and sign in with your phone number.</li>
              <li>Go to <strong className="text-foreground">Profile</strong>.</li>
              <li>Scroll to the danger zone and tap <strong className="text-foreground">Delete Account</strong>.</li>
              <li>Type <strong className="text-foreground">DELETE</strong> to confirm, then confirm again.</li>
            </ol>
            <p>
              Account deletion is permanent. You will be signed out and will need a new signup to use Sociva again.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="text-base font-semibold text-foreground">Request deletion by email</h2>
            <p>
              If you cannot access the app, email{' '}
              <a className="text-foreground underline" href="mailto:support@sociva.in">
                support@sociva.in
              </a>{' '}
              from the phone number or email associated with your account, with subject line{' '}
              <strong className="text-foreground">Account deletion request</strong>. Include your registered phone
              number and society name. We will verify ownership and process the request.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="text-base font-semibold text-foreground">What is deleted</h2>
            <ul className="list-disc list-inside space-y-1">
              <li>Profile and personal information (name, phone, email, flat/block/address)</li>
              <li>Login credentials and account access</li>
              <li>Favourites, chat messages, and reviews you wrote</li>
              <li>Seller profile, listings, and related seller data (if you were a seller)</li>
              <li>Order history linked to your account (subject to legal retention below)</li>
              <li>Push notification / device tokens for your account</li>
            </ul>
          </section>

          <section className="space-y-2">
            <h2 className="text-base font-semibold text-foreground">What may be retained (and for how long)</h2>
            <ul className="list-disc list-inside space-y-1">
              <li>
                Transaction and tax / dispute records may be kept up to <strong className="text-foreground">2 years</strong>{' '}
                where required for legal, accounting, or fraud-prevention obligations.
              </li>
              <li>
                Personal data is removed or anonymized within <strong className="text-foreground">30 days</strong> after
                account deletion, except where a longer legal retention period applies.
              </li>
              <li>Aggregated, non-identifying analytics may be kept without personal identifiers.</li>
            </ul>
          </section>

          <section className="space-y-2">
            <h2 className="text-base font-semibold text-foreground">Delete some data without deleting your account</h2>
            <p>
              You can update or remove many details in <strong className="text-foreground">Profile → Edit</strong> (name,
              photo, address fields). To remove specific content (e.g. a listing or message), use in-app controls or email{' '}
              <a className="text-foreground underline" href="mailto:support@sociva.in">
                support@sociva.in
              </a>
              .
            </p>
          </section>

          <p className="text-xs pt-2 border-t border-border">
            Related:{' '}
            <Link to="/privacy-policy" className="underline text-foreground">
              Privacy Policy
            </Link>
            {' · '}
            <Link to="/terms" className="underline text-foreground">
              Terms
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
