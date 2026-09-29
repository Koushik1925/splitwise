import { type InputHTMLAttributes, forwardRef } from 'react';
import { cn } from '../lib/cn';

export type InputProps = InputHTMLAttributes<HTMLInputElement>;

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, type = 'text', ...props }, ref) => {
    return (
      <input
        ref={ref}
        type={type}
        className={cn(
          'flex h-10 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-50 aria-[invalid=true]:border-red-500 aria-[invalid=true]:focus-visible:ring-red-500',
          className,
        )}
        {...props}
      />
    );
  },
);

Input.displayName = 'Input';
