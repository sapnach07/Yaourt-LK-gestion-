import React, { useState, useEffect, useRef } from 'react';
import { Lock, AlertTriangle, Clock, X } from 'lucide-react';
import { liveQuery } from 'dexie';
import { db, DEFAULT_SETTINGS } from '../db/db';
import {
  verifyPinValue,
  getRemainingDeleteBlockSeconds,
  formatLockoutCountdown,
  recordFailedProtectedDeletePinAttempt,
  clearPinLockoutFields,
} from '../utils/pinSecurity';
import type { AppSettings } from '../types';

// Garantit qu'une seule bannière de compte à rebours s'affiche quand les modales sont fermées
let currentBannerOwner: symbol | null = null;
let openModalsCount = 0;
const bannerListeners = new Set<() => void>();

function notifyBannerListeners() {
  for (const fn of bannerListeners) {
    fn();
  }
}

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
  const instanceIdRef = useRef<symbol>(Symbol('SecurityConfirmModal'));
  const [liveSettings, setLiveSettings] = useState<AppSettings | null>(null);
  const [settingsLoaded, setSettingsLoaded] = useState(false);

  const [inputValue, setInputValue] = useState('');
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [nowTick, setNowTick] = useState(() => Date.now());
  const [, forceBannerSync] = useState(0);

  // Abonnement temps réel aux paramètres pour partager le PIN et les compteurs d'essais / blocages
  useEffect(() => {
    const sub = liveQuery(() => db.settings.get('app_settings')).subscribe({
      next: (res) => {
        setLiveSettings(res ?? null);
        setSettingsLoaded(true);
        setNowTick(Date.now());
      },
      error: () => {
        setSettingsLoaded(true);
      },
    });
    return () => sub.unsubscribe();
  }, []);

  const effectivePinCode = settingsLoaded ? liveSettings?.pinCode : pinCode;
  const hasPin = Boolean(effectivePinCode && effectivePinCode.trim().length > 0);

  const remainingBlockSeconds = hasPin
    ? getRemainingDeleteBlockSeconds(liveSettings, nowTick)
    : 0;
  const isBlocked = remainingBlockSeconds > 0;

  // Compte à rebours en direct pendant un blocage (30 s après 3 erreurs, ou blocage global PIN)
  useEffect(() => {
    const until = Math.max(
      liveSettings?.pinDeleteLockoutUntil ?? 0,
      liveSettings?.pinLockoutUntil ?? 0
    );
    if (!hasPin || until <= Date.now()) {
      return;
    }

    setNowTick(Date.now());
    const interval = window.setInterval(() => {
      const now = Date.now();
      setNowTick(now);
      if (now >= until) {
        window.clearInterval(interval);
      }
    }, 250);

    return () => window.clearInterval(interval);
  }, [hasPin, liveSettings?.pinDeleteLockoutUntil, liveSettings?.pinLockoutUntil]);

  // Suivi des modales ouvertes et attribution d'une unique bannière flottante après fermeture auto
  useEffect(() => {
    const listener = () => forceBannerSync((n) => n + 1);
    bannerListeners.add(listener);
    return () => {
      bannerListeners.delete(listener);
      if (currentBannerOwner === instanceIdRef.current) {
        currentBannerOwner = null;
        notifyBannerListeners();
      }
    };
  }, []);

  useEffect(() => {
    if (isOpen) {
      openModalsCount += 1;
      if (currentBannerOwner === instanceIdRef.current) {
        currentBannerOwner = null;
      }
      notifyBannerListeners();
      return () => {
        openModalsCount = Math.max(0, openModalsCount - 1);
        notifyBannerListeners();
      };
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen && isBlocked && openModalsCount === 0) {
      if (currentBannerOwner === null) {
        currentBannerOwner = instanceIdRef.current;
        notifyBannerListeners();
      }
    } else if (currentBannerOwner === instanceIdRef.current && (!isBlocked || isOpen || openModalsCount > 0)) {
      currentBannerOwner = null;
      notifyBannerListeners();
    }
  }, [isOpen, isBlocked]);

  useEffect(() => {
    if (isOpen) {
      setInputValue('');
      setError('');
      setNowTick(Date.now());
    }
  }, [isOpen]);

  const formatRemainingLabel = (seconds: number): string => {
    if (seconds > 60) {
      return formatLockoutCountdown(seconds);
    }
    return `${seconds} s`;
  };

  // Si la fenêtre vient d'être fermée après 3 erreurs, afficher le compte à rebours de 30 s
  if (!isOpen) {
    if (isBlocked && openModalsCount === 0 && currentBannerOwner === instanceIdRef.current) {
      return (
        <div
          role="status"
          aria-live="polite"
          className="fixed bottom-20 left-4 right-4 z-[60] flex justify-center pointer-events-none"
        >
          <div className="max-w-sm w-full px-4 py-3 rounded-2xl bg-rose-700 text-white shadow-xl border border-rose-500 flex items-center gap-2.5 text-xs font-bold">
            <Clock className="w-4 h-4 shrink-0 text-rose-200" />
            <span>
              Suppressions protégées bloquées — réessayez dans{' '}
              <span className="font-mono font-extrabold underline">
                {formatRemainingLabel(remainingBlockSeconds)}
              </span>
            </span>
          </div>
        </div>
      );
    }
    return null;
  }

  const isInputReady = settingsLoaded || pinCode !== undefined;
  const isConfirmEnabled =
    isInputReady &&
    !isBlocked &&
    !isSubmitting &&
    (hasPin ? /^\d{4}$/.test(inputValue) : inputValue.trim() === confirmWord);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isConfirmEnabled) return;
    setError('');

    if (hasPin) {
      setIsSubmitting(true);
      try {
        const currentSettings =
          (await db.settings.get('app_settings')) || liveSettings || DEFAULT_SETTINGS;

        const currentBlock = getRemainingDeleteBlockSeconds(currentSettings, Date.now());
        if (currentBlock > 0) {
          setNowTick(Date.now());
          return;
        }

        const ok = await verifyPinValue(inputValue, currentSettings.pinCode || effectivePinCode);
        if (!ok) {
          const { updatedSettings, shouldCloseAndBlock } =
            recordFailedProtectedDeletePinAttempt(currentSettings);
          await db.settings.put(updatedSettings);
          setLiveSettings(updatedSettings);
          setNowTick(Date.now());
          setInputValue('');

          if (shouldCloseAndBlock) {
            setError('');
            onCancel();
          } else {
            setError('Code PIN incorrect');
          }
          return;
        }

        // Succès : remettre à zéro les compteurs d'échecs s'il y en avait
        if (
          currentSettings.pinFailedAttempts ||
          currentSettings.pinLockoutCount ||
          currentSettings.pinLockoutUntil ||
          currentSettings.pinDeleteFailedAttempts ||
          currentSettings.pinDeleteLockoutUntil
        ) {
          const cleaned = clearPinLockoutFields(currentSettings);
          await db.settings.put(cleaned);
          setLiveSettings(cleaned);
        }
      } finally {
        setIsSubmitting(false);
      }
    } else {
      if (inputValue.trim() !== confirmWord) {
        setError(`Veuillez taper exactement ${confirmWord} pour confirmer.`);
        return;
      }
    }

    onConfirm();
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-200"
    >
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
            <div className="flex-1 min-w-0">
              <h3 className="text-base font-extrabold text-slate-900 leading-snug">{title}</h3>
              <p className="mt-1 text-xs text-slate-600 leading-relaxed whitespace-pre-line">
                {message}
              </p>
            </div>
          </div>

          {isBlocked ? (
            <div className="p-3.5 rounded-2xl bg-rose-50 border border-rose-200 text-center space-y-1">
              <div className="inline-flex items-center gap-1.5 text-xs font-extrabold text-rose-800">
                <Clock className="w-4 h-4 text-rose-600 shrink-0" />
                <span>Suppressions protégées bloquées</span>
              </div>
              <p className="text-xs font-semibold text-rose-700">
                Réessayez dans{' '}
                <span className="font-mono font-extrabold text-rose-900">
                  {formatRemainingLabel(remainingBlockSeconds)}
                </span>
              </p>
            </div>
          ) : (
            <div className="p-3 rounded-2xl bg-slate-50 border border-slate-200 space-y-2">
              <label className="block text-xs font-bold text-slate-800">
                {hasPin
                  ? 'Entrez votre code PIN pour confirmer'
                  : `Tapez exactement ${confirmWord} pour confirmer`}
              </label>
              <input
                type={hasPin ? 'password' : 'text'}
                inputMode={hasPin ? 'numeric' : 'text'}
                pattern={hasPin ? '[0-9]*' : undefined}
                autoComplete="off"
                maxLength={hasPin ? 4 : 30}
                autoFocus
                disabled={!isInputReady || isBlocked || isSubmitting}
                value={inputValue}
                onChange={(e) => {
                  const raw = e.target.value;
                  setInputValue(hasPin ? raw.replace(/\D/g, '').slice(0, 4) : raw);
                  setError('');
                }}
                placeholder={hasPin ? '••••' : confirmWord}
                className="w-full px-3 py-2.5 rounded-xl border border-slate-300 text-sm font-extrabold text-center tracking-wider text-slate-900 bg-white focus:outline-none focus:ring-2 focus:ring-rose-500 disabled:opacity-50"
              />
              {error && (
                <p className="text-xs font-bold text-rose-600 text-center">{error}</p>
              )}
            </div>
          )}

          <div className="flex items-center justify-end gap-2.5 pt-1">
            <button
              type="button"
              onClick={onCancel}
              className="flex-1 px-4 py-2.5 rounded-xl text-xs font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 transition-colors min-h-[42px]"
            >
              {cancelLabel}
            </button>
            <button
              type="submit"
              disabled={!isConfirmEnabled}
              className="flex-1 px-4 py-2.5 rounded-xl text-xs font-bold text-white bg-rose-600 hover:bg-rose-700 transition-colors min-h-[42px] disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {confirmLabel}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
