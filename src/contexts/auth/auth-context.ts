// @ts-nocheck
import { createContext } from 'react';
import type { AuthContextType } from './types';

/**
 * Isolated module so Vite HMR of AuthProvider.tsx does not recreate this
 * context object (which breaks SplashGate / useAuth mid-reload).
 */
export const AuthContext = createContext<AuthContextType | undefined>(undefined);
