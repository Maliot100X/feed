import { cn } from '@feed/shared';
import type React from 'react';

const variantClasses = {
  default: 'bg-primary/15 text-primary',
  secondary: 'bg-muted text-muted-foreground',
  outline: 'border border-border text-foreground',
  destructive: 'bg-red-500/15 text-red-500',
} as const;

/**
 * Small label / status indicator. `variant` selects the colour treatment;
 * `className` can override it.
 *
 * @example
 * ```tsx
 * <Badge variant="secondary">Pending</Badge>
 * ```
 */
export interface BadgeProps extends React.ComponentPropsWithoutRef<'span'> {
  variant?: keyof typeof variantClasses;
}

export const Badge = ({
  children,
  variant = 'default',
  className,
  ...props
}: BadgeProps) => {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-md px-2 py-0.5 font-medium text-xs',
        variantClasses[variant],
        className
      )}
      {...props}
    >
      {children}
    </span>
  );
};
