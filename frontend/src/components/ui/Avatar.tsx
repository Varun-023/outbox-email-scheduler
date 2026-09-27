import React, { useState } from 'react';

interface AvatarProps {
  src?: string | null;
  name?: string | null;
  email?: string | null;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

export function Avatar({ src, name, email, size = 'md', className = '' }: AvatarProps) {
  const [hasError, setHasError] = useState(false);

  const initial = (name?.trim() || email?.trim() || 'U')[0]?.toUpperCase() || 'U';

  const sizeClasses = {
    sm: 'w-6 h-6 text-xs',
    md: 'w-9 h-9 text-sm',
    lg: 'w-10 h-10 text-base',
  }[size];

  if (src && !hasError) {
    return (
      <img
        src={src}
        alt={name || email || 'User avatar'}
        onError={() => setHasError(true)}
        className={`${sizeClasses} rounded-full object-cover shrink-0 ${className}`}
      />
    );
  }

  return (
    <div
      className={`${sizeClasses} rounded-full bg-[var(--color-avatar)] text-white font-semibold flex items-center justify-center shrink-0 select-none ${className}`}
    >
      {initial}
    </div>
  );
}
