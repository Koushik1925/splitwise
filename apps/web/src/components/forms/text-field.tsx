import { forwardRef, type ReactNode } from 'react';
import { Input, Label, type InputProps } from '@splitwise/ui';

interface TextFieldProps extends InputProps {
  id: string;
  label: string;
  error?: string;
}

/** Label + input + inline error, wired for screen readers. Spread react-hook-form's `register()` onto it. */
export const TextField = forwardRef<HTMLInputElement, TextFieldProps>(
  ({ id, label, error, ...inputProps }, ref) => {
    const errorId = `${id}-error`;
    return (
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={id}>{label}</Label>
        <Input
          ref={ref}
          id={id}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
          {...inputProps}
        />
        {error ? (
          <p id={errorId} className="text-xs text-red-600">
            {error}
          </p>
        ) : null}
      </div>
    );
  },
);

TextField.displayName = 'TextField';

export function FormAlert({ children }: { children: ReactNode }) {
  return (
    <div
      role="alert"
      className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
    >
      {children}
    </div>
  );
}
