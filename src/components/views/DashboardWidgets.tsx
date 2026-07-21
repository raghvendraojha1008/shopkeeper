import React from 'react';
import { LucideIcon } from 'lucide-react';
import { useIsDark } from '../../hooks/useIsDark';

export const QuickActionButton = ({ icon: Icon, label, color, onClick }: any) => {
  const isDark = useIsDark();

  // Light-mode maps use stronger alpha + darker text colours for contrast
  const colorMapDark: Record<string,{bg:string;iconBg:string;iconColor:string;border:string;glow:string}> = {
    'bg-green-500':  {bg:'var(--col-emerald-10)',  iconBg:'var(--col-emerald-18)', iconColor:'var(--col-success)', border:'var(--col-emerald-25)', glow:'var(--col-emerald-25)'},
    'bg-red-500':    {bg:'var(--col-danger-09)',   iconBg:'var(--col-danger-15)',  iconColor:'var(--col-danger)',  border:'var(--col-danger-20)',  glow:'var(--col-danger-20)'},
    'bg-blue-500':   {bg:'var(--col-info-09)',  iconBg:'var(--col-info-15)', iconColor:'var(--col-info)',    border:'var(--col-info-20)', glow:'var(--col-info-20)'},
    'bg-orange-500': {bg:'var(--col-warning-09)',  iconBg:'var(--col-warning-15)', iconColor:'var(--col-warning)', border:'var(--col-warning-20)', glow:'var(--col-warning-22)'},
  };
  const colorMapLight: Record<string,{bg:string;iconBg:string;iconColor:string;border:string;glow:string}> = {
    'bg-green-500':  {bg:'rgba(5,150,105,0.10)',   iconBg:'rgba(5,150,105,0.18)',  iconColor:'#059669', border:'rgba(5,150,105,0.30)',  glow:'rgba(5,150,105,0.20)'},
    'bg-red-500':    {bg:'rgba(220,38,38,0.08)',   iconBg:'rgba(220,38,38,0.15)',  iconColor:'#dc2626', border:'rgba(220,38,38,0.25)',  glow:'rgba(220,38,38,0.15)'},
    'bg-blue-500':   {bg:'rgba(37,99,235,0.08)',   iconBg:'rgba(37,99,235,0.14)',  iconColor:'#2563eb', border:'rgba(37,99,235,0.22)',  glow:'rgba(37,99,235,0.15)'},
    'bg-orange-500': {bg:'rgba(217,119,6,0.08)',   iconBg:'rgba(217,119,6,0.15)',  iconColor:'#d97706', border:'rgba(217,119,6,0.22)',  glow:'rgba(217,119,6,0.18)'},
  };

  const map = isDark ? colorMapDark : colorMapLight;
  const c = map[color] || map['bg-blue-500'];

  return (
    <button onClick={onClick}
      className="flex flex-col items-center justify-center gap-3 py-4 px-2 rounded-[22px] active:scale-90 transition-all w-full relative overflow-hidden"
      style={{background:c.bg, boxShadow:`0 4px 18px ${c.glow}`, border:`1px solid ${c.border}`, backdropFilter:'blur(16px)'}}>
      <div className="absolute top-0 left-0 right-0 h-px" style={{background:`linear-gradient(90deg,transparent,${c.iconColor}40,transparent)`}} />
      <div className="p-3 rounded-[16px]" style={{background:c.iconBg, border:`1px solid ${c.border}`}}>
        <Icon size={18} style={{color:c.iconColor}} strokeWidth={2} />
      </div>
      <span className="text-app-xs font-black uppercase tracking-[0.08em] text-center leading-tight"
        style={{color:c.iconColor}}>{label}</span>
    </button>
  );
};

