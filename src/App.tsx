import React, { useState, useEffect } from 'react';
import { Calculator } from 'lucide-react';
import { db, initializeDatabase, DEFAULT_SETTINGS } from './db/db';
import { Header } from './components/Header';
import { BottomNav, type NavTabId } from './components/BottomNav';
import { PinLockScreen } from './components/PinLockScreen';
import { CalculatorModal } from './components/CalculatorModal';
import { NotificationToast, type ToastMessage } from './components/NotificationToast';
import { ConfirmModal } from './components/ConfirmModal';

import { DashboardView } from './modules/dashboard/DashboardView';
import { DailyEntryView } from './modules/daily/DailyEntryView';
import { EmployeesView } from './modules/employees/EmployeesView';
import { EmployeeEarningsView } from './modules/employees/EmployeeEarningsView';
import { ExpensesView } from './modules/expenses/ExpensesView';
import { ReserveView } from './modules/expenses/ReserveView';
import { OwnerProfitView } from './modules/dashboard/OwnerProfitView';
import { SettingsView } from './modules/settings/SettingsView';

import type { AppSettings } from './types';

export default function App() {
  const [isDbReady, setIsDbReady] = useState(false);
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [activeTab, setActiveTab] = useState<NavTabId>('dashboard');
  const [isReserveOpen, setIsReserveOpen] = useState(false);
  const [isEarningsOpen, setIsEarningsOpen] = useState(false);
  const [isOwnerProfitOpen, setIsOwnerProfitOpen] = useState(false);

  // Security / PIN state
  const [isLocked, setIsLocked] = useState(false);
  const [isResetPinModalOpen, setIsResetPinModalOpen] = useState(false);

  // Calculator floating modal state
  const [isCalculatorOpen, setIsCalculatorOpen] = useState(false);

  // Toast notifications state
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  useEffect(() => {
    initApp();
  }, []);

  const resetSubViews = () => {
    setIsReserveOpen(false);
    setIsEarningsOpen(false);
    setIsOwnerProfitOpen(false);
  };

  const initApp = async () => {
    try {
      await initializeDatabase();
      const currentSettings = await db.settings.get('app_settings');
      if (currentSettings) {
        setSettings(currentSettings);
        if (currentSettings.pinCode) {
          setIsLocked(true);
        }
      }
      setIsDbReady(true);
    } catch (e) {
      console.error('Erreur démarrage app:', e);
      setIsDbReady(true);
    }
  };

  const showToast = (type: 'success' | 'error' | 'info', message: string, title?: string) => {
    const id = Date.now().toString() + Math.random().toString();
    const newToast: ToastMessage = { id, type, message, title };
    setToasts((prev) => [...prev, newToast]);

    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 3500);
  };

  const dismissToast = (id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  };

  const handleSettingsUpdated = (newSettings: AppSettings) => {
    setSettings(newSettings);
  };

  const handleResetPinConfirm = async () => {
    const updated = { ...settings, pinCode: '' };
    await db.settings.put(updated);
    setSettings(updated);
    setIsLocked(false);
    setIsResetPinModalOpen(false);
    showToast('info', 'Code PIN réinitialisé et désactivé avec succès.');
  };

  if (!isDbReady) {
    return (
      <div className="min-h-screen bg-slate-900 text-white flex flex-col items-center justify-center p-6 text-center">
        <div className="w-12 h-12 rounded-2xl bg-teal-500/20 text-teal-400 flex items-center justify-center animate-pulse mb-3 font-bold text-xl">
          Y
        </div>
        <h2 className="text-lg font-bold">Yaourt Gestion</h2>
        <p className="text-xs text-slate-400 mt-1">Chargement de la base de données locale...</p>
      </div>
    );
  }

  // If locked with PIN
  if (isLocked && settings.pinCode) {
    return (
      <>
        <PinLockScreen
          correctPin={settings.pinCode}
          onUnlocked={() => setIsLocked(false)}
          onResetPinRequest={() => setIsResetPinModalOpen(true)}
        />

        <ConfirmModal
          isOpen={isResetPinModalOpen}
          title="Réinitialiser le code PIN ?"
          message="Si vous avez oublié votre code PIN, vous pouvez le désactiver pour retrouver l'accès complet à vos données."
          confirmLabel="Désactiver le PIN"
          cancelLabel="Annuler"
          isDanger={true}
          onConfirm={handleResetPinConfirm}
          onCancel={() => setIsResetPinModalOpen(false)}
        />
      </>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col font-sans">
      {/* Toast Manager */}
      <NotificationToast toasts={toasts} onDismiss={dismissToast} />

      {/* Top App Bar */}
      <Header
        businessName={settings.businessName}
        hasPin={Boolean(settings.pinCode)}
        onLockNow={() => setIsLocked(true)}
        openCalculator={() => setIsCalculatorOpen(true)}
      />

      {/* Main Content Area */}
      <main className="flex-1 w-full max-w-lg mx-auto">
        {isReserveOpen ? (
          <ReserveView
            settings={settings}
            onShowToast={showToast}
            onBack={() => setIsReserveOpen(false)}
          />
        ) : isEarningsOpen ? (
          <EmployeeEarningsView
            settings={settings}
            onShowToast={showToast}
            onBack={() => setIsEarningsOpen(false)}
          />
        ) : isOwnerProfitOpen ? (
          <OwnerProfitView
            settings={settings}
            onBack={() => setIsOwnerProfitOpen(false)}
            onOpenReserve={() => {
              resetSubViews();
              setIsReserveOpen(true);
            }}
          />
        ) : (
          <>
            {activeTab === 'dashboard' && (
              <DashboardView
                settings={settings}
                onNavigateToTab={(tab) => {
                  resetSubViews();
                  setActiveTab(tab);
                }}
                onOpenReserve={() => {
                  resetSubViews();
                  setIsReserveOpen(true);
                }}
                onOpenEarnings={() => {
                  resetSubViews();
                  setIsEarningsOpen(true);
                }}
                onOpenOwnerProfit={() => {
                  resetSubViews();
                  setIsOwnerProfitOpen(true);
                }}
                onShowToast={showToast}
              />
            )}

            {activeTab === 'daily' && (
              <DailyEntryView
                settings={settings}
                onShowToast={showToast}
                onOpenCalculator={() => setIsCalculatorOpen(true)}
              />
            )}

            {activeTab === 'employees' && (
              <EmployeesView
                settings={settings}
                onOpenEarnings={() => {
                  resetSubViews();
                  setIsEarningsOpen(true);
                }}
                onShowToast={showToast}
              />
            )}

            {activeTab === 'expenses' && (
              <ExpensesView
                settings={settings}
                onShowToast={showToast}
                onOpenCalculator={() => setIsCalculatorOpen(true)}
                onOpenReserve={() => {
                  resetSubViews();
                  setIsReserveOpen(true);
                }}
              />
            )}

            {activeTab === 'settings' && (
              <SettingsView
                settings={settings}
                onSettingsUpdated={handleSettingsUpdated}
                onShowToast={showToast}
              />
            )}
          </>
        )}
      </main>

      {/* Floating Calculator Button (always accessible above bottom bar) */}
      <button
        type="button"
        onClick={() => setIsCalculatorOpen(true)}
        aria-label="Ouvrir la calculatrice FC"
        title="Calculatrice FC"
        className="fixed right-4 bottom-20 z-40 w-13 h-13 rounded-2xl bg-teal-700 hover:bg-teal-800 active:scale-90 text-white shadow-lg shadow-teal-900/25 flex items-center justify-center transition-all min-h-[48px] min-w-[48px]"
      >
        <Calculator className="w-6 h-6 stroke-[2]" />
      </button>

      {/* Calculator Modal */}
      <CalculatorModal
        isOpen={isCalculatorOpen}
        onClose={() => setIsCalculatorOpen(false)}
      />

      {/* Bottom Navigation */}
      <BottomNav
        activeTab={activeTab}
        onTabChange={(tab) => {
          resetSubViews();
          setActiveTab(tab);
        }}
      />
    </div>
  );
}
