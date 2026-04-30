import React, { useState, useRef, useEffect } from 'react';
import { Plus } from 'lucide-react';
import { cn } from '../lib/utils';
import type { ToolbarType } from '../hooks/useToolbarContext';

interface MoreIconDropdownProps {
  toolbarType: ToolbarType;
  children: React.ReactNode;
  className?: string;
}

export const MoreIconDropdown: React.FC<MoreIconDropdownProps> = ({
  toolbarType,
  children,
  className,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [isOpen]);

  const isVertical = toolbarType === 'vertical';

  return (
    <div className={cn('relative', className)} ref={dropdownRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="p-1.5 rounded transition-colors text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 flex items-center justify-center"
        title="More options"
      >
        <Plus size={14} />
      </button>

      {isOpen && (
        <div
          className={cn(
            'absolute z-50 bg-zinc-800 border border-zinc-700 rounded-lg shadow-xl py-1 min-w-[150px]',
            isVertical
              ? 'left-full top-0 ml-1' // vertical toolbar: dropdown to the right
              : 'top-full left-0 mt-1' // horizontal toolbar: dropdown below
          )}
        >
          {children}
        </div>
      )}
    </div>
  );
};
