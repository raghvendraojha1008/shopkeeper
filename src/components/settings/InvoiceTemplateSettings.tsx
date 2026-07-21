/**
 * InvoiceTemplateSettings — Full invoice template customizer
 * 4 templates: Classic, Modern, Thermal 58mm, Letterhead
 * Controls: logo, colors, fields, terms, bank details, signatory
 */
import React, { useState, useRef } from 'react';
import {
  FileText, Eye, Check, Palette, Building2, CreditCard,
  Type, Upload, X, ChevronDown, ChevronUp, Sliders,
} from 'lucide-react';
import { useUI } from '../../context/UIContext';

interface InvoiceTemplateSettingsProps {
  settings: any;
  onUpdateSettings: (s: any) => void;
}

export type TemplateId = 'classic' | 'modern' | 'thermal58' | 'letterhead';

export interface InvoiceTemplate {
  id: TemplateId;
  theme_color: string;       // hex
  show_logo: boolean;
  show_signature: boolean;
  show_bank_details: boolean;
  show_gstin: boolean;
  show_vehicle: boolean;
  show_terms: boolean;
  show_qr: boolean;
  terms_text: string;
  bank_details: string;
  authorized_signatory: string;
  header_style: 'filled' | 'outline' | 'minimal';
  font_size: 'small' | 'medium' | 'large';
  invoice_title: string;     // "TAX INVOICE" | "INVOICE" | "BILL" etc.
  logo_base64: string;
  font_family: string;       // 'helvetica' | 'times' | 'courier'
  base_font_size: number;    // 8–16, default 12. All PDF sizes scale proportionally.
}

const DEFAULT_TEMPLATE: InvoiceTemplate = {
  id: 'classic',
  theme_color: "var(--col-blue-900)",
  show_logo: true,
  show_signature: true,
  show_bank_details: true,
  show_gstin: true,
  show_vehicle: false,
  show_terms: true,
  show_qr: false,
  terms_text: 'Terms & Conditions:\nThank you for your purchase! We truly appreciate it and look forward to serving you again soon.',
  bank_details: '',
  authorized_signatory: 'Authorized Signatory',
  header_style: 'filled',
  font_size: 'medium',
  invoice_title: 'TAX INVOICE',
  logo_base64: '',
  font_family: 'helvetica',
  base_font_size: 12,
};

const TEMPLATES: { id: TemplateId; label: string; desc: string; icon: string; preview_color: string }[] = [
  { id: 'classic',    label: 'Classic',   desc: 'Traditional layout with header bar, items table, GST breakup',     icon: '📄', preview_color: "var(--col-blue-900)" },
  { id: 'modern',     label: 'Modern',    desc: 'Clean split layout with colored accents, ideal for digital sharing', icon: '✨', preview_color: "var(--col-violet-600)" },
  { id: 'thermal58',  label: 'Thermal 58mm', desc: 'Compact receipt for thermal printers (58mm/80mm paper width)',   icon: '🧾', preview_color: "var(--col-emerald-dark)" },
  { id: 'letterhead', label: 'Letterhead', desc: 'Formal layout with top/bottom letterhead and watermark',           icon: '🏢', preview_color: "var(--col-amber-700)" },
];

const PRESET_COLORS = [
  "var(--col-blue-900)","var(--col-blue-800)","var(--col-violet-600)","var(--col-violet-700)","var(--col-emerald-dark)","var(--col-emerald-700)",
  "var(--col-amber-700)","var(--col-amber-800)","var(--col-red-dark)","var(--col-red-700)","var(--col-gray-700)","var(--col-gray-900)",
];

const FONT_SIZES = [
  { id: 'small', label: 'Small', desc: 'More items per page' },
  { id: 'medium', label: 'Medium', desc: 'Standard readability' },
  { id: 'large', label: 'Large', desc: 'Easy to read' },
];

const HEADER_STYLES = [
  { id: 'filled', label: 'Filled', desc: 'Solid color header band' },
  { id: 'outline', label: 'Outline', desc: 'Bordered header, white bg' },
  { id: 'minimal', label: 'Minimal', desc: 'No header, just text' },
];

