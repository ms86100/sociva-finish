// @ts-nocheck
import { createContext, useContext, useState, useCallback, ReactNode } from 'react';
import { CartAddPopup } from './ui/CartAddPopup';
import { CartRemovePopup } from './ui/CartRemovePopup';
import { hideFeedback } from '@/components/FeedbackPopupProvider';

interface CartPopupContextType {
  showAddPopup: (productName: string, productImage?: string, price?: number, onViewCart?: () => void) => void;
  showRemovePopup: (productName: string, onContinueShopping?: () => void) => void;
  isCartPopupOpen: boolean;
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
    hideFeedback();
    setRemovePopupState({ isOpen: false, productName: '' });
    setAddPopupState({ isOpen: true, productName, productImage, price, onViewCart });
  }, []);

  const showRemovePopup = useCallback((
    productName: string,
    onContinueShopping?: () => void
  ) => {
    hideFeedback();
    setAddPopupState({ isOpen: false, productName: '' });
    setRemovePopupState({ isOpen: true, productName, onContinueShopping });
  }, []);

  const handleAddClose = useCallback(() => {
    setAddPopupState((prev) => ({ ...prev, isOpen: false }));
  }, []);

  const handleRemoveClose = useCallback(() => {
    setRemovePopupState((prev) => ({ ...prev, isOpen: false }));
  }, []);

  return (
    <CartPopupContext.Provider value={{
      showAddPopup,
      showRemovePopup,
      isCartPopupOpen: addPopupState.isOpen || removePopupState.isOpen,
    }}>
      {children}
      <CartAddPopup
        isOpen={addPopupState.isOpen}
        onClose={handleAddClose}
        productName={addPopupState.productName}
        productImage={addPopupState.productImage}
        price={addPopupState.price}
        onViewCart={addPopupState.onViewCart}
      />
      <CartRemovePopup
        isOpen={removePopupState.isOpen}
        onClose={handleRemoveClose}
        productName={removePopupState.productName}
        onContinueShopping={removePopupState.onContinueShopping}
      />
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

export function useIsCartPopupOpen() {
  return useContext(CartPopupContext)?.isCartPopupOpen ?? false;
}
