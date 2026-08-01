// @ts-nocheck
import { WifiOff } from "lucide-react";
import { useNetworkStatus } from "@/hooks/useNetworkStatus";

export function OfflineBanner() {
  const { isOnline } = useNetworkStatus();

  if (isOnline) return null;

  return (
    <div className="fixed top-0 left-0 right-0 z-[100] bg-destructive text-destructive-foreground py-2 px-4 text-center text-sm font-medium flex items-center justify-center gap-2 animate-in slide-in-from-top duration-300">
      <WifiOff className="h-4 w-4" />
      <span>You're offline. Some features may not work.</span>
    </div>
  );
}
