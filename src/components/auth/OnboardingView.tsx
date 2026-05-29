import React, { useState, useEffect } from 'react';
import {
  CheckCircle2, Lock, Users, BarChart3, Settings, ShieldCheck,
  ArrowRight, ArrowLeft, Sparkles, Building2, Phone, MapPin,
  Hash, Percent, IndianRupee, Plus, Check, ChevronRight,
  Package, FileText, BookOpen,
} from 'lucide-react';
import { useRole } from '../../context/RoleContext';
import { ApiService } from '../../services/api';
import { useAuth } from '../../context/AuthContext';
import { useUI } from '../../context/UIContext';

interface OnboardingViewProps { onComplete: () => void; }

type Step = 'welcome' | 'firm' | 'gst' | 'firstentry' | 'done';

interface FirmData {
  firm_name   : string;
  owner_name  : string;
  phone       : string;
  address     : string;
  city        : string;
  state       : string;
  gstin       : string;
  gst_enabled : boolean;
}

// ── Minimal input ─────────────────────────────────────────────────────────────
const Input: React.FC<{
  label: string; value: string; onChange: (v: string) => void;
  placeholder?: string; type?: string; icon?: React.ElementType; optional?: boolean;
}> = ({ label, value, onChange, placeholder, type = 'text', icon: Icon, optional }) => (
  <div>
    <div className="flex items-center justify-between mb-1.5">
      <label className="text-[10px] font-black uppercase tracking-wider" style={{ color: 'rgba(148,163,184,0.55)' }}>{label}</label>
      {optional && <span className="text-[9px]" style={{ color: 'rgba(148,163,184,0.35)' }}>Optional</span>}
    </div>
    <div className="relative">
      {Icon && (
        <div className="absolute left-3.5 top-1/2 -translate-y-1/2">
          <Icon size={13} style={{ color: 'rgba(148,163,184,0.4)' }} />
        </div>
      )}
      <input type={type} value={value} onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full py-3 rounded-[14px] text-sm font-semibold outline-none transition-all"
        style={{
          background  : 'rgba(255,255,255,0.06)',
          border      : '1px solid rgba(255,255,255,0.12)',
          color       : 'rgba(240,244,255,0.9)',
          paddingLeft : Icon ? '2.75rem' : '1rem',
          paddingRight: '1rem',
        }}
      />
    </div>
  </div>
);

// ── Progress dots ─────────────────────────────────────────────────────────────
const Steps: React.FC<{ steps: Step[]; current: Step }> = ({ steps, current }) => {
  const idx = steps.indexOf(current);
  return (
    <div className="flex items-center gap-2 mb-6">
      {steps.map((s, i) => (
        <React.Fragment key={s}>
          <div className="w-6 h-6 rounded-full flex items-center justify-center text-[9px] font-black flex-shrink-0 transition-all"
            style={
              i < idx  ? { background: '#10b981', color: '#fff' }
            : i === idx ? { background: 'linear-gradient(135deg,#6366f1,#8b5cf6)', color: '#fff', boxShadow: '0 0 12px rgba(99,102,241,0.5)' }
            :              { background: 'rgba(255,255,255,0.07)', color: 'rgba(148,163,184,0.4)' }
            }>
            {i < idx ? <Check size={11} /> : i + 1}
          </div>
          {i < steps.length - 1 && (
            <div className="flex-1 h-0.5 rounded-full" style={{ background: i < idx ? '#10b981' : 'rgba(255,255,255,0.08)' }} />
          )}
        </React.Fragment>
      ))}
    </div>
  );
};