export const MetricCard = ({ title, value, icon: Icon, color, onClick, loading, hide }: any) => {
  const isDark = useIsDark();

  const valStr = Math.round(value).toLocaleString('en-IN');
  const charCount = valStr.length;
  const fontSize = charCount > 12 ? 13 : charCount > 9 ? 15 : charCount > 6 ? 17 : charCount <= 3 ? 22 : 19;

  const stylesDark: Record<string,{bg:string;iconBg:string;ic:string;glow:string;border:string;valColor:string}> = {
    'text-green-500':  {bg:'var(--col-emerald-08)',  iconBg:'var(--col-emerald-15)', ic:'var(--col-success)',  glow:'var(--col-emerald-15)', border:'var(--col-emerald-20)',  valColor:'var(--col-success-light)'},
    'text-red-500':    {bg:'var(--col-danger-07)',   iconBg:'var(--col-danger-12)',  ic:'var(--col-danger)',   glow:'var(--col-danger-12)',  border:'var(--col-danger-18)',  valColor:'var(--col-danger-light)'},
    'text-blue-500':   {bg:'var(--col-info-08)',  iconBg:'var(--col-info-13)', ic:'var(--col-info)',     glow:'var(--col-info-15)', border:'var(--col-info-20)', valColor:'var(--col-info-light)'},
    'text-blue-400':   {bg:'var(--col-info-08)',  iconBg:'var(--col-info-13)', ic:'var(--col-info)',     glow:'var(--col-info-15)', border:'var(--col-info-20)', valColor:'var(--col-info-light)'},
    'text-orange-500': {bg:'var(--col-warning-08)',  iconBg:'var(--col-warning-13)', ic:'var(--col-warning)',  glow:'var(--col-warning-15)', border:'var(--col-warning-20)', valColor:'var(--col-warning-light)'},
    'text-orange-400': {bg:'var(--col-warning-08)',  iconBg:'var(--col-warning-13)', ic:'var(--col-warning)',  glow:'var(--col-warning-15)', border:'var(--col-warning-20)', valColor:'var(--col-warning-light)'},
  };
  const stylesLight: Record<string,{bg:string;iconBg:string;ic:string;glow:string;border:string;valColor:string}> = {
    'text-green-500':  {bg:'rgba(5,150,105,0.09)',   iconBg:'rgba(5,150,105,0.16)',  ic:'#059669', glow:'rgba(5,150,105,0.14)',  border:'rgba(5,150,105,0.28)',  valColor:'#047857'},
    'text-red-500':    {bg:'rgba(220,38,38,0.07)',   iconBg:'rgba(220,38,38,0.14)',  ic:'#dc2626', glow:'rgba(220,38,38,0.12)',  border:'rgba(220,38,38,0.24)',  valColor:'#b91c1c'},
    'text-blue-500':   {bg:'rgba(37,99,235,0.07)',   iconBg:'rgba(37,99,235,0.14)',  ic:'#2563eb', glow:'rgba(37,99,235,0.12)',  border:'rgba(37,99,235,0.24)',  valColor:'#1d4ed8'},
    'text-blue-400':   {bg:'rgba(37,99,235,0.07)',   iconBg:'rgba(37,99,235,0.14)',  ic:'#2563eb', glow:'rgba(37,99,235,0.12)',  border:'rgba(37,99,235,0.24)',  valColor:'#1d4ed8'},
    'text-orange-500': {bg:'rgba(217,119,6,0.07)',   iconBg:'rgba(217,119,6,0.14)',  ic:'#d97706', glow:'rgba(217,119,6,0.12)',  border:'rgba(217,119,6,0.24)',  valColor:'#b45309'},
    'text-orange-400': {bg:'rgba(217,119,6,0.07)',   iconBg:'rgba(217,119,6,0.14)',  ic:'#d97706', glow:'rgba(217,119,6,0.12)',  border:'rgba(217,119,6,0.24)',  valColor:'#b45309'},
  };

  const styles = isDark ? stylesDark : stylesLight;
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
      <div className="text-app-xs font-black uppercase tracking-[0.12em] mb-1.5"
        style={{color: 'var(--text-muted)'}}>{title}</div>
      <div className="font-black tabular-nums leading-tight"
        style={{fontSize, color:s.valColor}}>
        {loading
          ? <div style={{height:20,width:80,background:'var(--rgba-white-08)',borderRadius:8,animation:'pulse 1.5s infinite'}}/>
          : hide
            ? <span style={{letterSpacing:'0.15em',opacity:0.7}}>••••</span>
            : <span><span style={{fontSize:'70%',opacity:0.5}}>₹</span>{valStr}</span>
        }
      </div>
    </button>
  );
};
