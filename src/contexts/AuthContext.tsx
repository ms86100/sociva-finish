// @ts-nocheck
// Re-export from refactored modules for backward compatibility
export { AuthProvider, useAuth } from './auth/AuthProvider';
export type { AuthContextType } from './auth/types';

// New focused hooks — prefer these over useAuth() for better performance
export { useIdentity, useRoles, useSocietyContext, useSellerContext } from './auth/contexts';
export type { IdentityContextType, RoleContextType, SocietyContextType, SellerContextType } from './auth/contexts';
