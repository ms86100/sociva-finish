// @ts-nocheck
import { createContext, useContext, useState, useCallback, ReactNode } from 'react';
import { CartAddPopup } from './ui/CartAddPopup';
import { CartRemovePopup } from './ui/CartRemovePopup';
import { hideFeedback } from '@/components/FeedbackPopupProvider';

export type CartAddPopupCopy = {
  title?: string;
  message?: string;
  primaryLabel?: string;
  secondaryLabel?: string;
};

interface CartPopupContextType {
  showAddPopup: (productName: string, productImage?: string, price?: number, onViewCart?: () => void, copy?: CartAddPopupCopy) => void;
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
    message?: string;
    title?: string;
    primaryLabel?: string;
    secondaryLabel?: string;
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
    onViewCart?: () => void,
    copy?: CartAddPopupCopy,
  ) => {
    hideFeedback();
    setRemovePopupState({ isOpen: false, productName: '' });
    setAddPopupState({
      isOpen: true,
      productName,
      productImage,
      price,
      onViewCart,
      message: copy?.message,
      title: copy?.title,
      primaryLabel: copy?.primaryLabel,
      secondaryLabel: copy?.secondaryLabel,
    });
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
        message={addPopupState.message}
        title={addPopupState.title}
        primaryLabel={addPopupState.primaryLabel}
        secondaryLabel={addPopupState.secondaryLabel}
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
