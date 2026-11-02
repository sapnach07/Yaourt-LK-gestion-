import React from 'react';
import { CheckCircle2, AlertCircle, Info, X, ArrowUpRight } from 'lucide-react';
import {
  NotificationGlyph,
  getStyledNotificationClasses,
} from './NotificationIcon';
import type { NotificationIconName, NotificationStyleVariant } from '../types';

export interface ToastMessage {
  id: string;
  type: 'success' | 'error' | 'info' | 'custom';
  title?: string;
  message: string;
  customColor?: string;
  customIcon?: NotificationIconName;
  styleVariant?: NotificationStyleVariant;
  actionLabel?: string;
  onAction?: () => void;
}

interface NotificationToastProps {
  toasts: ToastMessage[];
  onDismiss: (id: string) => void;
  position?: 'top' | 'bottom';
}

export const NotificationToast: React.FC<NotificationToastProps> = ({
  toasts,
  onDismiss,
  position = 'top',
}) => {
  if (toasts.length === 0) return null;

  const containerPositionClass =
    position === 'bottom'
      ? 'fixed bottom-20 left-0 right-0 z-50 flex flex-col items-center px-4 pointer-events-none space-y-2'
      : 'fixed top-3 left-0 right-0 z-50 flex flex-col items-center px-4 pointer-events-none space-y-2';

  return (
    <div className={containerPositionClass}>
      {toasts.slice(-4).map((t) => {
        if (t.type === 'custom') {
          const styled = getStyledNotificationClasses(
            t.customColor || 'teal',
            t.styleVariant || 'soft'
          );
          return (
            <div
              key={t.id}
              className={`pointer-events-auto w-full max-w-md rounded-2xl p-3.5 shadow-xl border flex items-start gap-3 transition-all duration-300 ${styled.cardClass}`}
            >
              <div
                className={`w-9 h-9 rounded-xl border flex items-center justify-center shrink-0 ${styled.iconBoxClass}`}
              >
                <NotificationGlyph icon={t.customIcon || 'Bell'} className="w-4 h-4" />
              </div>
              <div className="flex-1 min-w-0">
                {t.title && (
                  <h4 className={`text-xs font-extrabold leading-tight ${styled.titleClass}`}>
                    {t.title}
                  </h4>
                )}
                <p className={`text-xs leading-snug mt-0.5 ${styled.bodyClass}`}>{t.message}</p>
                {t.actionLabel && t.onAction && (
                  <button
                    type="button"
                    onClick={() => {
                      t.onAction?.();
                      onDismiss(t.id);
                    }}
                    className={`mt-2 inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-bold transition-colors whitespace-nowrap ${styled.actionBtnClass}`}
                  >
                    <span>{t.actionLabel}</span>
                    <ArrowUpRight className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
              <button
                type="button"
                onClick={() => onDismiss(t.id)}
                aria-label="Fermer la notification"
                className={`p-1 rounded-lg shrink-0 min-w-[32px] min-h-[32px] flex items-center justify-center transition-colors ${
                  styled.isSolid
                    ? 'text-white/70 hover:text-white hover:bg-white/10'
                    : 'text-slate-400 hover:text-slate-800 hover:bg-black/5'
                }`}
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          );
        }

        return (
          <div
            key={t.id}
            className={`pointer-events-auto w-full max-w-sm rounded-2xl p-3.5 shadow-xl border flex items-start gap-3 transform transition-all duration-300 animate-in slide-in-from-top-4 ${
              t.type === 'success'
                ? 'bg-emerald-950 text-emerald-50 border-emerald-800'
                : t.type === 'error'
                ? 'bg-rose-950 text-rose-50 border-rose-800'
                : 'bg-slate-900 text-slate-50 border-slate-700'
            }`}
          >
            <div className="shrink-0 mt-0.5">
              {t.type === 'success' && <CheckCircle2 className="w-5 h-5 text-emerald-400" />}
              {t.type === 'error' && <AlertCircle className="w-5 h-5 text-rose-400" />}
              {t.type === 'info' && <Info className="w-5 h-5 text-teal-400" />}
            </div>
            <div className="flex-1 min-w-0">
              {t.title && <h4 className="text-xs font-bold leading-tight">{t.title}</h4>}
              <p className="text-xs text-slate-300 leading-snug">{t.message}</p>
            </div>
            <button
              type="button"
              onClick={() => onDismiss(t.id)}
              aria-label="Fermer"
              className="text-slate-400 hover:text-white p-1 rounded-lg shrink-0 min-w-[32px] min-h-[32px] flex items-center justify-center"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        );
      })}
    </div>
  );
};
