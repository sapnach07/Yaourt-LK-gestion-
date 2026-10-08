import React from 'react';
import { AlertTriangle, Info, CheckCircle2, X } from 'lucide-react';

interface ConfirmModalProps {
  isOpen: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  isDanger?: boolean;
  isAlertOnly?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export const ConfirmModal: React.FC<ConfirmModalProps> = ({
  isOpen,
  title,
  message,
  confirmLabel = 'Confirmer',
  cancelLabel = 'Annuler',
  isDanger = false,
  isAlertOnly = false,
  onConfirm,
  onCancel,
}) => {
  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-200"
    >
      <div className="w-full max-w-sm bg-white rounded-3xl p-5 shadow-2xl border border-slate-100 flex flex-col gap-4">
        <div className="flex items-start gap-3">
          <div
            className={`w-10 h-10 rounded-2xl flex items-center justify-center shrink-0 ${
              isDanger
                ? 'bg-rose-100 text-rose-600'
                : isAlertOnly
                ? 'bg-amber-100 text-amber-700'
                : 'bg-emerald-100 text-emerald-700'
            }`}
          >
            {isDanger ? (
              <AlertTriangle className="w-5 h-5" />
            ) : isAlertOnly ? (
              <Info className="w-5 h-5" />
            ) : (
              <CheckCircle2 className="w-5 h-5" />
            )}
          </div>
          <div className="flex-1 min-w-0 pt-0.5">
            <h3 className="text-base font-bold text-slate-900 leading-snug">{title}</h3>
            <p className="mt-1 text-sm text-slate-600 leading-relaxed whitespace-pre-line">
              {message}
            </p>
          </div>
          <button
            onClick={onCancel}
            aria-label="Fermer"
            className="text-slate-400 hover:text-slate-600 p-1 -mr-1 -mt-1 rounded-full min-w-[36px] min-h-[36px] flex items-center justify-center"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex items-center gap-2.5 mt-2 pt-2 border-t border-slate-100">
          {!isAlertOnly && (
            <button
              type="button"
              onClick={onCancel}
              className="flex-1 py-3 px-4 rounded-xl border border-slate-200 text-sm font-semibold text-slate-700 hover:bg-slate-50 active:scale-[0.98] transition-all min-h-[44px]"
            >
              {cancelLabel}
            </button>
          )}
          <button
            type="button"
            onClick={onConfirm}
            className={`flex-1 py-3 px-4 rounded-xl text-sm font-semibold text-white active:scale-[0.98] transition-all min-h-[44px] ${
              isDanger
                ? 'bg-rose-600 hover:bg-rose-700 shadow-sm shadow-rose-600/20'
                : 'bg-teal-700 hover:bg-teal-800 shadow-sm shadow-teal-700/20'
            }`}
          >
            {isAlertOnly ? 'Compris' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
};