// ── Main ──────────────────────────────────────────────────────────────────────
const OnboardingView: React.FC<OnboardingViewProps> = ({ onComplete }) => {
  const { role, isAdmin, adminUid } = useRole();
  const { user }                    = useAuth();
  const { showToast }               = useUI();

  // Save target = the firm being viewed (admin's UID for staff, own UID for
  // owners). Falls back to user.uid so first-time onboarding still works
  // before any role document is loaded.
  const dataUid = adminUid || user?.uid || '';

  const [step, setStep]       = useState<Step>('welcome');
  const [saving, setSaving]   = useState(false);
  const [firm, setFirm]       = useState<FirmData>({
    firm_name: '', owner_name: '', phone: '', address: '',
    city: '', state: '', gstin: '', gst_enabled: true,
  });
  const [skipEntry, setSkipEntry] = useState(false);

  // Pre-fill existing settings if the user has data from a previous session.
  // Read from dataUid (admin namespace for staff) so the form shows the firm
  // they actually have access to — not an empty profile under their own UID.
  useEffect(() => {
    if (!dataUid) return;
    ApiService.settings.get(dataUid).then((s: any) => {
      if (!s) return;
      const p = s.profile || {};
      const a = s.automation || {};
      // Parse address back into address + city (best effort: "address, city" format)
      let addr = p.address || '';
      let city = '';
      if (addr.includes(',')) {
        const parts = addr.split(',');
        city = parts.pop()?.trim() || '';
        addr = parts.join(',').trim();
      }
      setFirm(prev => ({
        ...prev,
        firm_name   : p.firm_name   || prev.firm_name,
        owner_name  : p.owner_name  || prev.owner_name,
        phone       : p.contact     || prev.phone,
        address     : addr          || prev.address,
        city        : city          || prev.city,
        state       : p.state       || prev.state,
        gstin       : p.gstin       || prev.gstin,
        gst_enabled : a.auto_calculate_gst !== undefined ? !!a.auto_calculate_gst : prev.gst_enabled,
      }));
    }).catch(() => {});
  }, [dataUid]);

  const STEPS: Step[] = isAdmin
    ? ['welcome', 'firm', 'gst', 'firstentry', 'done']
    : ['welcome', 'done'];

  const setF = (k: keyof FirmData) => (v: string | boolean) =>
    setFirm(prev => ({ ...prev, [k]: v }));

  const saveFirmProfile = async () => {
    if (!user || !dataUid) { showToast('Please sign in again', 'error'); return false; }
    if (!firm.firm_name.trim()) { showToast('Firm name is required', 'error'); return false; }
    setSaving(true);
    try {
      const profile = {
        firm_name  : firm.firm_name.trim(),
        owner_name : firm.owner_name.trim(),
        phone      : firm.phone.trim(),
        address    : `${firm.address}, ${firm.city}`.trim().replace(/^,\s*/, ''),
        state      : firm.state.trim(),
        gstin      : firm.gstin.trim(),
      };
      const automation = { auto_calculate_gst: firm.gst_enabled };
      // Save to the firm namespace the user is actually viewing — for staff
      // members this is the admin's UID, not their own.
      await ApiService.settings.save(dataUid, { profile, automation } as any);
      return true;
    } catch (e) {
      showToast('Could not save profile. You can edit it later in Settings.', 'error');
      return false;
    } finally { setSaving(false); }
  };

  const next = async () => {
    const idx = STEPS.indexOf(step);
    // Block step advance when the save fails so the user isn't stranded with a
    // half-saved profile and no chance to re-enter their firm details.
    if (step === 'gst') {
      const ok = await saveFirmProfile();
      if (!ok) return;
    }
    if (idx < STEPS.length - 1) setStep(STEPS[idx + 1]);
  };

  const back = () => {
    const idx = STEPS.indexOf(step);
    if (idx > 0) setStep(STEPS[idx - 1]);
  };

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="login-view-root auth-page-bg flex flex-col relative overflow-hidden"
      style={{ minHeight: '100dvh' }}>
      {/* Aurora */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-[-10%] left-[-5%] w-[70vw] h-[70vw] rounded-full opacity-20"
          style={{ background: 'radial-gradient(circle, rgba(99,102,241,0.8), transparent 65%)' }} />
        <div className="absolute bottom-[5%] right-[-10%] w-[55vw] h-[55vw] rounded-full opacity-15"
          style={{ background: 'radial-gradient(circle, rgba(245,158,11,0.6), transparent 65%)' }} />
      </div>

      <div className="relative flex flex-col flex-1 px-5 pt-12 pb-8 max-w-sm mx-auto w-full">

        {/* ── WELCOME ── */}
        {step === 'welcome' && (
          <div className="flex flex-col flex-1">
            <div className="flex-1 flex flex-col items-center justify-center text-center gap-4">
              <div className="relative mb-2">
                <div className="absolute -inset-4 rounded-full opacity-40"
                  style={{ background: 'radial-gradient(circle, rgba(16,185,129,0.8), transparent)' }} />
                <div className="relative w-20 h-20 rounded-[28px] flex items-center justify-center"
                  style={{ background: 'linear-gradient(145deg,#10b981,#059669)', boxShadow: '0 16px 40px rgba(16,185,129,0.4), inset 0 1px 0 rgba(255,255,255,0.25)' }}>
                  <CheckCircle2 size={38} className="text-white" strokeWidth={2} />
                </div>
              </div>

              <div>
                <div className="flex items-center justify-center gap-2 mb-2">
                  <Sparkles size={13} style={{ color: 'rgba(245,158,11,0.8)' }} />
                  <span className="text-[10px] font-black uppercase tracking-[0.2em]" style={{ color: 'rgba(245,158,11,0.7)' }}>Account Ready</span>
                  <Sparkles size={13} style={{ color: 'rgba(245,158,11,0.8)' }} />
                </div>
                <h1 className="text-[30px] font-black text-white mb-2" style={{ letterSpacing: '-0.03em' }}>
                  Welcome{isAdmin ? ', Admin!' : ' Aboard!'}
                </h1>
                <p className="text-sm max-w-xs mx-auto" style={{ color: 'rgba(255,255,255,0.45)', lineHeight: 1.6 }}>
                  {isAdmin
                    ? 'Your Shopkeeper account is ready. Let\'s set up your business in 3 quick steps.'
                    : 'Your staff account is set up. You have access to the dashboard, inventory, and ledger.'}
                </p>
              </div>

              {/* Feature grid */}
              <div className="w-full grid grid-cols-2 gap-3 mt-4">
                {(isAdmin ? [
                  { icon: ShieldCheck, title: 'Full Admin Access',    color: '#6366f1', bg: 'rgba(99,102,241,0.12)' },
                  { icon: Settings,    title: 'Settings & Config',    color: '#3b82f6', bg: 'rgba(59,130,246,0.12)' },
                  { icon: BarChart3,   title: 'Reports & Insights',   color: '#8b5cf6', bg: 'rgba(139,92,246,0.12)' },
                  { icon: Users,       title: 'Team Management',      color: '#10b981', bg: 'rgba(16,185,129,0.12)' },
                ] : [
                  { icon: Users,       title: 'Staff Access',         color: '#f59e0b', bg: 'rgba(245,158,11,0.12)' },
                  { icon: ShieldCheck, title: 'Dashboard & Metrics',  color: '#3b82f6', bg: 'rgba(59,130,246,0.12)' },
                  { icon: Users,       title: 'Parties Management',   color: '#10b981', bg: 'rgba(16,185,129,0.12)' },
                  { icon: Lock,        title: 'Limited Permissions',  color: '#ef4444', bg: 'rgba(239,68,68,0.12)' },
                ]).map((f, i) => (
                  <div key={i} className="rounded-[18px] p-4"
                    style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', animation: `fadeUp 0.4s ${i*80}ms both` }}>
                    <div className="w-9 h-9 rounded-[12px] flex items-center justify-center mb-2.5" style={{ background: f.bg }}>
                      <f.icon size={18} style={{ color: f.color }} />
                    </div>
                    <p className="text-[11px] font-black text-white">{f.title}</p>
                  </div>
                ))}
              </div>
            </div>

            <button onClick={next}
              className="w-full py-4 rounded-[20px] font-black text-white text-sm flex items-center justify-center gap-2.5 active:scale-[0.97] transition-all mt-6"
              style={{ background: 'linear-gradient(135deg, #6366f1, #8b5cf6)', boxShadow: '0 12px 32px rgba(99,102,241,0.45)' }}>
              {isAdmin ? <><span>Set Up My Business</span><ArrowRight size={18} /></> : <><span>Let\'s Get Started</span><ArrowRight size={18} /></>}
            </button>
          </div>
        )}

        {/* ── FIRM SETUP ── */}
        {step === 'firm' && (
          <div className="flex flex-col flex-1">
            <Steps steps={STEPS} current={step} />
            <div className="flex items-center gap-2.5 mb-5">
              <div className="p-2.5 rounded-[14px]" style={{ background: 'rgba(59,130,246,0.14)', border: '1px solid rgba(59,130,246,0.25)' }}>
                <Building2 size={16} style={{ color: '#60a5fa' }} />
              </div>
              <div>
                <h2 className="text-xl font-black text-white">Business Profile</h2>
                <p className="text-[11px]" style={{ color: 'rgba(148,163,184,0.5)' }}>Used in invoices & reports</p>
              </div>
            </div>

            <div className="space-y-4 flex-1">
              <Input label="Business / Firm Name *" value={firm.firm_name} onChange={setF('firm_name')}
                placeholder="e.g. Sharma Traders" icon={Building2} />
              <Input label="Owner Name" value={firm.owner_name} onChange={setF('owner_name')}
                placeholder="e.g. Ramesh Sharma" icon={Users} optional />
              <div className="grid grid-cols-2 gap-3">
                <Input label="Phone" value={firm.phone} onChange={setF('phone')} placeholder="9876543210" icon={Phone} optional />
                <Input label="City" value={firm.city} onChange={setF('city')} placeholder="Mumbai" icon={MapPin} optional />
              </div>
              <Input label="State" value={firm.state} onChange={setF('state')} placeholder="Maharashtra" optional />
              <Input label="Address" value={firm.address} onChange={setF('address')} placeholder="Shop No., Street, Area" optional />
            </div>

            <div className="flex gap-3 mt-6">
              <button onClick={back} className="px-5 py-3.5 rounded-[16px] font-black text-sm active:scale-95 transition-all"
                style={{ background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.12)', color: 'rgba(203,213,225,0.8)' }}>
                <ArrowLeft size={16} />
              </button>
              <button onClick={next}
                disabled={!firm.firm_name.trim()}
                className="flex-1 py-3.5 rounded-[16px] font-black text-white text-sm flex items-center justify-center gap-2 active:scale-[0.97] transition-all disabled:opacity-40"
                style={{ background: 'linear-gradient(135deg, #3b82f6, #6366f1)' }}>
                Continue <ArrowRight size={16} />
              </button>
            </div>
          </div>
        )}

        {/* ── GST SETUP ── */}
        {step === 'gst' && (
          <div className="flex flex-col flex-1">
            <Steps steps={STEPS} current={step} />
            <div className="flex items-center gap-2.5 mb-5">
              <div className="p-2.5 rounded-[14px]" style={{ background: 'rgba(245,158,11,0.14)', border: '1px solid rgba(245,158,11,0.25)' }}>
                <Percent size={16} style={{ color: '#fbbf24' }} />
              </div>
              <div>
                <h2 className="text-xl font-black text-white">GST Settings</h2>
                <p className="text-[11px]" style={{ color: 'rgba(148,163,184,0.5)' }}>Can be changed anytime in Settings</p>
              </div>
            </div>

            <div className="space-y-4 flex-1">
              {/* GST toggle */}
              <button
                onClick={() => setF('gst_enabled')(!firm.gst_enabled)}
                className="w-full flex items-center justify-between p-4 rounded-[18px] active:scale-[0.98] transition-all"
                style={{ background: firm.gst_enabled ? 'rgba(16,185,129,0.1)' : 'rgba(255,255,255,0.05)', border: `1px solid ${firm.gst_enabled ? 'rgba(16,185,129,0.25)' : 'rgba(255,255,255,0.1)'}` }}>
                <div>
                  <p className="text-sm font-black text-white">Enable GST Calculations</p>
                  <p className="text-[10px]" style={{ color: 'rgba(148,163,184,0.5)' }}>Auto CGST/SGST/IGST in invoices</p>
                </div>
                <div className="w-11 h-6 rounded-full transition-all relative flex-shrink-0"
                  style={{ background: firm.gst_enabled ? '#10b981' : 'rgba(255,255,255,0.18)', border: '1px solid rgba(255,255,255,0.1)' }}>
                  <div className="absolute top-[3px] w-[18px] h-[18px] rounded-full transition-all"
                    style={{
                      left: firm.gst_enabled ? 'calc(100% - 21px)' : '3px',
                      background: '#ffffff',
                      boxShadow: '0 1px 4px rgba(0,0,0,0.5), 0 0 0 1px rgba(0,0,0,0.08)',
                    }} />
                </div>
              </button>

              {/* GSTIN */}
              <div>
                <Input label="Your GSTIN" value={firm.gstin} onChange={setF('gstin')}
                  placeholder="22AAAAA0000A1Z5" icon={Hash} optional />
                {firm.gstin && firm.gstin.length === 15 && (
                  <p className="text-[9px] mt-1 font-bold" style={{ color: 'rgba(52,211,153,0.8)' }}>
                    ✓ Format looks valid
                  </p>
                )}
                {firm.gstin && firm.gstin.length > 0 && firm.gstin.length !== 15 && (
                  <p className="text-[9px] mt-1 font-bold" style={{ color: 'rgba(251,191,36,0.8)' }}>
                    GSTIN must be 15 characters
                  </p>
                )}
              </div>

              <div className="rounded-[16px] p-3.5" style={{ background: 'rgba(59,130,246,0.08)', border: '1px solid rgba(59,130,246,0.18)' }}>
                <p className="text-[10px] font-bold" style={{ color: 'rgba(147,197,253,0.7)' }}>
                  💡 GST info appears on invoices and enables CGST/SGST breakdown. You can update this anytime in Settings → Firm Profile.
                </p>
              </div>
            </div>

            <div className="flex gap-3 mt-6">
              <button onClick={back} className="px-5 py-3.5 rounded-[16px] font-black text-sm active:scale-95 transition-all"
                style={{ background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.12)', color: 'rgba(203,213,225,0.8)' }}>
                <ArrowLeft size={16} />
              </button>
              <button onClick={next} disabled={saving}
                className="flex-1 py-3.5 rounded-[16px] font-black text-white text-sm flex items-center justify-center gap-2 active:scale-[0.97] transition-all disabled:opacity-60"
                style={{ background: 'linear-gradient(135deg, #f59e0b, #d97706)' }}>
                {saving ? 'Saving…' : <><span>Save & Continue</span><ArrowRight size={16} /></>}
              </button>
            </div>
          </div>
        )}

        {/* ── FIRST ENTRY HINT ── */}
        {step === 'firstentry' && (
          <div className="flex flex-col flex-1">
            <Steps steps={STEPS} current={step} />
            <div className="flex items-center gap-2.5 mb-5">
              <div className="p-2.5 rounded-[14px]" style={{ background: 'rgba(139,92,246,0.14)', border: '1px solid rgba(139,92,246,0.25)' }}>
                <Plus size={16} style={{ color: '#a78bfa' }} />
              </div>
              <div>
                <h2 className="text-xl font-black text-white">You're Almost Done!</h2>
                <p className="text-[11px]" style={{ color: 'rgba(148,163,184,0.5)' }}>Here's how to get started quickly</p>
              </div>
            </div>

            <div className="space-y-3 flex-1">
              {[
                { step: '1', icon: Package,      color: '#34d399', bg: 'rgba(16,185,129,0.1)',  title: 'Add an Item',      desc: 'Go to Inventory → tap + to add your first product with price & stock' },
                { step: '2', icon: FileText,     color: '#60a5fa', bg: 'rgba(59,130,246,0.1)',  title: 'Create a Bill',    desc: 'Open Quick Bill → pick items → tap Save Bill to generate an invoice' },
                { step: '3', icon: BookOpen,     color: '#a78bfa', bg: 'rgba(139,92,246,0.1)',  title: 'View Your Ledger', desc: 'See all sales and purchases with running balance in the Ledger tab' },
                { step: '4', icon: Users,        color: '#fbbf24', bg: 'rgba(245,158,11,0.1)',  title: 'Track Parties',    desc: 'Add customers & suppliers to monitor dues and payment history' },
              ].map((item, i) => (
                <div key={i} className="flex items-center gap-4 p-4 rounded-[18px]"
                  style={{ background: item.bg, border: `1px solid ${item.bg.replace('0.1', '0.25')}`, animation: `fadeUp 0.3s ${i * 60}ms both` }}>
                  <div className="w-10 h-10 rounded-[14px] flex items-center justify-center flex-shrink-0"
                    style={{ background: item.bg.replace('0.1', '0.18') }}>
                    <item.icon size={18} style={{ color: item.color }} />
                  </div>
                  <div>
                    <p className="text-sm font-black text-white">{item.title}</p>
                    <p className="text-[10px]" style={{ color: 'rgba(148,163,184,0.55)' }}>{item.desc}</p>
                  </div>
                  <ChevronRight size={14} style={{ color: 'rgba(148,163,184,0.3)', marginLeft: 'auto' }} />
                </div>
              ))}
            </div>

            <div className="flex gap-3 mt-6">
              <button onClick={back} className="px-5 py-3.5 rounded-[16px] font-black text-sm active:scale-95 transition-all"
                style={{ background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.12)', color: 'rgba(203,213,225,0.8)' }}>
                <ArrowLeft size={16} />
              </button>
              <button onClick={next}
                className="flex-1 py-3.5 rounded-[16px] font-black text-white text-sm flex items-center justify-center gap-2 active:scale-[0.97] transition-all"
                style={{ background: 'linear-gradient(135deg, #8b5cf6, #6366f1)', boxShadow: '0 8px 24px rgba(139,92,246,0.4)' }}>
                <span>Open Dashboard</span><ArrowRight size={16} />
              </button>
            </div>
          </div>
        )}

        {/* ── DONE ── */}
        {step === 'done' && (
          <div className="flex flex-col flex-1 items-center justify-center text-center gap-5">
            <div className="relative">
              <div className="absolute -inset-6 rounded-full opacity-30"
                style={{ background: 'radial-gradient(circle, rgba(99,102,241,0.8), transparent)' }} />
              <div className="relative w-24 h-24 rounded-[28px] flex items-center justify-center"
                style={{ background: 'linear-gradient(145deg,#6366f1,#8b5cf6)', boxShadow: '0 16px 40px rgba(99,102,241,0.5)' }}>
                <CheckCircle2 size={44} className="text-white" strokeWidth={1.8} />
              </div>
            </div>

            <div>
              <h2 className="text-[28px] font-black text-white mb-2" style={{ letterSpacing: '-0.03em' }}>All Set!</h2>
              <p className="text-sm max-w-xs" style={{ color: 'rgba(255,255,255,0.45)', lineHeight: 1.6 }}>
                {isAdmin ? 'Your business is configured. Start recording entries right away!' : 'Your account is ready. The admin has set up your business profile.'}
              </p>
            </div>

            <button onClick={onComplete}
              className="w-full max-w-xs py-4 rounded-[20px] font-black text-white text-sm flex items-center justify-center gap-2 active:scale-[0.97] transition-all mt-2"
              style={{ background: 'linear-gradient(135deg, #10b981, #059669)', boxShadow: '0 12px 32px rgba(16,185,129,0.45)' }}>
              <span>Open Dashboard</span><ArrowRight size={18} />
            </button>
          </div>
        )}
      </div>

      <style>{`
        @keyframes fadeUp { from { opacity:0; transform:translateY(14px) } to { opacity:1; transform:translateY(0) } }
      `}</style>
    </div>
  );
};

export default OnboardingView;








