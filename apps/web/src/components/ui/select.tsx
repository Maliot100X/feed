import { cn } from '@feed/shared';
import type React from 'react';

/**
 * Select component for dropdown selection.
 *
 * Select dropdown component with controlled value support.
 * Provides onValueChange callback for value updates.
 *
 * @param props - Select component props
 * @returns Select element
 *
 * @example
 * ```tsx
 * <Select value={selected} onValueChange={setSelected}>
 *   <option value="1">Option 1</option>
 * </Select>
 * ```
 */
export interface SelectProps extends React.ComponentPropsWithoutRef<'select'> {
  value?: string;
  onValueChange?: (value: string) => void;
}

export const Select = ({
  children,
  className,
  value,
  onValueChange,
  ...props
}: SelectProps) => {
  return (
    <select
      className={cn(className)}
      value={value}
      onChange={(e) => onValueChange?.(e.target.value)}
      {...props}
    >
      {children}
    </select>
  );
};