const INVOICE_TITLES = ['TAX INVOICE', 'INVOICE', 'BILL', 'PROFORMA INVOICE', 'DELIVERY CHALLAN', 'QUOTATION', 'ESTIMATE'];

const Card: React.FC<{ children: React.ReactNode; className?: string }> = ({ children, className = '' }) => (
  <div className={`rounded-2xl p-4 ${className}`}
    style={{ background: 'var(--rgba-white-04)', border: '1px solid var(--glass-border)' }}>
    {children}
  </div>
);

const Toggle: React.FC<{ checked: boolean; onChange: (v: boolean) => void; label: string; desc?: string }> = ({ checked, onChange, label, desc }) => (
  <div className="flex items-center justify-between py-2">
    <div>
      <span className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>{label}</span>
      {desc && <p className="text-app-sm mt-0.5" style={{ color: 'var(--text-muted)' }}>{desc}</p>}
    </div>
    <button onClick={() => onChange(!checked)}
      className="relative w-11 h-6 rounded-full transition-all flex-shrink-0"
      style={{ background: checked ? "var(--col-indigo-600)" :   'var(--rgba-white-10)' }}>
      <div className="absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-all"
        style={{ left: checked ? '22px' : '2px' }} />
    </button>
  </div>
);

// FIX: Section is defined OUTSIDE the parent so its component reference is stable
// across renders. Previously it was defined inside the parent — every parent
// re-render created a brand-new component reference, causing React to unmount
// and remount its children (including the input/textarea fields), which made
// the on-screen keyboard close and focus to be lost after every keystroke.
const Section: React.FC<{
  id: string;
  title: string;
  icon: React.ReactNode;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}> = ({ title, icon, open, onToggle, children }) => (
  <Card className="!p-0 overflow-hidden">
    <button onClick={onToggle} className="w-full flex items-center gap-3 p-4">
      <div className="p-2 rounded-xl flex-shrink-0" style={{ background: 'var(--rgba-white-07)' }}>{icon}</div>
      <span className="flex-1 text-sm font-black text-left" style={{ color: 'var(--text-primary)' }}>{title}</span>
      {open ? <ChevronUp size={16} style={{ color: 'var(--text-muted)' }} /> : <ChevronDown size={16} style={{ color: 'var(--text-muted)' }} />}
    </button>
    {open && <div className="px-4 pb-4 space-y-2 border-t" style={{ borderColor: 'var(--rgba-white-06)' }}>{children}</div>}
  </Card>
);

