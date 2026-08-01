// @ts-nocheck
import React, { createContext, useContext, useCallback, useRef } from 'react';

interface NewOrderAlertContextType {
  dismissById: (orderId: string) => void;
  dismissAll: () => void;
  registerDismissById: (fn: (id: string) => void) => void;
  registerDismissAll: (fn: () => void) => void;
}

const NewOrderAlertContext = createContext<NewOrderAlertContextType>({
  dismissById: () => {},
  dismissAll: () => {},
  registerDismissById: () => {},
  registerDismissAll: () => {},
});

export function NewOrderAlertProvider({ children }: { children: React.ReactNode }) {
  const dismissByIdRef = useRef<(id: string) => void>(() => {});
  const dismissAllRef = useRef<() => void>(() => {});

  const dismissById = useCallback((id: string) => dismissByIdRef.current(id), []);
  const dismissAll = useCallback(() => dismissAllRef.current(), []);
  const registerDismissById = useCallback((fn: (id: string) => void) => { dismissByIdRef.current = fn; }, []);
  const registerDismissAll = useCallback((fn: () => void) => { dismissAllRef.current = fn; }, []);

  return (
    <NewOrderAlertContext.Provider value={{ dismissById, dismissAll, registerDismissById, registerDismissAll }}>
      {children}
    </NewOrderAlertContext.Provider>
  );
}

export function useNewOrderAlertContext() {
  return useContext(NewOrderAlertContext);
}
