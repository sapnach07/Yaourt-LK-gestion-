import React, { useState, useEffect } from 'react';
import { Lock, AlertTriangle, X } from 'lucide-react';

interface SecurityConfirmModalProps {
  isOpen: boolean;
  title: string;
  message: string;
  pinCode?: string;
  confirmWord?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export const SecurityConfirmModal: React.FC<SecurityConfirmModalProps> = ({
  isOpen,
  title,
  message,
  pinCode,
  confirmWord = 'SUPPRIMER',
  confirmLabel = 'Confirmer',
  cancelLabel = 'Annuler',
  onConfirm,
  onCancel,
}) => {
  const [inputValue, setInputValue] = useState('');
  const [error, setError] = useState('');

  const hasPin = Boolean(pinCode && pinCode.trim().length > 0);

  useEffect(() => {
    if (isOpen) {
      setInputValue('');
      setError('');
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (hasPin) {
      if (inputValue.trim() !== pinCode?.trim()) {
        setError('Code PIN incorrect.');
        return;
      }
    } else {
      if (inputValue.trim().toUpperCase() !== confirmWord.toUpperCase()) {
        setError(`Veuillez saisir exactement « ${confirmWord} » pour confirmer.`);
        return;
      }
    }

    onConfirm();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
      <div className="relative w-full max-w-sm bg-white rounded-3xl p-5 shadow-2xl border border-slate-200">
        <button
          type="button"
          onClick={onCancel}
          aria-label="Fermer"
          className="absolute right-3.5 top-3.5 p-2 rounded-xl text-slate-400 hover:text-slate-700 hover:bg-slate-100"
        >
          <X className="w-4 h-4" />
        </button>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="flex items-start gap-3 pr-6">
            <div className="w-10 h-10 rounded-2xl bg-rose-100 text-rose-600 flex items-center justify-center shrink-0">
              {hasPin ? <Lock className="w-5 h-5" /> : <AlertTriangle className="w-5 h-5" />}
            </div>
            <div>
              <h3 className="text-base font-extrabold text-slate-900 leading-snug">{title}</h3>
              <p className="mt-1 text-xs text-slate-600 leading-relaxed">{message}</p>
            </div>
          </div>

          <div className="p-3 rounded-2xl bg-slate-50 border border-slate-200 space-y-2">
            <label className="block text-xs font-bold text-slate-800">
              {hasPin
                ? 'Entrez votre code PIN à 4 chiffres pour valider :'
                : `Tapez « ${confirmWord} » pour valider :`}
            </label>
            <input
              type={hasPin ? 'password' : 'text'}
              inputMode={hasPin ? 'numeric' : 'text'}
              maxLength={hasPin ? 4 : 30}
              autoFocus
              value={inputValue}
              onChange={(e) => {
                setInputValue(hasPin ? e.target.value.replace(/\D/g, '') : e.target.value);
                setError('');
              }}
              placeholder={hasPin ? '••••' : confirmWord}
              className="w-full px-3 py-2.5 rounded-xl border border-slate-300 text-sm font-extrabold text-center tracking-wider text-slate-900 bg-white focus:outline-none focus:ring-2 focus:ring-rose-500"
            />
            {error && (
              <p className="text-xs font-bold text-rose-600 text-center">{error}</p>
            )}
          </div>

          <div className="flex items-center justify-end gap-2.5 pt-1">
            <button
              type="button"
              onClick={onCancel}
              className="px-4 py-2.5 rounded-xl text-xs font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 transition-colors min-h-[42px]"
            >
              {cancelLabel}
            </button>
            <button
              type="submit"
              className="px-4 py-2.5 rounded-xl text-xs font-bold text-white bg-rose-600 hover:bg-rose-700 transition-colors min-h-[42px]"
            >
              {confirmLabel}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