// MiniPreview defined outside the parent for the same stability reason.
const MiniPreview: React.FC<{ tpl: InvoiceTemplate }> = ({ tpl }) => {
  const color = tpl.theme_color;
  const isTherm = tpl.id === 'thermal58';
  if (isTherm) {
    return (
      <div className="mx-auto rounded-xl overflow-hidden" style={{ width: 120, background: 'white', fontFamily: 'monospace', boxShadow: '0 4px 20px var(--rgba-black-40)' }}>
        <div className="text-center py-2 px-1">
          <div className="text-app-atto font-black text-gray-800">My Firm</div>
          <div className="text-app-pico text-gray-500">Ph: 9876543210</div>
          <div className="border-t border-dashed border-gray-300 my-1" />
          <div className="text-app-femto font-bold text-gray-700">RECEIPT</div>
          <div className="border-t border-dashed border-gray-300 my-1" />
          <div className="flex justify-between text-app-pico text-gray-600">
            <span>Item A</span><span>₹100</span>
          </div>
          <div className="flex justify-between text-app-pico text-gray-600">
            <span>Item B</span><span>₹200</span>
          </div>
          <div className="border-t border-gray-300 my-1" />
          <div className="flex justify-between text-app-femto font-black text-gray-800">
            <span>TOTAL</span><span>₹300</span>
          </div>
          <div className="text-app-nano text-gray-400 mt-1">Thank you!</div>
        </div>
      </div>
    );
  }
  if (tpl.id === 'letterhead') {
    return (
      <div className="mx-auto rounded-xl overflow-hidden" style={{ width: 160, background: 'white', boxShadow: '0 4px 20px var(--rgba-black-40)' }}>
        <div style={{ height: 20, background: color, width: '100%' }} />
        <div className="px-2 py-1">
          <div className="text-app-atto font-black text-center" style={{ color }}>My Firm</div>
          <div className="text-app-pico text-gray-500 text-center">123 Business Street, City</div>
          <div className="border-t border-gray-200 my-1" />
          <div className="text-app-femto font-bold text-gray-700 mb-0.5">TAX INVOICE</div>
          <div className="grid grid-cols-2 gap-x-2">
            {[['Item A','₹100'],['Item B','₹200']].map(([a,b],i) => (
              <React.Fragment key={i}>
                <span className="text-app-pico text-gray-600">{a}</span>
                <span className="text-app-pico text-gray-600 text-right">{b}</span>
              </React.Fragment>
            ))}
          </div>
          <div className="border-t border-gray-300 mt-1 flex justify-between">
            <span className="text-app-pico font-bold text-gray-800">Total</span>
            <span className="text-app-pico font-bold" style={{ color }}>₹300</span>
          </div>
        </div>
        <div style={{ height: 12, background: color, width: '100%' }} />
      </div>
    );
  }
  if (tpl.id === 'modern') {
    return (
      <div className="mx-auto rounded-xl overflow-hidden flex" style={{ width: 160, background: 'white', boxShadow: '0 4px 20px var(--rgba-black-40)', minHeight: 90 }}>
        <div style={{ width: 32, background: color, flexShrink: 0 }} className="flex flex-col items-center pt-2">
          <div className="w-4 h-4 rounded-full bg-white opacity-30" />
        </div>
        <div className="flex-1 px-2 py-1.5">
          <div className="text-app-atto font-black text-gray-800">My Firm</div>
          <div className="text-app-pico font-bold mt-0.5" style={{ color }}>INVOICE #001</div>
          <div className="border-t border-gray-100 my-1" />
          {[['Item A','₹100'],['Item B','₹200']].map(([a,b],i) => (
            <div key={i} className="flex justify-between">
              <span className="text-app-pico text-gray-600">{a}</span>
              <span className="text-app-pico text-gray-700">{b}</span>
            </div>
          ))}
          <div className="mt-1 rounded px-1 py-0.5 flex justify-between" style={{ background: color + '18' }}>
            <span className="text-app-pico font-bold text-gray-800">Total</span>
            <span className="text-app-pico font-bold" style={{ color }}>₹300</span>
          </div>
        </div>
      </div>
    );
  }
  // Classic
  return (
    <div className="mx-auto rounded-xl overflow-hidden" style={{ width: 160, background: 'white', boxShadow: '0 4px 20px var(--rgba-black-40)' }}>
      <div style={{ background: tpl.header_style === 'filled' ? color : 'white', borderBottom: tpl.header_style === 'outline' ? `2px solid ${color}` : undefined, padding: '6px 8px' }}>
        <div className="text-app-atto font-black" style={{ color: tpl.header_style === 'filled' ? 'white' : color }}>My Firm</div>
        <div className="text-app-pico" style={{ color: tpl.header_style === 'filled' ?   'var(--rgba-white-70)' : "var(--col-gray)" }}>Ph: 9876543210</div>
      </div>
      <div className="px-2 py-1.5">
        <div className="text-app-femto font-bold text-gray-700 mb-1">{tpl.invoice_title}</div>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ background: color + '22' }}>
              {['Item','Qty','Rate','Total'].map(h => (
                <th key={h} style={{ fontSize: 3, color, textAlign: h === 'Item' ? 'left' : 'right', padding: '1px 2px' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {[['Item A',2,50,100],['Item B',1,200,200]].map(([name,q,r,t],i) => (
              <tr key={i}>
                <td style={{ fontSize: 3, padding: '1px 2px', color: "var(--col-gray-mid)" }}>{name}</td>
                <td style={{ fontSize: 3, padding: '1px 2px', color: "var(--col-gray-mid)", textAlign: 'right' }}>{q}</td>
                <td style={{ fontSize: 3, padding: '1px 2px', color: "var(--col-gray-mid)", textAlign: 'right' }}>₹{r}</td>
                <td style={{ fontSize: 3, padding: '1px 2px', color: "var(--col-gray-mid)", textAlign: 'right' }}>₹{t}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="flex justify-between mt-1 pt-1 border-t border-gray-200">
          <span style={{ fontSize: 4, fontWeight: 900, color: "var(--col-near-black)" }}>Total</span>
          <span style={{ fontSize: 4, fontWeight: 900, color }}>₹300</span>
        </div>
      </div>
    </div>
  );
};

const InvoiceTemplateSettings: React.FC<InvoiceTemplateSettingsProps> = ({ settings, onUpdateSettings }) => {
  const { showToast } = useUI();
  const logoRef = useRef<HTMLInputElement>(null);

  const savedTemplate: InvoiceTemplate = {
    ...DEFAULT_TEMPLATE,
    ...(settings?.invoice_template || {}),
  };

  const [tpl, setTpl]   = useState<InvoiceTemplate>(savedTemplate);
  const [section, setSection] = useState<string | null>('template');
  const [saving, setSaving]   = useState(false);
  const [showTitleMenu, setShowTitleMenu] = useState(false);

  const update = <K extends keyof InvoiceTemplate>(key: K, val: InvoiceTemplate[K]) => {
    setTpl(t => ({ ...t, [key]: val }));
  };

  const save = async () => {
    setSaving(true);
    try {
      await onUpdateSettings({ ...settings, invoice_template: tpl });
      showToast('Invoice template saved!', 'success');
    } catch (e: any) {
      showToast('Save failed: ' + e.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleLogo = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 500 * 1024) { showToast('Logo must be under 500KB', 'error'); return; }
    const reader = new FileReader();
    reader.onload = () => update('logo_base64', reader.result as string);
    reader.readAsDataURL(file);
  };

  const currentMeta = TEMPLATES.find(t => t.id === tpl.id) || TEMPLATES[0];

  // Stable toggler — keeps Section component identity stable across renders
  const toggleSection = (id: string) => setSection(prev => (prev === id ? null : id));

  return (
    <div className="space-y-4">
      {/* Live preview */}
      <Card>
        <p className="text-app-sm font-black uppercase tracking-wide mb-3" style={{ color: 'var(--text-muted)' }}>
          Live Preview · {currentMeta.label}
        </p>
        <div className="py-4 flex items-center justify-center"
          style={{ background: 'var(--rgba-black-35)', borderRadius: 12, border: '1px solid var(--glass-border)' }}>
          <MiniPreview tpl={tpl} />
        </div>
      </Card>

      {/* Template picker */}
      <Section id="template" title="Template Style" icon={<FileText size={16} style={{ color: "var(--col-violet)" }} />} open={section === 'template'} onToggle={() => toggleSection('template')}>
        <div className="grid grid-cols-2 gap-2 pt-2">
          {TEMPLATES.map(t => (
            <button key={t.id} onClick={() => update('id', t.id)}
              className="flex flex-col items-start gap-1.5 p-3 rounded-xl transition-all active:scale-95"
              style={tpl.id === t.id
                ? { background: `${t.preview_color}22`, border: `1.5px solid ${t.preview_color}55` }
                : { background: 'var(--rgba-white-04)', border: '1px solid var(--glass-border)' }}>
              <span className="text-base">{t.icon}</span>
              <span className="text-xs font-black" style={{ color: tpl.id === t.id ? t.preview_color : 'var(--text-secondary)' }}>
                {t.label}
              </span>
              <span className="text-app-xs font-semibold text-left" style={{ color: 'var(--text-muted)' }}>{t.desc}</span>
              {tpl.id === t.id && <Check size={12} style={{ color: t.preview_color }} />}
            </button>
          ))}
        </div>
      </Section>

      {/* Colors & Header */}
      <Section id="colors" title="Colors & Header" icon={<Palette size={16} style={{ color: "var(--col-info)" }} />} open={section === 'colors'} onToggle={() => toggleSection('colors')}>
        <div className="pt-2 space-y-3">
          <div>
            <p className="text-app-sm font-black uppercase tracking-wide mb-2" style={{ color: 'var(--text-muted)' }}>Theme Color</p>
            <div className="flex flex-wrap gap-2">
              {PRESET_COLORS.map(c => (
                <button key={c} onClick={() => update('theme_color', c)}
                  className="w-8 h-8 rounded-xl transition-all active:scale-90"
                  style={{ background: c, border: tpl.theme_color === c ? '2px solid white' : '2px solid transparent', boxShadow: tpl.theme_color === c ? `0 0 12px ${c}88` : undefined }}>
                  {tpl.theme_color === c && <Check size={14} color="white" className="m-auto" />}
                </button>
              ))}
              <input type="color" value={tpl.theme_color}
                onChange={e => update('theme_color', e.target.value)}
                className="w-8 h-8 rounded-xl cursor-pointer border-0 p-0.5"
                style={{ background:   'var(--rgba-white-10)' }}
                title="Custom color" />
            </div>
          </div>
          {tpl.id !== 'thermal58' && (
            <div>
              <p className="text-app-sm font-black uppercase tracking-wide mb-2" style={{ color: 'var(--text-muted)' }}>Header Style</p>
              <div className="flex gap-2">
                {HEADER_STYLES.map(hs => (
                  <button key={hs.id} onClick={() => update('header_style', hs.id as any)}
                    className="flex-1 py-2 px-2 rounded-xl text-center transition-all"
                    style={tpl.header_style === hs.id
                      ? { background: `${tpl.theme_color}22`, border: `1px solid ${tpl.theme_color}55`, color: tpl.theme_color }
                      : { background: 'var(--rgba-white-05)', border: '1px solid var(--glass-border)', color: 'var(--text-muted)' }}>
                    <div className="text-app-sm font-black">{hs.label}</div>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </Section>

      {/* Logo & Branding */}
      <Section id="branding" title="Logo & Branding" icon={<Building2 size={16} style={{ color: "var(--col-success)" }} />} open={section === 'branding'} onToggle={() => toggleSection('branding')}>
        <div className="pt-2 space-y-3">
          {/* Logo upload */}
          <div>
            <p className="text-app-sm font-black uppercase tracking-wide mb-2" style={{ color: 'var(--text-muted)' }}>Company Logo</p>
            {tpl.logo_base64 ? (
              <div className="flex items-center gap-3">
                <img src={tpl.logo_base64} alt="Logo" className="w-16 h-16 object-contain rounded-xl"
                  style={{ background: 'white', padding: 4 }} />
                <div className="flex flex-col gap-1.5">
                  <button onClick={() => logoRef.current?.click()}
                    className="text-app-sm font-bold px-3 py-1.5 rounded-lg"
                    style={{ background: 'var(--rgba-white-08)', color: 'var(--text-muted)' }}>
                    Change
                  </button>
                  <button onClick={() => update('logo_base64', '')}
                    className="text-app-sm font-bold px-3 py-1.5 rounded-lg flex items-center gap-1"
                    style={{ background: 'var(--col-danger-15)', color: "var(--col-danger)" }}>
                    <X size={10} /> Remove
                  </button>
                </div>
              </div>
            ) : (
              <button onClick={() => logoRef.current?.click()}
                className="w-full flex flex-col items-center gap-2 py-5 rounded-xl transition-all"
                style={{ border: '1.5px dashed var(--rgba-white-15)', background: 'var(--rgba-white-03)' }}>
                <Upload size={20} style={{ color: 'var(--text-muted)' }} />
                <span className="text-xs font-bold" style={{ color: 'var(--text-muted)' }}>Upload Logo (PNG/JPG, max 500KB)</span>
              </button>
            )}
            <input ref={logoRef} type="file" accept="image/*" className="hidden" onChange={handleLogo} />
          </div>
          {/* Invoice title */}
          <div>
            <p className="text-app-sm font-black uppercase tracking-wide mb-2" style={{ color: 'var(--text-muted)' }}>Invoice Title</p>
            <div className="relative">
              <button onClick={() => setShowTitleMenu(v => !v)}
                className="w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-sm font-bold"
                style={{ background: 'var(--rgba-white-08)', border: '1px solid var(--glass-border)', color: 'var(--text-primary)' }}>
                {tpl.invoice_title}
                <ChevronDown size={14} style={{ color: 'var(--text-muted)' }} />
              </button>
              {showTitleMenu && (
                <div className="absolute top-full left-0 right-0 mt-1 rounded-xl overflow-hidden z-10"
                  style={{ background: "var(--col-surface-dark)", border: '1px solid var(--glass-border)', boxShadow: '0 8px 32px var(--rgba-black-50)' }}>
                  {INVOICE_TITLES.map(title => (
                    <button key={title} onClick={() => { update('invoice_title', title); setShowTitleMenu(false); }}
                      className="w-full text-left px-3 py-2.5 text-xs font-bold transition-all hover:bg-white/5"
                      style={{ color: tpl.invoice_title === title ? "var(--col-violet)" : 'var(--text-secondary)' }}>
                      {title}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
          {/* Signatory */}
          <div>
            <p className="text-app-sm font-black uppercase tracking-wide mb-2" style={{ color: 'var(--text-muted)' }}>Authorized Signatory</p>
            <input value={tpl.authorized_signatory}
              onChange={e => update('authorized_signatory', e.target.value)}
              placeholder="Authorized Signatory"
              className="w-full text-sm font-bold px-3 py-2.5 rounded-xl outline-none"
              style={{ background: 'var(--rgba-white-08)', border: '1px solid var(--glass-border)', color: 'var(--text-primary)' }} />
          </div>
          {/* Font customisation */}
          <div className="space-y-4">
            {/* Base font size slider */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <p className="text-app-sm font-black uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>Base Font Size</p>
                <span className="text-xs font-black" style={{ color: "var(--col-violet)" }}>{tpl.base_font_size ?? 12} pt</span>
              </div>
              <input type="range" min={8} max={16} step={1}
                value={tpl.base_font_size ?? 12}
                onChange={e => update('base_font_size', Number(e.target.value))}
                className="w-full accent-violet-500" />
              <div className="flex justify-between text-app-xs mt-1" style={{ color: 'var(--text-muted)' }}>
                <span>8 pt (compact)</span><span>12 pt (default)</span><span>16 pt (large)</span>
              </div>
              <p className="text-app-xs mt-1" style={{ color: 'var(--text-muted)' }}>All text in the PDF scales proportionally from this base size.</p>
            </div>
            {/* Font family */}
            <div>
              <p className="text-app-sm font-black uppercase tracking-wide mb-2" style={{ color: 'var(--text-muted)' }}>Font Style</p>
              <div className="flex gap-2">
                {[{ id: 'helvetica', label: 'Sans-Serif', sample: 'Aa' }, { id: 'times', label: 'Serif', sample: 'Aa' }, { id: 'courier', label: 'Monospace', sample: 'Aa' }].map(f => (
                  <button key={f.id} onClick={() => update('font_family', f.id)}
                    className="flex-1 py-2.5 rounded-xl text-center transition-all"
                    style={(tpl.font_family || 'helvetica') === f.id
                      ? { background: 'var(--col-violet-25)', color: "var(--col-violet)", border: '1px solid var(--col-violet-40)' }
                      : { background: 'var(--rgba-white-05)', color: 'var(--text-muted)', border: '1px solid var(--glass-border)' }}>
                    <div className="text-sm font-bold" style={{ fontFamily: f.id === 'helvetica' ? 'sans-serif' : f.id === 'times' ? 'serif' : 'monospace' }}>{f.sample}</div>
                    <div className="text-app-xs font-black mt-0.5">{f.label}</div>
                  </button>
                ))}
              </div>
            </div>
            {/* Legacy quick-size chips kept for backward compat */}
            <div className="flex gap-2">
              {FONT_SIZES.map(fs => (
                <button key={fs.id} onClick={() => {
                  update('font_size', fs.id as any);
                  update('base_font_size', fs.id === 'small' ? 10 : fs.id === 'large' ? 14 : 12);
                }}
                  className="flex-1 py-2 rounded-xl text-app-sm font-black transition-all"
                  style={tpl.font_size === fs.id
                    ? { background: 'var(--col-violet-25)', color: "var(--col-violet)", border: '1px solid var(--col-violet-40)' }
                    : { background: 'var(--rgba-white-05)', color: 'var(--text-muted)', border: '1px solid var(--glass-border)' }}>
                  {fs.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </Section>

      {/* Field toggles */}
      <Section id="fields" title="Fields & Sections" icon={<Sliders size={16} style={{ color: "var(--col-warning)" }} />} open={section === 'fields'} onToggle={() => toggleSection('fields')}>
        <div className="pt-1 divide-y" style={{ borderColor: 'var(--rgba-white-05)' }}>
          <Toggle checked={tpl.show_logo}         onChange={v => update('show_logo', v)}         label="Show Logo"          desc="Display company logo in header" />
          <Toggle checked={tpl.show_gstin}        onChange={v => update('show_gstin', v)}        label="Show GSTIN"         desc="GSTIN of your firm + buyer" />
          <Toggle checked={tpl.show_vehicle}      onChange={v => update('show_vehicle', v)}      label="Show Vehicle Info"  desc="Vehicle no. & rent on invoice" />
          <Toggle checked={tpl.show_bank_details} onChange={v => update('show_bank_details', v)} label="Show Bank Details"  desc="Account no. / UPI for payment" />
          <Toggle checked={tpl.show_qr}           onChange={v => update('show_qr', v)}           label="Show UPI QR Code"   desc="QR code for instant payment" />
          <Toggle checked={tpl.show_signature}    onChange={v => update('show_signature', v)}    label="Show Signature Box" desc="Authorized signatory field" />
          <Toggle checked={tpl.show_terms}        onChange={v => update('show_terms', v)}        label="Show Terms"         desc="Terms & conditions footer" />
        </div>
      </Section>

      {/* Terms & bank details */}
      <Section id="content" title="Terms & Bank Details" icon={<CreditCard size={16} style={{ color: "var(--col-orange)" }} />} open={section === 'content'} onToggle={() => toggleSection('content')}>
        <div className="pt-2 space-y-3">
          {tpl.show_terms && (
            <div>
              <p className="text-app-sm font-black uppercase tracking-wide mb-2" style={{ color: 'var(--text-muted)' }}>Terms & Conditions</p>
              <textarea value={tpl.terms_text}
                onChange={e => update('terms_text', e.target.value)}
                rows={3}
                className="w-full text-xs font-semibold px-3 py-2.5 rounded-xl outline-none resize-none"
                style={{ background: 'var(--rgba-white-08)', border: '1px solid var(--glass-border)', color: 'var(--text-secondary)' }}
                placeholder="E.g. Goods once sold will not be taken back…" />
            </div>
          )}
          {tpl.show_bank_details && (
            <div>
              <p className="text-app-sm font-black uppercase tracking-wide mb-2" style={{ color: 'var(--text-muted)' }}>Bank / UPI Details</p>
              <textarea value={tpl.bank_details}
                onChange={e => update('bank_details', e.target.value)}
                rows={3}
                className="w-full text-xs font-semibold px-3 py-2.5 rounded-xl outline-none resize-none"
                style={{ background: 'var(--rgba-white-08)', border: '1px solid var(--glass-border)', color: 'var(--text-secondary)' }}
                placeholder="Bank: SBI&#10;A/C: 1234567890&#10;IFSC: SBIN0000123&#10;UPI: firm@upi" />
            </div>
          )}
        </div>
      </Section>

      {/* Save button */}
      <button onClick={save} disabled={saving}
        className="w-full py-4 rounded-2xl font-black text-sm flex items-center justify-center gap-2 active:scale-95 transition-all"
        style={{ background: 'linear-gradient(135deg,#4f46e5,#7c3aed)', color: 'white', boxShadow: '0 8px 24px var(--col-indigo-40)' }}>
        {saving ? <><div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />Saving…</> : <><Check size={16} /> Save Template</>}
      </button>
    </div>
  );
};

export default InvoiceTemplateSettings;






