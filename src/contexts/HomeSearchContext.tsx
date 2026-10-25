import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';

interface HomeSearchValue {
  query: string;
  setQuery: (query: string) => void;
}

const HomeSearchContext = createContext<HomeSearchValue>({
  query: '',
  setQuery: () => {},
});

export function HomeSearchProvider({ children }: { children: ReactNode }) {
  const [query, setQuery] = useState('');
  const value = useMemo(() => ({ query, setQuery }), [query]);
  return <HomeSearchContext.Provider value={value}>{children}</HomeSearchContext.Provider>;
}

export function useHomeSearch() {
  return useContext(HomeSearchContext);
}
