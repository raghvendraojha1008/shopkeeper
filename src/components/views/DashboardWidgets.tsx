import React from 'react';
import { LucideIcon } from 'lucide-react';

export const QuickActionButton = ({ icon: Icon, label, color, onClick }: any) => {
  const colorMap: Record<string,{bg:string;iconBg:string;iconColor:string;border:string;glow:string}> = {
    'bg-green-500':  {bg:'rgba(16,185,129,0.1)',  iconBg:'rgba(16,185,129,0.18)', iconColor:'#34d399', border:'rgba(16,185,129,0.25)', glow:'rgba(16,185,129,0.25)'},
    'bg-red-500':    {bg:'rgba(239,68,68,0.09)',   iconBg:'rgba(239,68,68,0.15)',  iconColor:'#f87171', border:'rgba(239,68,68,0.2)',   glow:'rgba(239,68,68,0.2)'},
    'bg-blue-500':   {bg:'rgba(59,130,246,0.09)',  iconBg:'rgba(59,130,246,0.15)', iconColor:'#60a5fa', border:'rgba(59,130,246,0.2)',  glow:'rgba(59,130,246,0.2)'},
    'bg-orange-500': {bg:'rgba(245,158,11,0.09)',  iconBg:'rgba(245,158,11,0.15)', iconColor:'#fbbf24', border:'rgba(245,158,11,0.2)',  glow:'rgba(245,158,11,0.22)'},
  };
  const c = colorMap[color] || colorMap['bg-blue-500'];
  return (
    <button onClick={onClick}
      className="flex flex-col items-center justify-center gap-3 py-4 px-2 rounded-[22px] active:scale-90 transition-all w-full relative overflow-hidden"
      style={{background:c.bg, boxShadow:`0 4px 18px ${c.glow}`, border:`1px solid ${c.border}`, backdropFilter:'blur(16px)'}}>
      <div className="absolute top-0 left-0 right-0 h-px" style={{background:`linear-gradient(90deg,transparent,${c.iconColor}40,transparent)`}} />
      <div className="p-3 rounded-[16px]" style={{background:c.iconBg, border:`1px solid ${c.border}`}}>
        <Icon size={18} style={{color:c.iconColor}} strokeWidth={2} />
      </div>
      <span className="text-[9px] font-black uppercase tracking-[0.08em] text-center leading-tight"
        style={{color:c.iconColor}}>{label}</span>
    </button>
  );
};

export const MetricCard = ({ title, value, icon: Icon, color, onClick, loading, hide }: any) => {
  const valStr = Math.round(value).toLocaleString('en-IN');
  const charCount = valStr.length;
  const fontSize = charCount > 12 ? 13 : charCount > 9 ? 15 : charCount > 6 ? 17 : charCount <= 3 ? 22 : 19;

  const styles: Record<string,{bg:string;iconBg:string;ic:string;glow:string;border:string;valColor:string}> = {
    'text-green-500':  {bg:'rgba(16,185,129,0.08)', iconBg:'rgba(16,185,129,0.15)', ic:'#34d399', glow:'rgba(16,185,129,0.15)', border:'rgba(16,185,129,0.2)',  valColor:'#6ee7b7'},
    'text-red-500':    {bg:'rgba(239,68,68,0.07)',  iconBg:'rgba(239,68,68,0.12)',  ic:'#f87171', glow:'rgba(239,68,68,0.12)',  border:'rgba(239,68,68,0.18)', valColor:'#fca5a5'},
    'text-blue-500':   {bg:'rgba(59,130,246,0.08)', iconBg:'rgba(59,130,246,0.13)', ic:'#60a5fa', glow:'rgba(59,130,246,0.15)', border:'rgba(59,130,246,0.2)',  valColor:'#93c5fd'},
    'text-blue-400':   {bg:'rgba(59,130,246,0.08)', iconBg:'rgba(59,130,246,0.13)', ic:'#60a5fa', glow:'rgba(59,130,246,0.15)', border:'rgba(59,130,246,0.2)',  valColor:'#93c5fd'},
    'text-orange-500': {bg:'rgba(245,158,11,0.08)', iconBg:'rgba(245,158,11,0.13)', ic:'#fbbf24', glow:'rgba(245,158,11,0.15)', border:'rgba(245,158,11,0.2)',  valColor:'#fcd34d'},
    'text-orange-400': {bg:'rgba(245,158,11,0.08)', iconBg:'rgba(245,158,11,0.13)', ic:'#fbbf24', glow:'rgba(245,158,11,0.15)', border:'rgba(245,158,11,0.2)',  valColor:'#fcd34d'},
  };
  const s = styles[color] || styles['text-blue-400'];

  return (
    <button onClick={onClick}
      className="p-4 rounded-[22px] active:scale-[0.97] transition-all w-full text-left overflow-hidden relative"
      style={{background:s.bg, boxShadow:`0 4px 20px ${s.glow}`, border:`1px solid ${s.border}`, backdropFilter:'blur(20px)'}}>
      <div className="absolute top-0 left-0 right-0 h-px" style={{background:`linear-gradient(90deg,transparent,${s.ic}40,transparent)`}} />
      <div className="absolute top-0 right-0 w-16 h-16 rounded-full opacity-30"
        style={{background:`radial-gradient(circle, ${s.ic}40 0%, transparent 70%)`, transform:'translate(20%,-20%)'}} />
      <div className="p-2 rounded-[12px] w-fit mb-3" style={{background:s.iconBg, border:`1px solid ${s.border}`}}>
        <Icon size={14} style={{color:s.ic}} strokeWidth={2.5} />
      </div>
      <div className="text-[9px] font-black uppercase tracking-[0.12em] mb-1.5"
        style={{color:'rgba(148,163,184,0.5)'}}>{title}</div>
      <div className="font-black tabular-nums leading-tight"
        style={{fontSize, color:s.valColor}}>
        {loading
          ? <div style={{height:20,width:80,background:'rgba(255,255,255,0.08)',borderRadius:8,animation:'pulse 1.5s infinite'}}/>
          : hide
            ? <span style={{letterSpacing:'0.15em',opacity:0.7}}>••••</span>
            : <span><span style={{fontSize:'70%',opacity:0.5}}>₹</span>{valStr}</span>
        }
      </div>
    </button>
  );
};







