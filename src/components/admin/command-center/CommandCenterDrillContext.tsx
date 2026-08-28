// @ts-nocheck
import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';

export type CommandCenterTab =
  | 'sellers'
  | 'orders'
  | 'products'
  | 'bookings'
  | 'enquiries'
  | 'disputes'
  | 'categories'
  | 'activity'
  | 'attention';

type DrillContextValue = {
  activeTab: CommandCenterTab;
  setActiveTab: (tab: CommandCenterTab) => void;
  selectedSellerId: string | null;
  setSelectedSellerId: (id: string | null) => void;
  selectedCategory: string | null;
  setSelectedCategory: (category: string | null) => void;
  selectedSubcategoryId: string | null;
  setSelectedSubcategoryId: (id: string | null) => void;
  store360SellerId: string | null;
  openStore360: (sellerId: string) => void;
  closeStore360: () => void;
  drillToSeller: (sellerId: string, tab?: CommandCenterTab) => void;
  drillToCategory: (category: string) => void;
  drillToSubcategory: (category: string, subcategoryId: string) => void;
  clearCategoryDrill: () => void;
};

const CommandCenterDrillContext = createContext<DrillContextValue | null>(null);

export function CommandCenterDrillProvider({
  children,
  initialTab = 'sellers',
}: {
  children: ReactNode;
  initialTab?: CommandCenterTab;
}) {
  const [activeTab, setActiveTab] = useState<CommandCenterTab>(initialTab);
  const [selectedSellerId, setSelectedSellerId] = useState<string | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [selectedSubcategoryId, setSelectedSubcategoryId] = useState<string | null>(null);
  const [store360SellerId, setStore360SellerId] = useState<string | null>(null);

  const value = useMemo<DrillContextValue>(
    () => ({
      activeTab,
      setActiveTab,
      selectedSellerId,
      setSelectedSellerId,
      selectedCategory,
      setSelectedCategory,
      selectedSubcategoryId,
      setSelectedSubcategoryId,
      store360SellerId,
      openStore360: (sellerId: string) => setStore360SellerId(sellerId),
      closeStore360: () => setStore360SellerId(null),
      drillToSeller: (sellerId: string, tab: CommandCenterTab = 'orders') => {
        setSelectedSellerId(sellerId);
        setActiveTab(tab);
      },
      drillToCategory: (category: string) => {
        setSelectedCategory(category);
        setSelectedSubcategoryId(null);
        setActiveTab('categories');
      },
      drillToSubcategory: (category: string, subcategoryId: string) => {
        setSelectedCategory(category);
        setSelectedSubcategoryId(subcategoryId);
        setActiveTab('categories');
      },
      clearCategoryDrill: () => {
        setSelectedCategory(null);
        setSelectedSubcategoryId(null);
      },
    }),
    [activeTab, selectedSellerId, selectedCategory, selectedSubcategoryId, store360SellerId],
  );

  return (
    <CommandCenterDrillContext.Provider value={value}>{children}</CommandCenterDrillContext.Provider>
  );
}

export function useCommandCenterDrill() {
  const ctx = useContext(CommandCenterDrillContext);
  if (!ctx) {
    throw new Error('useCommandCenterDrill must be used within CommandCenterDrillProvider');
  }
  return ctx;
}
