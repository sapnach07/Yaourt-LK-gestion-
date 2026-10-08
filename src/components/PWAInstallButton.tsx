import React, { useState } from 'react';
import { Download, Share2, X, Smartphone, CheckCircle } from 'lucide-react';
import { usePWAInstall } from '../hooks/usePWAInstall';

interface PWAInstallButtonProps {
  variant?: 'compact' | 'full';
}

export const PWAInstallButton: React.FC<PWAInstallButtonProps> = ({ variant = 'compact' }) => {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showIOSGuide, setShowIOSGuide] = useState(false);

  // If already installed in standalone mode (or APK)
  if (isInstalled) {
    if (variant === 'full') {
      return (
        <div className="flex items-center gap-2 p-3 rounded-2xl bg-teal-50 border border-teal-200 text-teal-800 text-xs font-semibold">
          <CheckCircle className="w-4 h-4 text-teal-700" />
          <span>Application installée et active en mode autonome (PWA / APK).</span>
        </div>
      );
    }
    return null;
  }

  // Android / Chromium / Desktop flow
  if (isInstallable) {
    if (variant === 'compact') {
      return (
        <button
          type="button"
          onClick={install}
          title="Installer l'application sur le téléphone"
          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-teal-700 hover:bg-teal-800 text-white text-xs font-bold shadow-xs active:scale-95 transition-all min-h-[38px]"
        >
          <Download className="w-3.5 h-3.5" />
          <span>Installer</span>
        </button>
      );
    }

    return (
      <button
        type="button"
        onClick={install}
        className="w-full py-3 px-4 rounded-xl bg-teal-700 hover:bg-teal-800 text-white text-xs font-bold shadow-xs active:scale-95 transition-all flex items-center justify-center gap-2 min-h-[44px]"
      >
        <Download className="w-4 h-4" />
        <span>Installer Yaourt Gestion sur le téléphone (PWA)</span>
      </button>
    );
  }

  // iOS Safari flow
  if (isIOS) {
    return (
      <>
        {variant === 'compact' ? (
          <button
            type="button"
            onClick={() => setShowIOSGuide(true)}
            title="Installer sur iPhone"
            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold border border-slate-200 min-h-[38px]"
          >
            <Smartphone className="w-3.5 h-3.5 text-teal-700" />
            <span>Installer</span>
          </button>
        ) : (
          <button
            type="button"
            onClick={() => setShowIOSGuide(true)}
            className="w-full py-3 px-4 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-bold border border-slate-200 flex items-center justify-center gap-2 min-h-[44px]"
          >
            <Smartphone className="w-4 h-4 text-teal-700" />
            <span>Installer sur iPhone / iPad</span>
          </button>
        )}

        {showIOSGuide && (
          <div
            role="dialog"
            aria-modal="true"
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in"
          >
            <div className="w-full max-w-sm bg-white rounded-3xl p-5 shadow-2xl border border-slate-100 space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-slate-900">
                  <Smartphone className="w-5 h-5 text-teal-700" />
                  <h3 className="text-sm font-bold">Installer sur l'écran d'accueil</h3>
                </div>
                <button
                  type="button"
                  onClick={() => setShowIOSGuide(false)}
                  className="p-1 rounded-lg text-slate-400 hover:text-slate-600 min-w-[32px] min-h-[32px] flex items-center justify-center"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="space-y-3 text-xs text-slate-600 leading-relaxed bg-slate-50 p-3.5 rounded-2xl border border-slate-200/60">
                <div className="flex items-start gap-2.5">
                  <span className="w-5 h-5 rounded-full bg-teal-100 text-teal-800 font-bold flex items-center justify-center shrink-0 text-[11px]">
                    1
                  </span>
                  <p>
                    Touchez le bouton <strong>Partager</strong>{' '}
                    <Share2 className="w-3.5 h-3.5 inline mx-0.5 text-teal-700" /> dans la barre de
                    Safari (en bas de votre écran).
                  </p>
                </div>
                <div className="flex items-start gap-2.5">
                  <span className="w-5 h-5 rounded-full bg-teal-100 text-teal-800 font-bold flex items-center justify-center shrink-0 text-[11px]">
                    2
                  </span>
                  <p>
                    Faites défiler vers le bas et touchez{' '}
                    <strong>« Sur l'écran d'accueil »</strong>.
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setShowIOSGuide(false)}
                className="w-full py-2.5 rounded-xl bg-teal-700 text-white text-xs font-bold hover:bg-teal-800 min-h-[44px]"
              >
                Compris
              </button>
            </div>
          </div>
        )}
      </>
    );
  }

  return null;
};
