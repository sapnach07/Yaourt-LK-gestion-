import React, { useState } from 'react';
import { KeyRound, Copy, Check, AlertTriangle } from 'lucide-react';

interface RecoveryCodeModalProps {
  code: string | null;
  onConfirmNoted: () => void;
}

export const RecoveryCodeModal: React.FC<RecoveryCodeModalProps> = ({
  code,
  onConfirmNoted,
}) => {
  const [copied, setCopied] = useState(false);

  if (!code) return null;

  const group1 = code.slice(0, 4);
  const group2 = code.slice(4, 8);
  const group3 = code.slice(8, 12);

  const handleCopy = async () => {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(code);
      } else {
        const textarea = document.createElement('textarea');
        textarea.value = code;
        textarea.setAttribute('readonly', 'true');
        textarea.className = 'fixed -left-[9999px]';
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="recovery-code-modal-title"
      className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-slate-900/75 backdrop-blur-xs animate-in fade-in"
    >
      <div className="w-full max-w-sm bg-white rounded-3xl p-5 shadow-2xl border border-slate-200 space-y-4">
        <div className="flex items-start gap-3">
          <div className="w-11 h-11 rounded-2xl bg-amber-100 text-amber-800 flex items-center justify-center shrink-0">
            <KeyRound className="w-5 h-5" />
          </div>
          <div>
            <h3
              id="recovery-code-modal-title"
              className="text-base font-extrabold text-slate-900 leading-snug"
            >
              Notez votre code de récupération
            </h3>
            <p className="mt-1 text-xs text-slate-600 leading-relaxed">
              Ce code de 12 caractères est affiché <strong>une seule fois</strong>. Conservez-le
              dans un endroit sûr : il sera obligatoire pour créer un nouveau PIN en cas d’oubli.
            </p>
          </div>
        </div>

        <div className="p-4 rounded-2xl bg-slate-900 text-white text-center space-y-1.5 border border-slate-800">
          <span className="text-[10px] uppercase tracking-widest text-teal-300 font-bold block">
            Code unique (12 caractères)
          </span>
          <div className="font-mono text-xl font-extrabold tracking-widest select-all flex items-center justify-center gap-2.5 py-1">
            <span>{group1}</span>
            <span className="text-slate-500">·</span>
            <span>{group2}</span>
            <span className="text-slate-500">·</span>
            <span>{group3}</span>
          </div>
        </div>

        <div className="p-3 rounded-2xl bg-amber-50 border border-amber-200/80 flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
          <p className="text-[11px] text-amber-900 font-medium leading-snug">
            Par sécurité, l’application ne stocke jamais ce code en clair et ne l’inclut pas dans
            les sauvegardes JSON.
          </p>
        </div>

        <div className="space-y-2 pt-1">
          <button
            type="button"
            onClick={handleCopy}
            className="w-full py-2.5 px-4 rounded-xl border border-slate-300 bg-slate-50 hover:bg-slate-100 text-slate-800 text-xs font-bold flex items-center justify-center gap-2 transition-colors min-h-[44px]"
          >
            {copied ? (
              <>
                <Check className="w-4 h-4 text-emerald-600" />
                <span className="text-emerald-700">Code copié !</span>
              </>
            ) : (
              <>
                <Copy className="w-4 h-4 text-slate-600" />
                <span>Copier</span>
              </>
            )}
          </button>

          <button
            type="button"
            onClick={onConfirmNoted}
            className="w-full py-3 px-4 rounded-xl bg-teal-700 hover:bg-teal-800 active:scale-[0.99] text-white text-xs font-extrabold shadow-xs transition-all min-h-[46px]"
          >
            J'ai noté ce code
          </button>
        </div>
      </div>
    </div>
  );
};
