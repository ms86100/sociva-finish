// @ts-nocheck
import { createContext, useContext, useState, useCallback, ReactNode } from 'react';
import { CartAddPopup } from './ui/CartAddPopup';
import { CartRemovePopup } from './ui/CartRemovePopup';

interface CartPopupContextType {
  showAddPopup: (productName: string, productImage?: string, price?: number, onViewCart?: () => void) => void;
  showRemovePopup: (productName: string, onContinueShopping?: () => void) => void;
  CartAddPopup: React.ReactElement | null;
  CartRemovePopup: React.ReactElement | null;
}

const CartPopupContext = createContext<CartPopupContextType | undefined>(undefined);

export function CartPopupProvider({ children }: { children: ReactNode }) {
  const [addPopupState, setAddPopupState] = useState<{
    isOpen: boolean;
    productName: string;
    productImage?: string;
    price?: number;
    onViewCart?: () => void;
  }>({ isOpen: false, productName: '' });

  const [removePopupState, setRemovePopupState] = useState<{
    isOpen: boolean;
    productName: string;
    onContinueShopping?: () => void;
  }>({ isOpen: false, productName: '' });

  const showAddPopup = useCallback((
    productName: string,
    productImage?: string,
    price?: number,
    onViewCart?: () => void
  ) => {
    setAddPopupState({ isOpen: true, productName, productImage, price, onViewCart });
  }, []);

  const showRemovePopup = useCallback((
    productName: string,
    onContinueShopping?: () => void
  ) => {
    setRemovePopupState({ isOpen: true, productName, onContinueShopping });
  }, []);

  const handleAddClose = useCallback(() => {
    setAddPopupState(prev => ({ ...prev, isOpen: false }));
    if (addPopupState.onViewCart) {
      addPopupState.onViewCart();
    }
  }, [addPopupState.onViewCart]);

  const handleRemoveClose = useCallback(() => {
    setRemovePopupState(prev => ({ ...prev, isOpen: false }));
    if (removePopupState.onContinueShopping) {
      removePopupState.onContinueShopping();
    }
  }, [removePopupState.onContinueShopping]);

  const addPopup = (
    <CartAddPopup
      isOpen={addPopupState.isOpen}
      onClose={handleAddClose}
      productName={addPopupState.productName}
      productImage={addPopupState.productImage}
      price={addPopupState.price}
      onViewCart={addPopupState.onViewCart}
    />
  );

  const removePopup = (
    <CartRemovePopup
      isOpen={removePopupState.isOpen}
      onClose={handleRemoveClose}
      productName={removePopupState.productName}
      onContinueShopping={removePopupState.onContinueShopping}
    />
  );

  return (
    <CartPopupContext.Provider value={{
      showAddPopup,
      showRemovePopup,
      CartAddPopup: addPopup,
      CartRemovePopup: removePopup,
    }}>
      {children}
      {/* Portals for popups - render at end of body to avoid clipping */}
      <div style={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 9999 }}>
        {addPopup}
        {removePopup}
      </div>
    </CartPopupContext.Provider>
  );
}

export function useCartPopup() {
  const context = useContext(CartPopupContext);
  if (context === undefined) {
    throw new Error('useCartPopup must be used within a CartPopupProvider');
  }
  return context;
}