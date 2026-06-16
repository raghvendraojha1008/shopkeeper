import React from 'react';
import { Plus } from 'lucide-react';

interface HeaderProps {
  title: string;
  onAdd: () => void;
  count?: number;
}

const Header: React.FC<HeaderProps> = ({ title, onAdd, count }) => {
  const [isOnline, setIsOnline] = React.useState(navigator.onLine);
  React.useEffect(() => {
    const handleStatusChange = () => setIsOnline(navigator.onLine);
    window.addEventListener('online', handleStatusChange);
    window.addEventListener('offline', handleStatusChange);
    return () => {
      window.removeEventListener('online', handleStatusChange);
      window.removeEventListener('offline', handleStatusChange);
    };
  }, []);
  return (
    <div className="flex justify-between items-center mb-5">
      <div>
        <div className="flex items-center gap-2 mb-1.5">
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full"
            style={isOnline
              ? { background: 'rgba(16,185,129,0.12)', border: '1px solid rgba(16,185,129,0.25)' }
              : { background: 'rgba(100,116,139,0.1)', border: '1px solid rgba(100,116,139,0.2)' }}>
            <div className={`w-1.5 h-1.5 rounded-full ${isOnline ? 'animate-pulse' : ''}`}
              style={{ background: isOnline ? '#34d399' : '#64748b' }} />
            <span className="text-[9px] font-black uppercase tracking-[0.12em]"
              style={{ color: isOnline ? '#34d399' : 'rgba(148,163,184,0.6)' }}>
              {isOnline ? 'Live' : 'Offline'}
            </span>
          </div>
          {count !== undefined && (
            <span className="text-[10px] font-bold" style={{color:'rgba(148,163,184,0.45)'}}>{count} items</span>
          )}
        </div>
        <h1 className="text-[26px] font-black"
          style={{ letterSpacing: '-0.035em', lineHeight: 1.1, color: 'rgba(240,244,255,0.95)' }}>{title}</h1>
      </div>
      <button onClick={onAdd}
        className="relative flex items-center justify-center active:scale-90 transition-all"
        style={{
          width: 48, height: 48,
          background: 'linear-gradient(145deg, #7c3aed, #4f46e5)',
          borderRadius: 18,
          boxShadow: '0 6px 20px rgba(124,58,237,0.5), inset 0 1px 0 rgba(255,255,255,0.2)',
          border: '1px solid rgba(167,139,250,0.3)',
        }}>
        <Plus size={22} className="text-white" strokeWidth={2.5} />
      </button>
    </div>
  );
};
export default Header;







