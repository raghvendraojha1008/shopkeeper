import React from 'react';
import { LayoutDashboard, Package, Mic, Users, Settings } from 'lucide-react';

interface AppLayoutProps {
  children: React.ReactNode;
  activeTab: string;
  onTabChange: (tab: string) => void;
  onCommandOpen: () => void;
}

const NAV_ITEMS = [
  { id: 'dashboard', Icon: LayoutDashboard, label: 'Home' },
  { id: 'inventory', Icon: Package, label: 'Stock' },
  { id: '__mic__', Icon: Mic, label: '' },
  { id: 'parties', Icon: Users, label: 'Parties' },
  { id: 'settings', Icon: Settings, label: 'More' },
] as const;

const AppLayout: React.FC<AppLayoutProps> = ({
  children,
  activeTab,
  onTabChange,
  onCommandOpen,
}) => {
  return (
    <div
      className="h-screen w-full font-sans overflow-hidden flex flex-col pt-safe"
      style={{ background: 'var(--app-bg)', color: 'var(--text-primary)', maxWidth: '100vw', overflowX: 'hidden' }}
    >
      <main className="flex-1 overflow-y-auto overflow-x-hidden relative" style={{ WebkitOverflowScrolling: 'touch' }}>
        {children}
      </main>

      {/* Bottom Navigation */}
      <nav
        className="app-bottom-nav fixed bottom-0 left-0 right-0 z-50 safe-area-pb"
        style={{
          background:       'var(--nav-bg)',
          backdropFilter:   'blur(12px)',
          WebkitBackdropFilter: 'blur(12px)',
          borderTop:        'var(--nav-border-top)',
          boxShadow:        'var(--nav-shadow)',
        }}
      >
        <div className="flex justify-around items-end px-2 pt-2 pb-3">
          {NAV_ITEMS.map(({ id, Icon, label }) => {
            if (id === '__mic__') {
              return (
                <button key="mic" onClick={onCommandOpen}
                  className="relative flex flex-col items-center -mt-7"
                  style={{ minWidth: 56 }}>
                  {/* Glow ring */}
                  <div
                    className="absolute -inset-1 rounded-full opacity-60"
                    style={{ background: 'radial-gradient(circle, var(--col-warning-50), transparent 70%)' }}
                  />
                  <div
                    className="relative w-[56px] h-[56px] rounded-full flex items-center justify-center active:scale-90 transition-all"
                    style={{
                      background: 'var(--nav-ai-btn-bg)',
                      boxShadow:  'var(--nav-ai-btn-shadow)',
                    }}
                  >
                    <Icon size={24} color="white" strokeWidth={2} />
                  </div>
                </button>
              );
            }

            const isActive = activeTab === id;
            return (
              <button
                key={id}
                onClick={() => onTabChange(id)}
                className="flex flex-col items-center gap-1 transition-all active:scale-90"
                style={{ minWidth: 48, paddingBottom: 2 }}
              >
                <div
                  className="relative p-1.5 rounded-2xl transition-all"
                  style={isActive ? { background: 'var(--nav-active-pill)' } : {}}
                >
                  <Icon
                    size={21}
                    style={{
                      color:       isActive ? 'var(--nav-active-color)' : 'var(--nav-icon-inactive)',
                      strokeWidth: isActive ? 2.5 : 1.8,
                    }}
                  />
                  {isActive && (
                    <span
                      className="absolute -bottom-0.5 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full"
                      style={{ background: 'var(--nav-active-color)' }}
                    />
                  )}
                </div>
                <span
                  className="text-app-xs font-black uppercase tracking-wide"
                  style={{
                    color:         isActive ? 'var(--nav-active-color)' : 'var(--nav-label-inactive)',
                    letterSpacing: '0.06em',
                  }}
                >
                  {label}
                </span>
              </button>
            );
          })}
        </div>
      </nav>
    </div>
  );
};

export default AppLayout;
