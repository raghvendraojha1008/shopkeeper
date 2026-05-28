import React from 'react';
import { LayoutDashboard, Package, Mic, Users, Settings } from 'lucide-react';

interface AppLayoutProps {
  children: React.ReactNode;
  activeTab: string;
  onTabChange: (tab: string) => void;
  onCommandOpen: () => void;
}

const AppLayout: React.FC<AppLayoutProps> = ({
  children,
  activeTab,
  onTabChange,
  onCommandOpen,
}) => {
  const navItems = [
    { id: 'dashboard', Icon: LayoutDashboard, label: 'Home' },
    { id: 'inventory', Icon: Package, label: 'Stock' },
    { id: '__mic__', Icon: Mic, label: '' },
    { id: 'parties', Icon: Users, label: 'Parties' },
    { id: 'settings', Icon: Settings, label: 'More' },
  ];

  return (
    <div className="h-screen w-full text-[rgba(240,244,255,0.93)] text-[rgba(240,244,255,0.9)] font-sans overflow-hidden flex flex-col pt-safe"
      style={{ background: 'var(--app-bg)', maxWidth: '100vw', overflowX: 'hidden' }}>
      <main className="flex-1 overflow-y-auto overflow-x-hidden relative" style={{WebkitOverflowScrolling:'touch'}}>
        {children}
      </main>

      {/* Bottom Navigation — Glass morphism */}
      <nav className="fixed bottom-0 left-0 right-0 z-50 safe-area-pb"
        style={{
          background: 'rgba(var(--app-bg-rgb),0.92)',
          backdropFilter: 'blur(8px)',
          WebkitBackdropFilter: 'blur(8px)',
          borderTop: '1px solid rgba(255,255,255,0.08)',
          boxShadow: '0 -8px 32px rgba(0,0,0,0.4), 0 -1px 0 rgba(255,255,255,0.06)',
        }}>
        <div className="flex justify-around items-end px-2 pt-2 pb-3">
          {navItems.map(({ id, Icon, label }) => {
            if (id === '__mic__') {
              return (
                <button key="mic" onClick={onCommandOpen}
                  className="relative flex flex-col items-center -mt-7"
                  style={{ minWidth: 56 }}>
                  {/* Glow ring */}
                  <div className="absolute -inset-1 rounded-full opacity-60"
                    style={{ background: 'radial-gradient(circle, rgba(245,158,11,0.5), transparent 70%)' }} />
                  <div className="relative w-[56px] h-[56px] rounded-full flex items-center justify-center active:scale-90 transition-all"
                    style={{
                      background: 'linear-gradient(145deg, #f59e0b, #ef4444)',
                      boxShadow: '0 8px 24px rgba(245,158,11,0.55), 0 2px 8px rgba(0,0,0,0.2), inset 0 1px 0 rgba(255,255,255,0.3)',
                    }}>
                    <Icon size={24} className="text-white" strokeWidth={2} />
                  </div>
                </button>
              );
            }
            const isActive = activeTab === id;
            return (
              <button key={id} onClick={() => onTabChange(id)}
                className="flex flex-col items-center gap-1 transition-all active:scale-90"
                style={{ minWidth: 48, paddingBottom: 2 }}>
                <div className="relative p-1.5 rounded-2xl transition-all"
                  style={isActive ? {
                    background: 'rgba(79,70,229,0.12)',
                  } : {}}>
                  <Icon size={21}
                    style={{ color: isActive ? '#4f46e5' : '#94a3b8', strokeWidth: isActive ? 2.5 : 1.8 }} />
                  {isActive && (
                    <span className="absolute -bottom-0.5 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full"
                      style={{ background: '#4f46e5' }} />
                  )}
                </div>
                <span className="text-[9px] font-black uppercase tracking-wide"
                  style={{ color: isActive ? '#4f46e5' : '#94a3b8', letterSpacing: '0.06em' }}>
                  {label}
                </span>
              </button>
            );
          })}
        </div>
      </nav>

      <style>{`
        [data-theme-mode="dark"] nav {
          background: rgba(12,16,28,0.88) !important;
          border-top: 1px solid rgba(255,255,255,0.06) !important;
        }
        [data-theme-mode="dark"] nav button span[style*="color: #4f46e5"] { color: #818cf8 !important; }
        [data-theme-mode="dark"] nav button div[style*="rgba(79,70,229"] { background: rgba(99,102,241,0.18) !important; }
        [data-theme-mode="dark"] nav button svg[style*="color: #4f46e5"] { color: #818cf8 !important; }
        [data-theme-mode="light"] nav {
          background: rgba(var(--app-bg-rgb),0.94) !important;
          border-top: 1px solid rgba(0,0,0,0.08) !important;
          box-shadow: 0 -4px 16px rgba(0,0,0,0.07) !important;
        }
      `}</style>
    </div>
  );
};

export default AppLayout;








