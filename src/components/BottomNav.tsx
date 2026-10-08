import React from 'react';
import {
  LayoutDashboard,
  ClipboardEdit,
  Users,
  WalletCards,
  Settings2,
} from 'lucide-react';

export type NavTabId = 'dashboard' | 'daily' | 'employees' | 'expenses' | 'settings';

interface BottomNavProps {
  activeTab: NavTabId;
  onTabChange: (tab: NavTabId) => void;
}

export const BottomNav: React.FC<BottomNavProps> = ({ activeTab, onTabChange }) => {
  const tabs = [
    { id: 'dashboard' as const, label: 'Tableau', icon: LayoutDashboard },
    { id: 'daily' as const, label: 'Saisies', icon: ClipboardEdit },
    { id: 'employees' as const, label: 'Employées', icon: Users },
    { id: 'expenses' as const, label: 'Dépenses', icon: WalletCards },
    { id: 'settings' as const, label: 'Plus', icon: Settings2 },
  ];

  return (
    <nav
      aria-label="Navigation principale"
      className="fixed bottom-0 left-0 right-0 z-40 bg-white/95 backdrop-blur-md border-t border-slate-200/80 pb-[env(safe-area-inset-bottom)]"
    >
      <div className="grid grid-cols-5 items-center h-16 max-w-lg mx-auto">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => onTabChange(tab.id)}
              className={`flex flex-col items-center justify-center h-full min-h-[44px] transition-colors relative active:scale-95 ${
                isActive ? 'text-teal-700' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <div className="relative">
                <Icon className={`w-5 h-5 ${isActive ? 'stroke-[2.5]' : 'stroke-[1.8]'}`} />
                {isActive && (
                  <span className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-1 h-1 bg-teal-700 rounded-full" />
                )}
              </div>
              <span
                className={`text-[10px] mt-1 tracking-tight leading-none ${
                  isActive ? 'font-bold' : 'font-medium'
                }`}
              >
                {tab.label}
              </span>
            </button>
          );
        })}
      </div>
    </nav>
  );
};
