import React from 'react';
import { Lock, ShieldCheck } from 'lucide-react';
import { formatDate, toISODate } from '../utils/formatters';

interface HeaderProps {
  businessName: string;
  hasPin: boolean;
  onLockNow?: () => void;
  openCalculator?: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  businessName,
  hasPin,
  onLockNow,
}) => {
  const todayStr = formatDate(toISODate(new Date()));

  return (
    <header className="sticky top-0 z-30 bg-white/95 backdrop-blur-md border-b border-slate-200/80 px-4 py-2.5 flex items-center justify-between shadow-xs">
      {/* Zone 1: Brand Title */}
      <div className="flex items-center gap-2.5">
        <div className="w-8 h-8 rounded-xl bg-teal-700 text-white flex items-center justify-center font-bold text-sm shadow-xs">
          Y
        </div>
        <div>
          <h1 className="text-base font-extrabold tracking-tight text-slate-900 leading-none">
            {businessName || 'Yaourt Gestion'}
          </h1>
          <div className="flex items-center gap-1.5 text-[11px] text-slate-500 font-medium mt-0.5">
            <span>{todayStr}</span>
            <span aria-hidden="true">·</span>
            <span className="text-teal-700 font-semibold inline-flex items-center gap-0.5">
              <ShieldCheck className="w-3 h-3" />
              100% Hors ligne
            </span>
          </div>
        </div>
      </div>

      {/* Zone 2 / 3: Quick Action (Lock screen if PIN is enabled) */}
      <div className="flex items-center gap-1">
        {hasPin && onLockNow && (
          <button
            type="button"
            onClick={onLockNow}
            title="Verrouiller l’application"
            aria-label="Verrouiller"
            className="p-2 rounded-xl text-slate-500 hover:text-slate-800 hover:bg-slate-100 active:scale-95 transition-all min-h-[44px] min-w-[44px] flex items-center justify-center"
          >
            <Lock className="w-4 h-4" />
          </button>
        )}
      </div>
    </header>
  );
};
