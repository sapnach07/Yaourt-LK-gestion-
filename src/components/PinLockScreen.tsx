import React, { useState, useEffect } from 'react';
import { Lock, Delete, KeyRound, ArrowLeft, Clock } from 'lucide-react';
import { db } from '../db/db';
import {
  verifyPinValue,
  isLegacyPlaintextPin,
  hashSecretWithSalt,
  generateRecoveryCode,
  hashRecoveryCode,
  verifyRecoveryCode,
  getRemainingLockoutSeconds,
  formatLockoutCountdown,
  recordFailedPinOrRecoveryAttempt,
  clearPinLockoutFields,
} from '../utils/pinSecurity';
import type { AppSettings } from '../types';

interface PinLockScreenProps {
  settings: AppSettings;
  onSettingsUpdated: (newSettings: AppSettings) => void;
  onUnlocked: (oneTimeRecoveryCode?: string) => void;
  businessName?: string;
  logoBase64?: string;
}

type LockScreenView = 'pin' | 'recovery_verify' | 'recovery_new_pin';

export const PinLockScreen: React.FC<PinLockScreenProps> = ({
  settings,
  onSettingsUpdated,
  onUnlocked,
  businessName,
  logoBase64,
}) => {
  const [view, setView] = useState<LockScreenView>('pin');
  const [enteredPin, setEnteredPin] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [isVerifying, setIsVerifying] = useState(false);
  const [logoLoadFailed, setLogoLoadFailed] = useState(false);

  // Recovery flow states
  const [recoveryInput, setRecoveryInput] = useState('');
  const [recoveryError, setRecoveryError] = useState('');
  const [newPin, setNewPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [newPinError, setNewPinError] = useState('');

  // Live countdown tick
  const [nowTick, setNowTick] = useState(() => Date.now());

  useEffect(() => {
    if (!settings.pinLockoutUntil || settings.pinLockoutUntil <= Date.now()) {
      return;
    }
    setNowTick(Date.now());
    const interval = window.setInterval(() => {
      const current = Date.now();
      setNowTick(current);
      if (!settings.pinLockoutUntil || current >= settings.pinLockoutUntil) {
        window.clearInterval(interval);
      }
    }, 1000);
    return () => window.clearInterval(interval);
  }, [settings.pinLockoutUntil]);

  const remainingLockoutSeconds = getRemainingLockoutSeconds(settings, nowTick);
  const isLockedOut = remainingLockoutSeconds > 0;

  // Clear stale lockout error automatically once timer expires
  useEffect(() => {
    if (!isLockedOut) {
      setErrorMsg((prev) => (prev.startsWith('Trop d’essais') ? '' : prev));
      setRecoveryError((prev) => (prev.startsWith('Trop d’essais') ? '' : prev));
    }
  }, [isLockedOut]);

  const handleDigit = async (digit: string) => {
    if (isLockedOut || isVerifying || enteredPin.length >= 4) return;
    setErrorMsg('');
    const nextPin = enteredPin + digit;
    setEnteredPin(nextPin);

    if (nextPin.length === 4) {
      setIsVerifying(true);
      try {
        const isValid = await verifyPinValue(nextPin, settings.pinCode);
        if (isValid) {
          // Point 5 : Migration automatique d'un PIN existant en clair vers empreinte salée + code de récupération
          if (isLegacyPlaintextPin(settings.pinCode)) {
            const hashedPin = await hashSecretWithSalt(nextPin);
            const freshRecoveryCode = generateRecoveryCode();
            const hashedRecovery = await hashRecoveryCode(freshRecoveryCode);
            const migratedSettings: AppSettings = {
              ...clearPinLockoutFields(settings),
              pinCode: hashedPin,
              recoveryCodeHash: hashedRecovery,
            };
            await db.settings.put(migratedSettings);
            onSettingsUpdated(migratedSettings);
            onUnlocked(freshRecoveryCode);
            return;
          }

          // Remise à zéro du compteur et du blocage après un déverrouillage réussi
          if (
            settings.pinFailedAttempts ||
            settings.pinLockoutCount ||
            settings.pinLockoutUntil
          ) {
            const cleanedSettings = clearPinLockoutFields(settings);
            await db.settings.put(cleanedSettings);
            onSettingsUpdated(cleanedSettings);
          }
          onUnlocked();
        } else {
          const {
            updatedSettings,
            isNowLockedOut,
            lockoutDurationMinutes,
            remainingAttemptsBeforeLockout,
          } = recordFailedPinOrRecoveryAttempt(settings);
          await db.settings.put(updatedSettings);
          onSettingsUpdated(updatedSettings);
          setNowTick(Date.now());

          setTimeout(() => {
            if (isNowLockedOut) {
              setErrorMsg(
                `Trop d’essais incorrects. Saisie bloquée pendant ${lockoutDurationMinutes} min.`
              );
            } else {
              setErrorMsg(
                `Code PIN incorrect (${remainingAttemptsBeforeLockout} essai${
                  remainingAttemptsBeforeLockout > 1 ? 's' : ''
                } restant${remainingAttemptsBeforeLockout > 1 ? 's' : ''})`
              );
            }
            setEnteredPin('');
            setIsVerifying(false);
          }, 150);
          return;
        }
      } finally {
        setIsVerifying(false);
      }
    }
  };

  const handleDelete = () => {
    if (isLockedOut || isVerifying) return;
    setErrorMsg('');
    setEnteredPin((prev) => prev.slice(0, -1));
  };

  const handleClear = () => {
    if (isLockedOut || isVerifying) return;
    setErrorMsg('');
    setEnteredPin('');
  };

  const handleVerifyRecoverySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isLockedOut || isVerifying) return;
    setRecoveryError('');

    if (!recoveryInput.trim()) {
      setRecoveryError('Veuillez saisir votre code de récupération à 12 caractères.');
      return;
    }

    setIsVerifying(true);
    try {
      const isValid = await verifyRecoveryCode(recoveryInput, settings.recoveryCodeHash);
      if (isValid) {
        setRecoveryInput('');
        setRecoveryError('');
        setNewPin('');
        setConfirmPin('');
        setNewPinError('');
        setView('recovery_new_pin');
      } else {
        const {
          updatedSettings,
          isNowLockedOut,
          lockoutDurationMinutes,
          remainingAttemptsBeforeLockout,
        } = recordFailedPinOrRecoveryAttempt(settings);
        await db.settings.put(updatedSettings);
        onSettingsUpdated(updatedSettings);
        setNowTick(Date.now());

        if (isNowLockedOut) {
          setRecoveryError(
            `Trop d’essais incorrects. Saisie bloquée pendant ${lockoutDurationMinutes} min.`
          );
        } else {
          setRecoveryError(
            `Code de récupération incorrect (${remainingAttemptsBeforeLockout} essai${
              remainingAttemptsBeforeLockout > 1 ? 's' : ''
            } restant${remainingAttemptsBeforeLockout > 1 ? 's' : ''}).`
          );
        }
      }
    } finally {
      setIsVerifying(false);
    }
  };

  const handleCreateNewPinAfterRecovery = async (e: React.FormEvent) => {
    e.preventDefault();
    setNewPinError('');

    if (newPin.length !== 4 || !/^\d{4}$/.test(newPin)) {
      setNewPinError('Le nouveau code PIN doit comporter exactement 4 chiffres.');
      return;
    }
    if (newPin !== confirmPin) {
      setNewPinError('Les deux codes PIN ne correspondent pas.');
      return;
    }

    setIsVerifying(true);
    try {
      const hashedPin = await hashSecretWithSalt(newPin);
      const freshRecoveryCode = generateRecoveryCode();
      const hashedRecovery = await hashRecoveryCode(freshRecoveryCode);

      const updatedSettings: AppSettings = {
        ...clearPinLockoutFields(settings),
        pinCode: hashedPin,
        recoveryCodeHash: hashedRecovery,
      };
      await db.settings.put(updatedSettings);
      onSettingsUpdated(updatedSettings);

      setNewPin('');
      setConfirmPin('');
      onUnlocked(freshRecoveryCode);
    } finally {
      setIsVerifying(false);
    }
  };

  const renderLockoutBanner = () => {
    if (!isLockedOut) return null;
    return (
      <div className="mt-4 w-full max-w-xs mx-auto p-3.5 rounded-2xl bg-rose-950/80 border border-rose-500/40 text-center space-y-1">
        <div className="inline-flex items-center justify-center gap-1.5 text-rose-300 text-xs font-extrabold uppercase tracking-wider">
          <Clock className="w-4 h-4" />
          <span>Saisie temporairement bloquée</span>
        </div>
        <p className="text-xs text-rose-200/90">
          Réessayez dans{' '}
          <span className="font-mono text-base font-extrabold text-white">
            {formatLockoutCountdown(remainingLockoutSeconds)}
          </span>
        </p>
      </div>
    );
  };

  // =========================================================================
  // ÉCRAN : VÉRIFICATION DU CODE DE RÉCUPÉRATION ("CODE PIN OUBLIÉ ?")
  // =========================================================================
  if (view === 'recovery_verify') {
    return (
      <div className="fixed inset-0 z-50 bg-slate-900 text-white flex flex-col justify-between p-6 animate-in fade-in duration-200 overflow-y-auto">
        <div className="w-full max-w-sm mx-auto pt-4 space-y-6 my-auto">
          <button
            type="button"
            onClick={() => {
              setRecoveryError('');
              setRecoveryInput('');
              setView('pin');
            }}
            className="inline-flex items-center gap-2 text-xs font-bold text-slate-300 hover:text-white py-2 px-3 rounded-xl bg-slate-800/80 border border-slate-700/60"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Retour au code PIN</span>
          </button>

          <div className="text-center space-y-2">
            <div className="w-14 h-14 mx-auto rounded-2xl bg-teal-500/15 border border-teal-400/30 flex items-center justify-center text-teal-300">
              <KeyRound className="w-6 h-6" />
            </div>
            <h1 className="text-xl font-extrabold tracking-tight text-white">
              Code PIN oublié
            </h1>
            <p className="text-xs text-slate-400 leading-relaxed">
              Saisissez le code de récupération à 12 caractères reçu lors de la création ou de la
              modification de votre PIN.
            </p>
          </div>

          {renderLockoutBanner()}

          <form
            onSubmit={handleVerifyRecoverySubmit}
            className="bg-slate-800/70 border border-slate-700/70 rounded-3xl p-5 space-y-4"
          >
            <div>
              <label className="block text-xs font-bold text-slate-300 mb-1.5">
                Code de récupération (12 caractères)
              </label>
              <input
                type="text"
                autoCapitalize="characters"
                autoComplete="off"
                spellCheck={false}
                disabled={isLockedOut || isVerifying}
                value={recoveryInput}
                onChange={(e) => {
                  setRecoveryInput(e.target.value.toUpperCase());
                  setRecoveryError('');
                }}
                placeholder="XXXX-XXXX-XXXX"
                className="w-full px-3.5 py-3 rounded-xl bg-slate-900 border border-slate-600 text-center font-mono text-base font-extrabold tracking-widest text-white placeholder:text-slate-600 focus:outline-none focus:border-teal-400 disabled:opacity-50"
              />
            </div>

            {recoveryError && (
              <p className="text-xs font-bold text-rose-400 bg-rose-950/60 border border-rose-500/30 p-2.5 rounded-xl text-center">
                {recoveryError}
              </p>
            )}

            <button
              type="submit"
              disabled={isLockedOut || isVerifying}
              className="w-full py-3 px-4 rounded-xl bg-teal-600 hover:bg-teal-500 disabled:opacity-50 text-white text-xs font-extrabold transition-colors min-h-[46px]"
            >
              {isVerifying ? 'Vérification...' : 'Vérifier le code de récupération'}
            </button>
          </form>
        </div>
        <div />
      </div>
    );
  }

  // =========================================================================
  // ÉCRAN : CRÉATION OBLIGATOIRE D'UN NOUVEAU CODE PIN APRÈS RÉCUPÉRATION
  // =========================================================================
  if (view === 'recovery_new_pin') {
    return (
      <div className="fixed inset-0 z-50 bg-slate-900 text-white flex flex-col justify-between p-6 animate-in fade-in duration-200 overflow-y-auto">
        <div className="w-full max-w-sm mx-auto pt-4 space-y-6 my-auto">
          <div className="text-center space-y-2">
            <div className="w-14 h-14 mx-auto rounded-2xl bg-emerald-500/15 border border-emerald-400/30 flex items-center justify-center text-emerald-300">
              <Lock className="w-6 h-6" />
            </div>
            <h1 className="text-xl font-extrabold tracking-tight text-white">
              Créer un nouveau code PIN
            </h1>
            <p className="text-xs text-slate-400 leading-relaxed">
              Code de récupération validé. Choisissez un nouveau code PIN à 4 chiffres ; un nouveau
              code de récupération sera ensuite généré.
            </p>
          </div>

          <form
            onSubmit={handleCreateNewPinAfterRecovery}
            className="bg-slate-800/70 border border-slate-700/70 rounded-3xl p-5 space-y-4"
          >
            {newPinError && (
              <p className="text-xs font-bold text-rose-400 bg-rose-950/60 border border-rose-500/30 p-2.5 rounded-xl text-center">
                {newPinError}
              </p>
            )}

            <div>
              <label className="block text-xs font-bold text-slate-300 mb-1.5">
                Nouveau code PIN (4 chiffres)
              </label>
              <input
                type="password"
                inputMode="numeric"
                maxLength={4}
                required
                value={newPin}
                onChange={(e) => {
                  setNewPin(e.target.value.replace(/\D/g, ''));
                  setNewPinError('');
                }}
                placeholder="••••"
                className="w-full py-3 rounded-xl bg-slate-900 border border-slate-600 text-center font-mono text-xl font-extrabold tracking-widest text-white focus:outline-none focus:border-teal-400"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-300 mb-1.5">
                Confirmer le nouveau code PIN
              </label>
              <input
                type="password"
                inputMode="numeric"
                maxLength={4}
                required
                value={confirmPin}
                onChange={(e) => {
                  setConfirmPin(e.target.value.replace(/\D/g, ''));
                  setNewPinError('');
                }}
                placeholder="••••"
                className="w-full py-3 rounded-xl bg-slate-900 border border-slate-600 text-center font-mono text-xl font-extrabold tracking-widest text-white focus:outline-none focus:border-teal-400"
              />
            </div>

            <div className="flex items-center gap-2 pt-1">
              <button
                type="button"
                disabled={isVerifying}
                onClick={() => {
                  setNewPin('');
                  setConfirmPin('');
                  setNewPinError('');
                  setView('pin');
                }}
                className="flex-1 py-3 px-3 rounded-xl bg-slate-700/70 hover:bg-slate-700 text-slate-200 text-xs font-bold min-h-[46px]"
              >
                Annuler
              </button>
              <button
                type="submit"
                disabled={isVerifying}
                className="flex-1 py-3 px-3 rounded-xl bg-teal-600 hover:bg-teal-500 disabled:opacity-50 text-white text-xs font-extrabold min-h-[46px]"
              >
                {isVerifying ? 'Enregistrement...' : 'Enregistrer'}
              </button>
            </div>
          </form>
        </div>
        <div />
      </div>
    );
  }

  // =========================================================================
  // ÉCRAN PRINCIPAL : CLAVIER PIN À 4 CHIFFRES
  // =========================================================================
  return (
    <div className="fixed inset-0 z-50 bg-slate-900 text-white flex flex-col justify-between p-6 select-none animate-in fade-in duration-300">
      {/* Top Branding */}
      <div className="flex flex-col items-center pt-8 text-center">
        {logoBase64 ? (
          <div className="w-16 h-16 rounded-3xl bg-white/10 p-2.5 border border-white/20 shadow-lg shadow-teal-500/10 flex items-center justify-center mb-4 overflow-hidden backdrop-blur-sm">
            <img src={logoBase64} alt="Logo" className="w-full h-full object-contain" />
          </div>
        ) : (
          <div className="w-16 h-16 rounded-3xl bg-white/10 p-2 border border-white/20 shadow-lg flex items-center justify-center mb-4 overflow-hidden backdrop-blur-sm">
            {!logoLoadFailed && (
              <img
                src="/pwa-192x192.png"
                alt="Logo"
                className="w-full h-full object-contain"
                onError={() => setLogoLoadFailed(true)}
              />
            )}
          </div>
        )}
        <h1 className="text-2xl font-bold tracking-tight text-white">
          {businessName || 'Yaourt Gestion'}
        </h1>
        <p className="text-sm text-slate-400 mt-1">Application sécurisée par code PIN</p>

        {/* 4 PIN Dots */}
        <div className="flex items-center gap-4 mt-8 mb-2">
          {[0, 1, 2, 3].map((idx) => {
            const isFilled = enteredPin.length > idx;
            return (
              <div
                key={idx}
                className={`w-4 h-4 rounded-full transition-all duration-200 ${
                  isFilled
                    ? 'bg-teal-400 scale-125 shadow-sm shadow-teal-400'
                    : 'bg-slate-700 border border-slate-600'
                }`}
              />
            );
          })}
        </div>

        {renderLockoutBanner()}

        {!isLockedOut &&
          (errorMsg ? (
            <p className="text-sm font-medium text-rose-400 mt-2">{errorMsg}</p>
          ) : (
            <p className="text-xs text-slate-500 mt-2">Saisissez votre code à 4 chiffres</p>
          ))}
      </div>

      {/* Tactile Keypad */}
      <div className="w-full max-w-xs mx-auto pb-6">
        <div className="grid grid-cols-3 gap-3.5">
          {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((digit) => (
            <button
              key={digit}
              type="button"
              disabled={isLockedOut || isVerifying}
              onClick={() => handleDigit(digit)}
              className="h-16 rounded-2xl bg-slate-800/80 hover:bg-slate-700/80 active:bg-teal-600 active:scale-95 disabled:opacity-40 disabled:pointer-events-none text-2xl font-semibold text-white shadow-sm border border-slate-700/50 flex items-center justify-center transition-all min-h-[48px]"
            >
              {digit}
            </button>
          ))}
          <button
            type="button"
            disabled={isLockedOut || isVerifying}
            onClick={handleClear}
            className="h-16 rounded-2xl bg-slate-800/40 hover:bg-slate-800 active:scale-95 disabled:opacity-40 disabled:pointer-events-none text-sm font-semibold text-slate-400 flex items-center justify-center transition-all min-h-[48px]"
          >
            Effacer
          </button>
          <button
            type="button"
            disabled={isLockedOut || isVerifying}
            onClick={() => handleDigit('0')}
            className="h-16 rounded-2xl bg-slate-800/80 hover:bg-slate-700/80 active:bg-teal-600 active:scale-95 disabled:opacity-40 disabled:pointer-events-none text-2xl font-semibold text-white shadow-sm border border-slate-700/50 flex items-center justify-center transition-all min-h-[48px]"
          >
            0
          </button>
          <button
            type="button"
            disabled={isLockedOut || isVerifying}
            onClick={handleDelete}
            aria-label="Supprimer un chiffre"
            className="h-16 rounded-2xl bg-slate-800/40 hover:bg-slate-800 active:scale-95 disabled:opacity-40 disabled:pointer-events-none text-slate-300 flex items-center justify-center transition-all min-h-[48px]"
          >
            <Delete className="w-6 h-6" />
          </button>
        </div>

        <div className="text-center mt-6">
          <button
            type="button"
            onClick={() => {
              setErrorMsg('');
              setEnteredPin('');
              setRecoveryError('');
              setRecoveryInput('');
              setView('recovery_verify');
            }}
            className="text-xs text-slate-400 hover:text-teal-400 inline-flex items-center gap-1.5 p-2 transition-colors"
          >
            <KeyRound className="w-3.5 h-3.5" />
            Code PIN oublié ?
          </button>
        </div>
      </div>
    </div>
  );
};
