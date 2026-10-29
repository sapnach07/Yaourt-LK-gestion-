import React, { useState, useEffect } from 'react';
import { Calculator } from 'lucide-react';
import { liveQuery } from 'dexie';
import { db, initializeDatabase, DEFAULT_SETTINGS } from './db/db';
import { Header } from './components/Header';
import { BottomNav, type NavTabId } from './components/BottomNav';
import { PinLockScreen } from './components/PinLockScreen';
import { CalculatorModal } from './components/CalculatorModal';
import { NotificationToast, type ToastMessage } from './components/NotificationToast';
import { RecoveryCodeModal } from './components/RecoveryCodeModal';

import { DashboardView } from './modules/dashboard/DashboardView';
import { DailyEntryView } from './modules/daily/DailyEntryView';
import { DebtsView } from './modules/daily/DebtsView';
import { EmployeesView } from './modules/employees/EmployeesView';
import { EmployeeEarningsView } from './modules/employees/EmployeeEarningsView';
import { ExpensesView } from './modules/expenses/ExpensesView';
import { ReserveView } from './modules/expenses/ReserveView';
import { OwnerProfitView } from './modules/dashboard/OwnerProfitView';
import { SettingsView } from './modules/settings/SettingsView';
import {
  IngredientStockView,
  type StockSubTab,
} from './modules/ingredients/IngredientStockView';
import { TrashHistoryView } from './modules/trash/TrashHistoryView';

import type { AppSettings } from './types';

