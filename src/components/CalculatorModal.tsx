import React, { useState } from 'react';
import { Calculator, X, History, Copy, Check, Trash2 } from 'lucide-react';
import { formatFC } from '../utils/formatters';

interface CalcHistoryItem {
  id: string;
  expression: string;
  result: number;
}

interface CalculatorModalProps {
  isOpen: boolean;
  onClose: () => void;
  onApplyResult?: (value: number) => void;
}

export const CalculatorModal: React.FC<CalculatorModalProps> = ({
  isOpen,
  onClose,
  onApplyResult,
}) => {
  const [display, setDisplay] = useState('0');
  const [expression, setExpression] = useState('');
  const [history, setHistory] = useState<CalcHistoryItem[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [copied, setCopied] = useState(false);

  if (!isOpen) return null;

  const handleNumber = (digit: string) => {
    if (display === '0' || display === 'Erreur') {
      setDisplay(digit);
    } else {
      setDisplay(display + digit);
    }
  };

  const handleDecimal = () => {
    if (!display.includes('.')) {
      setDisplay(display + '.');
    }
  };

  const handleOperator = (op: string) => {
    if (display === 'Erreur') return;
    setExpression(`${display} ${op} `);
    setDisplay('0');
  };

  const handleClear = () => {
    setDisplay('0');
    setExpression('');
  };

  const handleBackspace = () => {
    if (display.length <= 1 || display === 'Erreur') {
      setDisplay('0');
    } else {
      setDisplay(display.slice(0, -1));
    }
  };

  const handlePercent = () => {
    const val = parseFloat(display);
    if (!isNaN(val)) {
      setDisplay((val / 100).toString());
    }
  };

  const handleEquals = () => {
    if (!expression) return;
    const parts = expression.trim().split(' ');
    if (parts.length < 2) return;

    const num1 = parseFloat(parts[0]);
    const op = parts[1];
    const num2 = parseFloat(display);

    if (isNaN(num1) || isNaN(num2)) return;

    let res = 0;
    if (op === '+') res = num1 + num2;
    else if (op === '-') res = num1 - num2;
    else if (op === '×' || op === '*') res = num1 * num2;
    else if (op === '÷' || op === '/') {
      if (num2 === 0) {
        setDisplay('Erreur');
        setExpression('');
        return;
      }
      res = num1 / num2;
    }

    const roundedRes = Math.round(res * 100) / 100;
    const finalExpression = `${expression}${display}`;
    setDisplay(roundedRes.toString());
    setExpression('');

    setHistory((prev) => [
      { id: Date.now().toString(), expression: finalExpression, result: roundedRes },
      ...prev.slice(0, 9),
    ]);
  };

  const currentNumericValue = parseFloat(display) || 0;

  const handleCopy = async () => {
    try {
      if (navigator.clipboard) {
        await navigator.clipboard.writeText(display);
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleUseResult = () => {
    if (onApplyResult && !isNaN(currentNumericValue)) {
      onApplyResult(currentNumericValue);
      onClose();
    } else {
      handleCopy();
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-200"
    >
      <div className="w-full sm:max-w-sm bg-white rounded-t-3xl sm:rounded-3xl shadow-2xl border border-slate-100 flex flex-col overflow-hidden max-h-[92vh]">
        {/* Top Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-100 bg-slate-50/70">
          <div className="flex items-center gap-2 text-slate-800">
            <Calculator className="w-5 h-5 text-teal-600" />
            <h2 className="text-sm font-bold">Calculatrice FC</h2>
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setShowHistory(!showHistory)}
              className={`p-2 rounded-xl transition-colors min-w-[40px] min-h-[40px] flex items-center justify-center ${
                showHistory ? 'bg-teal-100 text-teal-800' : 'text-slate-500 hover:bg-slate-200/60'
              }`}
              title="Historique"
            >
              <History className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={onClose}
              className="p-2 rounded-xl text-slate-400 hover:text-slate-600 hover:bg-slate-200/60 min-w-[40px] min-h-[40px] flex items-center justify-center"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* History Panel or Screen */}
        {showHistory ? (
          <div className="p-4 bg-slate-50 flex-1 overflow-y-auto max-h-56 min-h-[220px]">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
                Derniers calculs
              </span>
              {history.length > 0 && (
                <button
                  type="button"
                  onClick={() => setHistory([])}
                  className="text-xs text-rose-600 hover:text-rose-700 flex items-center gap-1"
                >
                  <Trash2 className="w-3 h-3" />
                  Effacer
                </button>
              )}
            </div>
            {history.length === 0 ? (
              <p className="text-xs text-slate-400 py-6 text-center">Aucun calcul récent</p>
            ) : (
              <div className="space-y-2">
                {history.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      setDisplay(item.result.toString());
                      setShowHistory(false);
                    }}
                    className="w-full text-left p-2.5 rounded-xl bg-white border border-slate-200/70 hover:border-teal-400 transition-all flex items-center justify-between"
                  >
                    <span className="text-xs text-slate-500 font-mono">{item.expression} =</span>
                    <span className="text-sm font-bold text-slate-800 font-mono">
                      {formatFC(item.result)}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="p-5 bg-slate-900 text-white flex flex-col justify-end text-right min-h-[110px]">
            <div className="text-xs font-mono text-slate-400 h-5 truncate tracking-wider">
              {expression || ' '}
            </div>
            <div className="text-3xl font-bold font-mono tracking-tight text-teal-300 truncate mt-1">
              {display}
            </div>
            <div className="text-xs font-medium text-slate-400 mt-1">
              ≈ {formatFC(currentNumericValue)}
            </div>
          </div>
        )}

        {/* Quick actions row */}
        <div className="px-4 py-2 bg-slate-100/70 border-b border-slate-200/50 flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={handleCopy}
            className="flex-1 py-2 px-3 rounded-xl bg-white border border-slate-200 text-xs font-semibold text-slate-700 hover:bg-slate-50 flex items-center justify-center gap-1.5 transition-all min-h-[38px]"
          >
            {copied ? (
              <>
                <Check className="w-3.5 h-3.5 text-emerald-600" />
                <span className="text-emerald-700">Copié !</span>
              </>
            ) : (
              <>
                <Copy className="w-3.5 h-3.5 text-slate-500" />
                <span>Copier</span>
              </>
            )}
          </button>
          {onApplyResult && (
            <button
              type="button"
              onClick={handleUseResult}
              className="flex-1 py-2 px-3 rounded-xl bg-teal-700 hover:bg-teal-800 text-xs font-semibold text-white shadow-xs flex items-center justify-center gap-1.5 transition-all min-h-[38px]"
            >
              <span>Utiliser le résultat</span>
            </button>
          )}
        </div>

        {/* Tactile Keypad */}
        <div className="p-3 bg-white grid grid-cols-4 gap-2">
          <button
            type="button"
            onClick={handleClear}
            className="h-13 rounded-2xl bg-rose-50 text-rose-700 hover:bg-rose-100 font-bold text-base active:scale-95 transition-all min-h-[48px]"
          >
            C
          </button>
          <button
            type="button"
            onClick={handleBackspace}
            className="h-13 rounded-2xl bg-slate-100 text-slate-700 hover:bg-slate-200 font-bold text-base active:scale-95 transition-all min-h-[48px]"
          >
            ⌫
          </button>
          <button
            type="button"
            onClick={handlePercent}
            className="h-13 rounded-2xl bg-slate-100 text-slate-700 hover:bg-slate-200 font-bold text-base active:scale-95 transition-all min-h-[48px]"
          >
            %
          </button>
          <button
            type="button"
            onClick={() => handleOperator('÷')}
            className="h-13 rounded-2xl bg-teal-50 text-teal-700 hover:bg-teal-100 font-bold text-xl active:scale-95 transition-all min-h-[48px]"
          >
            ÷
          </button>

          {['7', '8', '9'].map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => handleNumber(n)}
              className="h-13 rounded-2xl bg-slate-50 hover:bg-slate-100 text-slate-900 font-bold text-xl active:scale-95 border border-slate-200/40 transition-all min-h-[48px]"
            >
              {n}
            </button>
          ))}
          <button
            type="button"
            onClick={() => handleOperator('×')}
            className="h-13 rounded-2xl bg-teal-50 text-teal-700 hover:bg-teal-100 font-bold text-xl active:scale-95 transition-all min-h-[48px]"
          >
            ×
          </button>

          {['4', '5', '6'].map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => handleNumber(n)}
              className="h-13 rounded-2xl bg-slate-50 hover:bg-slate-100 text-slate-900 font-bold text-xl active:scale-95 border border-slate-200/40 transition-all min-h-[48px]"
            >
              {n}
            </button>
          ))}
          <button
            type="button"
            onClick={() => handleOperator('-')}
            className="h-13 rounded-2xl bg-teal-50 text-teal-700 hover:bg-teal-100 font-bold text-xl active:scale-95 transition-all min-h-[48px]"
          >
            -
          </button>

          {['1', '2', '3'].map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => handleNumber(n)}
              className="h-13 rounded-2xl bg-slate-50 hover:bg-slate-100 text-slate-900 font-bold text-xl active:scale-95 border border-slate-200/40 transition-all min-h-[48px]"
            >
              {n}
            </button>
          ))}
          <button
            type="button"
            onClick={() => handleOperator('+')}
            className="h-13 rounded-2xl bg-teal-50 text-teal-700 hover:bg-teal-100 font-bold text-xl active:scale-95 transition-all min-h-[48px]"
          >
            +
          </button>

          <button
            type="button"
            onClick={() => handleNumber('0')}
            className="h-13 col-span-2 rounded-2xl bg-slate-50 hover:bg-slate-100 text-slate-900 font-bold text-xl active:scale-95 border border-slate-200/40 transition-all min-h-[48px]"
          >
            0
          </button>
          <button
            type="button"
            onClick={handleDecimal}
            className="h-13 rounded-2xl bg-slate-50 hover:bg-slate-100 text-slate-900 font-bold text-xl active:scale-95 border border-slate-200/40 transition-all min-h-[48px]"
          >
            ,
          </button>
          <button
            type="button"
            onClick={handleEquals}
            className="h-13 rounded-2xl bg-teal-700 hover:bg-teal-800 text-white font-bold text-xl active:scale-95 shadow-sm transition-all min-h-[48px]"
          >
            =
          </button>
        </div>
      </div>
    </div>
  );
};
