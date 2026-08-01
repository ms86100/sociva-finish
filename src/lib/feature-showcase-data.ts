// @ts-nocheck
import {
  ShoppingCart, MessageSquare, Scale, IndianRupee, Building2, Bug,
  HelpCircle, DoorOpen, Users, Package, ClipboardCheck, Landmark,
  Wrench, Shield, Car, UserCheck, Briefcase, HardHat, Layers,
  Megaphone, Truck, CalendarOff, Store, QrCode,
  LucideIcon,
} from 'lucide-react';

/** Map icon_name stored in DB to actual Lucide component */
export const iconMap: Record<string, LucideIcon> = {
  ShoppingCart,
  MessageSquare,
  Scale,
  IndianRupee,
  Building2,
  Bug,
  HelpCircle,
  DoorOpen,
  Users,
  Package,
  ClipboardCheck,
  Landmark,
  Wrench,
  Shield,
  Car,
  UserCheck,
  Briefcase,
  HardHat,
  Layers,
  Megaphone,
  Truck,
  CalendarOff,
  Store,
  QrCode,
};

export function getFeatureIcon(iconName: string | null): LucideIcon {
  return (iconName && iconMap[iconName]) || Layers;
}
