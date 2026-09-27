import React from 'react';
import { Spinner } from './Icons';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'outline' | 'ghost' | 'secondary' | 'soft' | 'danger';
  size?: 'sm' | 'md' | 'lg';
  isLoading?: boolean;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
}

export function Button({
  children,
  variant = 'primary',
  size = 'md',
  isLoading = false,
  leftIcon,
  rightIcon,
  disabled,
  className = '',
  ...props
}: ButtonProps) {
  const sizeClasses = {
    sm: 'px-3 py-1.5 text-xs rounded-md font-medium',
    md: 'px-4 py-2 text-sm rounded-lg font-medium',
    lg: 'px-6 py-2.5 text-base rounded-lg font-semibold',
  }[size];

  const variantClasses = {
    primary:
      'bg-[var(--color-brand)] text-white hover:bg-[var(--color-brand-hover)] active:opacity-95 shadow-sm',
    outline:
      'border border-[var(--color-brand)] text-[var(--color-brand)] hover:bg-[var(--color-brand-soft)] active:opacity-90',
    ghost: 'text-[var(--color-ink)] hover:bg-gray-100 active:bg-gray-200',
    secondary:
      'bg-[var(--color-surface-muted)] text-[var(--color-ink)] hover:bg-gray-200 active:opacity-90',
    soft: 'bg-[var(--color-brand-soft)] text-[var(--color-brand)] hover:bg-green-100 active:opacity-90',
    danger: 'bg-red-600 text-white hover:bg-red-700 active:opacity-95',
  }[variant];

  return (
    <button
      disabled={disabled || isLoading}
      className={`inline-flex items-center justify-center gap-2 transition-colors cursor-pointer select-none disabled:opacity-50 disabled:cursor-not-allowed ${sizeClasses} ${variantClasses} ${className}`}
      {...props}
    >
      {isLoading ? <Spinner className="w-4 h-4 text-current" /> : leftIcon}
      {children}
      {!isLoading && rightIcon}
    </button>
  );
}
