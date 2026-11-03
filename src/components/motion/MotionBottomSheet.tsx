// @ts-nocheck
/**
 * Thin adapter over Vaul Drawer. Keep Vaul for gesture/drag;
 * MotionBottomSheetBody is for Framer-driven custom sheet panels.
 */
import { motion, type HTMLMotionProps } from 'framer-motion';
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from '@/components/ui/drawer';
import { bottomSheetTransition } from '@/lib/motion-variants';
import { cn } from '@/lib/utils';

export const MotionBottomSheet = Drawer;
export const MotionBottomSheetTrigger = DrawerTrigger;
export const MotionBottomSheetClose = DrawerClose;
export const MotionBottomSheetContent = DrawerContent;
export const MotionBottomSheetHeader = DrawerHeader;
export const MotionBottomSheetFooter = DrawerFooter;
export const MotionBottomSheetTitle = DrawerTitle;
export const MotionBottomSheetDescription = DrawerDescription;

type MotionBottomSheetBodyProps = HTMLMotionProps<'div'>;

export function MotionBottomSheetBody({
  className,
  children,
  ...props
}: MotionBottomSheetBodyProps) {
  return (
    <motion.div
      className={cn(className)}
      variants={bottomSheetTransition}
      initial="hidden"
      animate="show"
      exit="exit"
      {...props}
    >
      {children}
    </motion.div>
  );
}
