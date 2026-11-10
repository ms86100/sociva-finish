import { useEffect, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { AppLayout } from '@/components/layout/AppLayout';
import { CleanerCityBottomNav } from '@/components/cleaner-city/CleanerCityBottomNav';
import { clearCleanerCityMockupPreview } from '@/lib/cleaner-city/mockupSeed';
import { cn } from '@/lib/utils';

type Props = {
  children: ReactNode;
  headerTitle?: string;
  showHeader?: boolean;
  /** Ride mission / share: no Cleaner City tab bar */
  immersive?: boolean;
  className?: string;
  /** In-module back target (preferred over marketplace home). */
  backTo?: string;
  backLabel?: string;
};

/**
 * Shared chrome for production Cleaner City.
 * Hides marketplace BottomNav/cart and mounts the commute IA tab bar.
 */
export function CleanerCityChrome({
  children,
  headerTitle,
  showHeader = true,
  immersive = false,
  className,
  backTo = '/',
  backLabel = 'Back to Sociva',
}: Props) {
  useEffect(() => {
    clearCleanerCityMockupPreview();
  }, []);

  return (
    <AppLayout
      showNav={false}
      showCart={false}
      showHeader={showHeader}
      headerTitle={headerTitle}
      className={cn(!immersive && 'pb-28 bg-[#F7F5F1]', className)}
    >
      {!immersive ? (
        <div className="mx-auto max-w-lg px-4 pt-2">
          <Link
            to={backTo}
            data-testid={
              backTo === '/' ? 'cleaner-city-back-to-sociva' : 'cleaner-city-module-back'
            }
            className="inline-flex items-center gap-1.5 rounded-full px-1 py-1.5 text-[12px] font-semibold text-emerald-800 hover:text-emerald-950 dark:text-emerald-300 dark:hover:text-emerald-200"
          >
            <ArrowLeft className="h-3.5 w-3.5" strokeWidth={2.5} />
            {backLabel}
          </Link>
        </div>
      ) : null}
      {children}
      {!immersive ? <CleanerCityBottomNav /> : null}
    </AppLayout>
  );
}
