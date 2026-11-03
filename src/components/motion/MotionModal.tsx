// @ts-nocheck
/**
 * Thin adapter over shadcn Dialog. Prefer Dialog for standard modals;
 * use MotionModalBody when you need Framer enter/exit inside a custom overlay.
 */
import { motion, type HTMLMotionProps } from 'framer-motion';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { modalTransition } from '@/lib/motion-variants';
import { cn } from '@/lib/utils';

export const MotionModal = Dialog;
export const MotionModalTrigger = DialogTrigger;
export const MotionModalClose = DialogClose;
export const MotionModalContent = DialogContent;
export const MotionModalHeader = DialogHeader;
export const MotionModalFooter = DialogFooter;
export const MotionModalTitle = DialogTitle;
export const MotionModalDescription = DialogDescription;

type MotionModalBodyProps = HTMLMotionProps<'div'>;

export function MotionModalBody({ className, children, ...props }: MotionModalBodyProps) {
  return (
    <motion.div
      className={cn(className)}
      variants={modalTransition}
      initial="hidden"
      animate="show"
      exit="exit"
      {...props}
    >
      {children}
    </motion.div>
  );
}
