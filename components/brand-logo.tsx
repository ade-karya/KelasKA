'use client';

import React from 'react';
import { cn } from '@/lib/utils';

export interface BrandLogoProps {
  size?: 'sm' | 'md' | 'lg';
  className?: string;
  showText?: boolean;
  showLogos?: boolean;
}

export function BrandLogo({
  size = 'md',
  className,
  showText = true,
  showLogos = true,
}: BrandLogoProps) {
  const sizeClasses = {
    sm: {
      logo: 'h-8 w-auto object-contain',
      text: 'text-base font-bold tracking-tight',
      gap: 'gap-2',
      divider: 'h-5 w-px bg-border/60',
    },
    md: {
      logo: 'h-10 md:h-12 w-auto object-contain',
      text: 'text-lg md:text-xl font-extrabold tracking-tight',
      gap: 'gap-2.5',
      divider: 'h-6 w-px bg-border/60',
    },
    lg: {
      logo: 'h-16 md:h-20 w-auto object-contain',
      text: 'text-3xl md:text-4xl font-black tracking-tight',
      gap: 'gap-3 md:gap-4',
      divider: 'h-10 md:h-12 w-px bg-border/60',
    },
  };

  const currentSize = sizeClasses[size];

  return (
    <div className={cn('inline-flex items-center', currentSize.gap, className)}>
      {showLogos && (
        <div className={cn('flex items-center', currentSize.gap)}>
          <img
            src="/logo-kemendikdasmen.png"
            alt="Kemendikdasmen Logo"
            className={cn(currentSize.logo, 'drop-shadow-sm')}
          />
          <img
            src="/logo-dprd.png"
            alt="DPRD Logo"
            className={cn(currentSize.logo, 'drop-shadow-sm')}
          />
        </div>
      )}

      {showLogos && showText && <div className={currentSize.divider} />}

      {showText && (
        <span
          className={cn(
            'bg-gradient-to-r from-blue-600 via-indigo-600 to-purple-600 bg-clip-text text-transparent dark:from-blue-400 dark:via-indigo-300 dark:to-purple-300',
            currentSize.text,
          )}
        >
          Kelas KA
        </span>
      )}
    </div>
  );
}

export default BrandLogo;
