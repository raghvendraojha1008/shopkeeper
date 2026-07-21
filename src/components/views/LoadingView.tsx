import React from 'react';

const LoadingView: React.FC = () => {
  return (
    <div
      className="fixed inset-0 flex flex-col items-center justify-center"
      style={{ background: 'var(--app-bg)' }}
    >
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            'radial-gradient(ellipse 70% 50% at 30% 20%, var(--col-accent-08) 0%, transparent 70%), radial-gradient(ellipse 50% 40% at 75% 75%, var(--col-warning-06) 0%, transparent 70%)',
        }}
      />

      <div className="relative flex flex-col items-center gap-5">
        <div className="relative">
          <div
            className="absolute -inset-4 rounded-full animate-pulse"
            style={{
              background: 'radial-gradient(circle, var(--col-warning-18), transparent 70%)',
              animationDuration: '2.4s',
            }}
          />
          <div
            className="relative w-[68px] h-[68px] rounded-[22px] flex items-center justify-center font-black text-white select-none"
            style={{
              background: 'linear-gradient(145deg, #f59e0b, #ef4444)',
              boxShadow:
                '0 12px 36px rgba(245,158,11,0.32), inset 0 1px 0 var(--rgba-white-20)',
              fontSize: 30,
            }}
          >
            S
          </div>
        </div>

        <p className="loading-app-label text-app-sm font-black uppercase tracking-[0.28em]">
          ShopLedger
        </p>
      </div>
    </div>
  );
};

export default LoadingView;
