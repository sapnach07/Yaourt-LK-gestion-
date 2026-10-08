import React from 'react';
import { CheckCircle2, AlertCircle, Info, X } from 'lucide-react';

export interface ToastMessage {
  id: string;
  type: 'success' | 'error' | 'info';
  title?: string;
  message: string;
}

interface NotificationToastProps {
  toasts: ToastMessage[];
  onDismiss: (id: string) => void;
}

export const NotificationToast: React.FC<NotificationToastProps> = ({
  toasts,
  onDismiss,
}) => {
  if (toasts.length === 0) return null;

  return (
    <div className="fixed top-3 left-0 right-0 z-50 flex flex-col items-center px-4 pointer-events-none space-y-2">
      {toasts.map((t) => (
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
            onClick={() => onDismiss(t.id)}
            className="text-slate-400 hover:text-white p-1 rounded-lg shrink-0 min-w-[32px] min-h-[32px] flex items-center justify-center"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      ))}
    </div>
  );
};
