// @ts-nocheck
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { PlatformOverview } from './analytics/PlatformOverview';
import { OrdersMonitor } from './analytics/OrdersMonitor';
import { SellerPerformanceTable } from './analytics/SellerPerformanceTable';
import { BuyerActivityTable } from './analytics/BuyerActivityTable';
import { SocietyBreakdown } from './analytics/SocietyBreakdown';
import { CategoryAnalytics } from './analytics/CategoryAnalytics';

export function AdminAnalyticsTab() {
  return (
    <div className="space-y-5">
      <PlatformOverview />

      <Tabs defaultValue="orders" className="w-full">
        <TabsList className="w-full grid grid-cols-5 rounded-xl h-9 mb-4">
          <TabsTrigger value="orders" className="text-[10px] rounded-lg font-semibold">Orders</TabsTrigger>
          <TabsTrigger value="sellers" className="text-[10px] rounded-lg font-semibold">Sellers</TabsTrigger>
          <TabsTrigger value="buyers" className="text-[10px] rounded-lg font-semibold">Buyers</TabsTrigger>
          <TabsTrigger value="societies" className="text-[10px] rounded-lg font-semibold">Societies</TabsTrigger>
          <TabsTrigger value="categories" className="text-[10px] rounded-lg font-semibold">Categories</TabsTrigger>
        </TabsList>
        <TabsContent value="orders"><OrdersMonitor /></TabsContent>
        <TabsContent value="sellers"><SellerPerformanceTable /></TabsContent>
        <TabsContent value="buyers"><BuyerActivityTable /></TabsContent>
        <TabsContent value="societies"><SocietyBreakdown /></TabsContent>
        <TabsContent value="categories"><CategoryAnalytics /></TabsContent>
      </Tabs>
    </div>
  );
}
