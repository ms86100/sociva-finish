// @ts-nocheck
import { Link } from 'react-router-dom';
import { useSystemSettings } from '@/hooks/useSystemSettings';
import { Mail, MapPin } from 'lucide-react';

function scrollToSection(id: string) {
  const el = document.getElementById(id);
  if (el) {
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

export function LandingFooter() {
  const { platformName } = useSystemSettings();
  const year = new Date().getFullYear();

  return (
    <footer className="py-12 bg-card border-t border-border">
      <div className="container mx-auto px-4 lg:px-8">
        <div className="grid md:grid-cols-4 gap-8 mb-8">
          {/* Brand + mission */}
          <div className="md:col-span-2">
            <div className="flex items-center gap-2 mb-3">
              <span 
                className="text-xl font-black tracking-[0.12em] leading-none"
                style={{
                  background: 'linear-gradient(135deg, hsl(var(--foreground)) 0%, hsl(var(--primary)) 100%)',
                  WebkitBackgroundClip: 'text',
                  WebkitTextFillColor: 'transparent',
                }}
              >
                SOCIVA
              </span>
            </div>
            <p className="text-sm text-muted-foreground leading-relaxed mb-4 max-w-sm">
              The things your neighbors make, teach, cook, and fix — finally have a home. We're building the trust layer that connects families within residential communities.
            </p>
            <p className="text-xs text-muted-foreground">Operated by Sociva Technologies · Bangalore, India</p>
          </div>

          {/* Legal */}
          <div>
            <h4 className="font-semibold text-foreground mb-3 text-sm">Legal</h4>
            <div className="space-y-2">
              <Link to="/privacy-policy" className="block text-sm text-muted-foreground hover:text-foreground">Privacy Policy</Link>
              <Link to="/terms" className="block text-sm text-muted-foreground hover:text-foreground">Terms & Conditions</Link>
              <Link to="/refund-policy" className="block text-sm text-muted-foreground hover:text-foreground">Refund Policy</Link>
              <Link to="/pricing" className="block text-sm text-muted-foreground hover:text-foreground">Pricing</Link>
              {/* HashRouter: #download is a route (/download), not a page anchor — scroll instead */}
              <button
                type="button"
                onClick={() => scrollToSection('download')}
                className="block text-sm text-muted-foreground hover:text-foreground text-left"
              >
                Download the app
              </button>
            </div>
          </div>

          {/* Contact */}
          <div>
            <h4 className="font-semibold text-foreground mb-3 text-sm">Contact</h4>
            <div className="space-y-3">
              <div className="flex items-start gap-2">
                <Mail className="text-primary shrink-0 mt-0.5" size={14} />
                <a href="mailto:support@sociva.in" className="text-sm text-muted-foreground hover:text-foreground break-all">support@sociva.in</a>
              </div>
              <div className="flex items-start gap-2">
                <MapPin className="text-primary shrink-0 mt-0.5" size={14} />
                <span className="text-sm text-muted-foreground">Bangalore, Karnataka, India</span>
              </div>
            </div>
          </div>
        </div>

        <div className="border-t border-border pt-6 text-center">
          <p className="text-xs text-muted-foreground">
            © {year} Sociva Technologies. All rights reserved. Operated under the laws of India.
          </p>
        </div>
      </div>
    </footer>
  );
}
