import React, { useState } from 'react';
import { Lock, Delete, KeyRound } from 'lucide-react';

interface PinLockScreenProps {
  correctPin: string;
  onUnlocked: () => void;
  onResetPinRequest?: () => void;
}

export const PinLockScreen: React.FC<PinLockScreenProps> = ({
  correctPin,
  onUnlocked,
  onResetPinRequest,
}) => {
  const [enteredPin, setEnteredPin] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  const handleDigit = (digit: string) => {
    if (enteredPin.length >= 4) return;
    setErrorMsg('');
    const nextPin = enteredPin + digit;
    setEnteredPin(nextPin);

    if (nextPin.length === 4) {
      if (nextPin === correctPin) {
        onUnlocked();
      } else {
        setTimeout(() => {
          setErrorMsg('Code PIN incorrect');
          setEnteredPin('');
        }, 150);
      }
    }
  };

  const handleDelete = () => {
    setErrorMsg('');
    setEnteredPin((prev) => prev.slice(0, -1));
  };

  const handleClear = () => {
    setErrorMsg('');
    setEnteredPin('');
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900 text-white flex flex-col justify-between p-6 select-none animate-in fade-in duration-300">
      {/* Top Branding */}
      <div className="flex flex-col items-center pt-8 text-center">
        <div className="w-16 h-16 rounded-3xl bg-teal-500/20 text-teal-400 flex items-center justify-center mb-4 border border-teal-500/30 shadow-lg shadow-teal-500/10">
          <Lock className="w-8 h-8" />
        </div>
        <h1 className="text-2xl font-bold tracking-tight text-white">Yaourt Gestion</h1>
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

        {errorMsg ? (
          <p className="text-sm font-medium text-rose-400 mt-2 animate-bounce">{errorMsg}</p>
        ) : (
          <p className="text-xs text-slate-500 mt-2">Saisissez votre code à 4 chiffres</p>
        )}
      </div>

      {/* Tactile Keypad */}
      <div className="w-full max-w-xs mx-auto pb-6">
        <div className="grid grid-cols-3 gap-3.5">
          {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((digit) => (
            <button
              key={digit}
              type="button"
              onClick={() => handleDigit(digit)}
              className="h-16 rounded-2xl bg-slate-800/80 hover:bg-slate-700/80 active:bg-teal-600 active:scale-95 text-2xl font-semibold text-white shadow-sm border border-slate-700/50 flex items-center justify-center transition-all min-h-[48px]"
            >
              {digit}
            </button>
          ))}
          <button
            type="button"
            onClick={handleClear}
            className="h-16 rounded-2xl bg-slate-800/40 hover:bg-slate-800 active:scale-95 text-sm font-semibold text-slate-400 flex items-center justify-center transition-all min-h-[48px]"
          >
            Effacer
          </button>
          <button
            type="button"
            onClick={() => handleDigit('0')}
            className="h-16 rounded-2xl bg-slate-800/80 hover:bg-slate-700/80 active:bg-teal-600 active:scale-95 text-2xl font-semibold text-white shadow-sm border border-slate-700/50 flex items-center justify-center transition-all min-h-[48px]"
          >
            0
          </button>
          <button
            type="button"
            onClick={handleDelete}
            aria-label="Supprimer un chiffre"
            className="h-16 rounded-2xl bg-slate-800/40 hover:bg-slate-800 active:scale-95 text-slate-300 flex items-center justify-center transition-all min-h-[48px]"
          >
            <Delete className="w-6 h-6" />
          </button>
        </div>

        {onResetPinRequest && (
          <div className="text-center mt-6">
            <button
              type="button"
              onClick={onResetPinRequest}
              className="text-xs text-slate-400 hover:text-teal-400 inline-flex items-center gap-1.5 p-2 transition-colors"
            >
              <KeyRound className="w-3.5 h-3.5" />
              Code PIN oublié ?
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
