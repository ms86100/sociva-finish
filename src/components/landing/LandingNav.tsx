// @ts-nocheck
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { useSystemSettings } from '@/hooks/useSystemSettings';
import { Menu, X } from 'lucide-react';

const NAV_LINKS = [
  { label: 'Features', href: '#features' },
  { label: 'How It Works', href: '#how-it-works' },
  { label: 'Pricing', href: '#pricing' },
];

export function LandingNav() {
  const { platformName } = useSystemSettings();
  const [open, setOpen] = useState(false);

  const scrollTo = (id: string) => {
    setOpen(false);
    const el = document.getElementById(id.replace('#', ''));
    el?.scrollIntoView({ behavior: 'smooth' });
  };

  return (
    <nav className="sticky z-50 glass border-b border-border" style={{ top: 'env(safe-area-inset-top, 0px)' }}>
      <div className="container mx-auto flex items-center justify-between h-14 px-4 lg:px-8">
        <Link to="/" className="flex items-center gap-2 overflow-visible py-0.5">
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
        </Link>

        <div className="hidden md:flex items-center gap-6">
          {NAV_LINKS.map(l => (
            <button key={l.href} onClick={() => scrollTo(l.href)} className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors">
              {l.label}
            </button>
          ))}
        </div>

        <div className="hidden md:flex items-center gap-3">
          <Link to="/auth"><Button variant="ghost" size="sm">Sign In</Button></Link>
          <Link to="/auth"><Button size="sm">Get Started</Button></Link>
        </div>

        <button className="md:hidden p-2" onClick={() => setOpen(!open)}>
          {open ? <X size={20} /> : <Menu size={20} />}
        </button>
      </div>

      {open && (
        <div className="md:hidden border-t border-border bg-card px-4 py-4 space-y-3 animate-slide-down">
          {NAV_LINKS.map(l => (
            <button key={l.href} onClick={() => scrollTo(l.href)} className="block w-full text-left text-sm font-medium text-muted-foreground hover:text-foreground py-2">
              {l.label}
            </button>
          ))}
          <div className="flex gap-2 pt-2">
            <Link to="/auth" className="flex-1"><Button variant="outline" size="sm" className="w-full">Sign In</Button></Link>
            <Link to="/auth" className="flex-1"><Button size="sm" className="w-full">Get Started</Button></Link>
          </div>
        </div>
      )}
    </nav>
  );
}