export default function App() {
  const [isDbReady, setIsDbReady] = useState(false);
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [activeTab, setActiveTab] = useState<NavTabId>('dashboard');
  const [isReserveOpen, setIsReserveOpen] = useState(false);
  const [isEarningsOpen, setIsEarningsOpen] = useState(false);
  const [isOwnerProfitOpen, setIsOwnerProfitOpen] = useState(false);
  const [isDebtsOpen, setIsDebtsOpen] = useState(false);
  const [isIngredientStockOpen, setIsIngredientStockOpen] = useState(false);
  const [isTrashHistoryOpen, setIsTrashHistoryOpen] = useState(false);
  const [ingredientStockInitialTab, setIngredientStockInitialTab] = useState<StockSubTab>('stock');
  const [debtsInitialCustomerId, setDebtsInitialCustomerId] = useState<string | null>(null);
  const [reservePrefill, setReservePrefill] = useState<{ amount: number; reason: string; source?: 'personnel' | 'benefices' } | null>(null);
  const [dailyStatusFilter, setDailyStatusFilter] = useState<'all' | 'incomplete' | 'validated'>('all');
  const [dailySubTab, setDailySubTab] = useState<'sales' | 'production' | 'personal'>('sales');

  // Security / PIN state
  const [isLocked, setIsLocked] = useState(false);
  const [pendingRecoveryCode, setPendingRecoveryCode] = useState<string | null>(null);

  // Calculator floating modal state
  const [isCalculatorOpen, setIsCalculatorOpen] = useState(false);

  // Toast notifications state
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  useEffect(() => {
    initApp();
  }, []);

  useEffect(() => {
    if (!isDbReady) return;
    const sub = liveQuery(() => db.settings.get('app_settings')).subscribe({
      next: (latest) => {
        if (latest) {
          setSettings(latest);
        }
      },
    });
    return () => sub.unsubscribe();
  }, [isDbReady]);

  const resetSubViews = () => {
    setIsReserveOpen(false);
    setIsEarningsOpen(false);
    setIsOwnerProfitOpen(false);
    setIsDebtsOpen(false);
    setIsIngredientStockOpen(false);
    setIsTrashHistoryOpen(false);
    setDebtsInitialCustomerId(null);
    setReservePrefill(null);
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

  if (!isDbReady) {
    return (
      <div className="min-h-screen bg-slate-900 text-white flex flex-col items-center justify-center p-6 text-center">
        {settings.appLogoBase64 ? (
          <div className="w-14 h-14 rounded-2xl bg-white/10 p-2 border border-white/20 mb-3 shadow-md flex items-center justify-center overflow-hidden">
            <img src={settings.appLogoBase64} alt="Logo" className="w-full h-full object-contain" />
          </div>
        ) : (
          <div className="w-14 h-14 rounded-2xl bg-white/10 p-1.5 border border-white/20 mb-3 shadow-md flex items-center justify-center overflow-hidden">
            <img src="/pwa-192x192.png" alt="Logo" className="w-full h-full object-contain" />
          </div>
        )}
        <h2 className="text-lg font-bold">{settings.businessName || 'Yaourt Gestion'}</h2>
        <p className="text-xs text-slate-400 mt-1">Chargement de la base de données locale...</p>
      </div>
    );
  }

  // If locked with PIN
  if (isLocked && settings.pinCode) {
    return (
      <PinLockScreen
        settings={settings}
        onSettingsUpdated={handleSettingsUpdated}
        onUnlocked={(oneTimeRecoveryCode) => {
          setIsLocked(false);
          if (oneTimeRecoveryCode) {
            setPendingRecoveryCode(oneTimeRecoveryCode);
          }
        }}
        businessName={settings.businessName}
        logoBase64={settings.appLogoBase64}
      />
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col font-sans">
      {/* Toast Manager */}
      <NotificationToast toasts={toasts} onDismiss={dismissToast} />

      {/* One-time Recovery Code Modal (after legacy PIN migration or forgot-PIN recovery) */}
      <RecoveryCodeModal
        code={pendingRecoveryCode}
        onConfirmNoted={() => setPendingRecoveryCode(null)}
      />

      {/* Top App Bar */}
      <Header
        businessName={settings.businessName}
        hasPin={Boolean(settings.pinCode)}
        onLockNow={() => setIsLocked(true)}
        openCalculator={() => setIsCalculatorOpen(true)}
        logoBase64={settings.appLogoBase64}
      />

      {/* Main Content Area */}
      <main className="flex-1 w-full max-w-lg mx-auto">
        {isReserveOpen ? (
          <ReserveView
            settings={settings}
            onSettingsUpdated={handleSettingsUpdated}
            onShowToast={showToast}
            onBack={() => setIsReserveOpen(false)}
            initialPrefill={reservePrefill}
            onClearPrefill={() => setReservePrefill(null)}
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
        ) : isDebtsOpen ? (
          <DebtsView
            settings={settings}
            onShowToast={showToast}
            initialCustomerId={debtsInitialCustomerId}
            onBack={() => {
              setIsDebtsOpen(false);
              setDebtsInitialCustomerId(null);
            }}
          />
        ) : isIngredientStockOpen ? (
          <IngredientStockView
            settings={settings}
            initialTab={ingredientStockInitialTab}
            onShowToast={showToast}
            onBack={() => setIsIngredientStockOpen(false)}
          />
        ) : isTrashHistoryOpen ? (
          <TrashHistoryView
            settings={settings}
            onShowToast={showToast}
            onBack={() => setIsTrashHistoryOpen(false)}
          />
        ) : (
          <>
            {activeTab === 'dashboard' && (
              <DashboardView
                settings={settings}
                onSettingsUpdated={handleSettingsUpdated}
                onNavigateToTab={(tab, statusFilter) => {
                  resetSubViews();
                  if (tab === 'daily' && statusFilter) {
                    setDailyStatusFilter(statusFilter);
                    setDailySubTab('sales');
                  } else if (tab === 'daily') {
                    setDailyStatusFilter('all');
                  }
                  setActiveTab(tab);
                }}
                onOpenReserve={(prefill) => {
                  resetSubViews();
                  if (prefill) setReservePrefill(prefill);
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
                onOpenDebts={() => {
                  resetSubViews();
                  setIsDebtsOpen(true);
                }}
                onOpenIngredientStock={(tab) => {
                  resetSubViews();
                  setIngredientStockInitialTab(tab || 'stock');
                  setIsIngredientStockOpen(true);
                }}
                onShowToast={showToast}
              />
            )}

            {activeTab === 'daily' && (
              <DailyEntryView
                settings={settings}
                onSettingsUpdated={handleSettingsUpdated}
                onShowToast={showToast}
                onOpenCalculator={() => setIsCalculatorOpen(true)}
                initialStatusFilter={dailyStatusFilter}
                initialSubTab={dailySubTab}
                onOpenDebts={(customerId) => {
                  setDailySubTab('personal');
                  setDebtsInitialCustomerId(customerId || null);
                  setIsDebtsOpen(true);
                }}
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
                onSettingsUpdated={handleSettingsUpdated}
                onShowToast={showToast}
                onOpenCalculator={() => setIsCalculatorOpen(true)}
                onOpenReserve={(prefill) => {
                  resetSubViews();
                  if (prefill) setReservePrefill(prefill);
                  setIsReserveOpen(true);
                }}
              />
            )}

            {activeTab === 'settings' && (
              <SettingsView
                settings={settings}
                onSettingsUpdated={handleSettingsUpdated}
                onShowToast={showToast}
                onOpenIngredientStock={() => {
                  resetSubViews();
                  setIngredientStockInitialTab('stock');
                  setIsIngredientStockOpen(true);
                }}
                onOpenTrashHistory={() => {
                  resetSubViews();
                  setIsTrashHistoryOpen(true);
                }}
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
