import { PULL_THRESHOLD_PX } from '@/lib/pull-to-refresh';
import { usePullToRefresh } from '@/hooks/usePullToRefresh';
import { cn } from '@/lib/utils';

/**
 * Native-feeling pull-to-refresh host.
 * Scroll lives on #root (Capacitor WebView), so this owns the gesture there
 * and refetches the current screen's React Query data.
 */
export function PullToRefreshHost() {
  const { pullDistance, refreshing, armed, platform } = usePullToRefresh();
  const visible = pullDistance > 2 || refreshing;
  const height = visible ? Math.max(pullDistance, refreshing ? PULL_THRESHOLD_PX : 0) : 0;
  const progress = Math.min(1, pullDistance / PULL_THRESHOLD_PX);
  const style = platform === 'android' ? 'android' : 'ios';

  return (
    <div
      className="ptr-host"
      data-ptr-host="true"
      data-ptr-refreshing={refreshing ? 'true' : 'false'}
      data-ptr-live={!refreshing && pullDistance > 0 ? 'true' : 'false'}
      aria-hidden={!visible}
      style={{ height }}
    >
      <div className={cn('ptr-indicator', `ptr-indicator--${style}`, armed && 'ptr-indicator--armed')}>
        {style === 'android' ? (
          <AndroidRefreshSpinner progress={progress} spinning={refreshing} />
        ) : (
          <IosRefreshSpinner progress={progress} spinning={refreshing} />
        )}
      </div>
    </div>
  );
}

function IosRefreshSpinner({ progress, spinning }: { progress: number; spinning: boolean }) {
  return (
    <div
      className={cn('ptr-ios', spinning && 'ptr-ios--spinning')}
      style={{ opacity: spinning ? 1 : 0.35 + progress * 0.65 }}
    >
      <span />
      <span />
      <span />
      <span />
      <span />
      <span />
      <span />
      <span />
    </div>
  );
}

function AndroidRefreshSpinner({ progress, spinning }: { progress: number; spinning: boolean }) {
  const dash = 2 * Math.PI * 10;
  const offset = spinning ? 0 : dash * (1 - progress);
  return (
    <svg
      className={cn('ptr-android', spinning && 'ptr-android--spinning')}
      width="28"
      height="28"
      viewBox="0 0 28 28"
      style={{ opacity: spinning ? 1 : 0.4 + progress * 0.6 }}
    >
      <circle className="ptr-android-track" cx="14" cy="14" r="10" />
      <circle
        className="ptr-android-arc"
        cx="14"
        cy="14"
        r="10"
        strokeDasharray={dash}
        strokeDashoffset={offset}
      />
    </svg>
  );
}
