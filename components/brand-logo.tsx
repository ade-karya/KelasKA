'use client';

import React from 'react';
import { cn } from '@/lib/utils';

export interface BrandLogoProps {
  size?: 'xs' | 'sm' | 'md' | 'lg';
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
    xs: {
      logo: 'h-6 w-auto object-contain',
      text: 'text-sm font-bold tracking-tight',
      gap: 'gap-1.5',
      divider: 'h-4 w-px bg-border/60',
    },
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
      // Logo pemerintah selalu tinggi sama agar lambang Kemendikdasmen dan
      // DPRD seimbang (rasio aslinya beda: 300×240 vs 251×240).
      logo: 'h-9 sm:h-12 md:h-14 w-auto object-contain',
      text: 'text-xl sm:text-2xl md:text-3xl font-black tracking-tight',
      gap: 'gap-2 sm:gap-2.5 md:gap-3',
      divider: 'h-5 sm:h-7 md:h-8 w-px bg-border/60',
    },
  };

  const currentSize = sizeClasses[size];

  return (
    <div
      className={cn('inline-flex max-w-full flex-wrap items-center', currentSize.gap, className)}
    >
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
