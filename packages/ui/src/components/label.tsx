import { type LabelHTMLAttributes, forwardRef } from 'react';
import { cn } from '../lib/cn';

export type LabelProps = LabelHTMLAttributes<HTMLLabelElement>;

export const Label = forwardRef<HTMLLabelElement, LabelProps>(({ className, ...props }, ref) => {
  return (
    <label ref={ref} className={cn('text-sm font-medium text-slate-700', className)} {...props} />
  );
});

Label.displayName = 'Label';
