import React, { useState, useEffect } from 'react';
import { Mic, Cloud, CloudOff } from 'lucide-react';

interface TopNavigationProps {
  activeTab: string;
  setActiveTab: (tab: string) => void;
  openCommandCenter: () => void;
}

const TopNavigation: React.FC<TopNavigationProps> = ({ activeTab, openCommandCenter }) => {
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  useEffect(() => {
    const on = () => setIsOnline(true);
    const off = () => setIsOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); };
  }, []);

  return (
    <div className="sticky top-0 z-50 px-4 pb-2.5 flex justify-between items-center safe-area-top"
      style={{paddingTop: 'max(16px, calc(env(safe-area-inset-top, 0px) + 8px))', 
        background: 'rgba(var(--app-bg-rgb),0.92)',
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
        borderBottom: '1px solid rgba(255,255,255,0.07)',
        boxShadow: '0 1px 16px rgba(0,0,0,0.4)',
      }}>
      {/* Logo */}
      <div className="flex items-center gap-2.5">
        <div className="w-8 h-8 rounded-[12px] flex items-center justify-center font-black text-white text-[15px]"
          style={{ background: 'linear-gradient(145deg, #f59e0b, #ef4444)', boxShadow: '0 3px 10px rgba(245,158,11,0.4)' }}>
          S
        </div>
        <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full"
          style={isOnline
            ? { background: 'rgba(16,185,129,0.1)', border: '1px solid rgba(16,185,129,0.2)' }
            : { background: 'rgba(100,116,139,0.08)', border: '1px solid rgba(100,116,139,0.12)' }}>
          {isOnline
            ? <Cloud size={11} style={{ color: '#10b981' }} />
            : <CloudOff size={11} style={{ color: '#94a3b8' }} />}
          <span className="text-[9px] font-black uppercase tracking-[0.1em]"
            style={{ color: isOnline ? '#059669' : '#94a3b8' }}>
            {isOnline ? 'Live' : 'Offline'}
          </span>
        </div>
      </div>

      <h1 className="absolute left-1/2 -translate-x-1/2 font-black text-[rgba(226,232,240,0.88)] capitalize"
        style={{ fontSize: 15, letterSpacing: '-0.02em' }}>
        {activeTab.replace(/-/g, ' ')}
      </h1>

      <button onClick={openCommandCenter}
        className="active:scale-90 transition-all"
        style={{
          width: 38, height: 38,
          background: 'linear-gradient(145deg, #f59e0b, #ef4444)',
          borderRadius: 14,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          boxShadow: '0 4px 14px rgba(245,158,11,0.4), inset 0 1px 0 rgba(255,255,255,0.25)',
          border: 'none',
        }}>
        <Mic size={17} className="text-white" strokeWidth={2.5} />
      </button>
    </div>
  );
};
export default TopNavigation;







