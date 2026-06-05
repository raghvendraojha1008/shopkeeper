import React, { useState } from 'react';
import { 
    User, Store, MapPin, Phone, Hash, Globe, 
    List, Plus, Trash2, Shield, Lock, Smartphone, 
    Sun, Moon, Bell, IndianRupee, Mail, Key, Palette, Image as ImageIcon, FileSignature, MessageSquare,
    Zap, Home, Calendar, LayoutList
} from 'lucide-react';
import { updatePassword, reauthenticateWithCredential, EmailAuthProvider } from 'firebase/auth'; 
import { SettingsSection, SettingInput, LoadingButton } from './SettingsCommon';
import { GSTService } from '../../services/gstApi';
import { useUI } from '../../context/UIContext';
import { useAuth } from '../../context/AuthContext';
import { getPinStrength, getPasswordStrength } from '../../utils/passwordStrength';
import { auth } from '../../config/firebase'; 
import { ThemePicker } from './ThemePicker';

export const ProfileTab = ({ formData, setFormData, userEmail }: any) => {
    const { showToast } = useUI();
    const [gstFetching, setGstFetching] = useState(false);
    const [gstStatus, setGstStatus]     = useState<string>('');
    const fileInputRef = React.useRef<HTMLInputElement>(null);

    // FIX: already uses functional updater — correct pattern
    const updateProfile = (patch: any) => {
        setFormData((prev: any) => ({
            ...prev,
            profile: { ...(prev.profile || {}), ...patch }
        }));
    };

    const handleLogoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        // Check file size (max 500KB)
        if (file.size > 500 * 1024) {
            showToast('Logo size must be less than 500KB', 'error');
            return;
        }

        const reader = new FileReader();
        reader.onload = (event) => {
            const base64 = event.target?.result as string;
            updateProfile({ logo_base64: base64 });
            showToast('Logo uploaded successfully', 'success');
        };
        reader.readAsDataURL(file);
    };

    const handleFetchGST = async () => {
        const gstin = formData.profile?.gstin;
        if (!gstin || gstin.length !== 15) return showToast('Invalid GSTIN', 'error');
        setGstFetching(true);
        setGstStatus('');
        try {
            const data = await GSTService.fetchDetails(gstin);
            if (data) {
                updateProfile({
                    firm_name: data.tradeName || formData.profile?.firm_name,
                    address: data.address || formData.profile?.address,
                    owner_name: data.legalName || formData.profile?.owner_name
                });
                setGstStatus(data.status || '');
                showToast('Business Details Fetched', 'success');
            }
        } catch (e) {
            showToast('Failed to fetch GST details', 'error');
        } finally {
            setGstFetching(false);
        }
    };

    return (
        <div className="space-y-4 animate-in slide-in-from-right duration-300">
            <SettingsSection title="Business Identity" icon={Store}>
                <div className="mb-4">
                    <SettingInput 
                        label="Registered Email" 
                        value={userEmail || ''} 
                        onChange={() => {}} 
                        icon={Mail} 
                        disabled={true} 
                    />
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="relative">
                        <SettingInput 
                            label="GSTIN (Optional)" 
                            value={formData.profile?.gstin || ''} 
                            onChange={(v: string) => { updateProfile({ gstin: v.toUpperCase() }); setGstStatus(''); }} 
                            placeholder="22AAAAA0000A1Z5"
                            icon={Hash}
                        />
                        <button 
                            type="button"
                            onClick={handleFetchGST}
                            disabled={gstFetching || !formData.profile?.gstin}
                            className="absolute right-2 top-8 text-[10px] font-bold bg-blue-100 text-blue-600 px-2 py-1 rounded-lg disabled:opacity-50"
                        >
                            {gstFetching ? 'Fetching...' : 'Auto-Fill'}
                        </button>
                        {/* GST Status badge */}
                        {gstStatus && (
                            <div className="flex items-center gap-2 mt-1.5">
                                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-black"
                                    style={
                                        gstStatus.toLowerCase() === 'active'
                                            ? { background: 'rgba(16,185,129,0.12)', color: '#34d399', border: '1px solid rgba(16,185,129,0.25)' }
                                            : { background: 'rgba(239,68,68,0.1)',  color: '#f87171', border: '1px solid rgba(239,68,68,0.22)' }
                                    }>
                                    <span className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                                        style={{ background: gstStatus.toLowerCase() === 'active' ? '#34d399' : '#f87171' }} />
                                    GST: {gstStatus}
                                </span>
                            </div>
                        )}
                    </div>
                    <SettingInput label="Business Name" value={formData.profile?.firm_name || ''} onChange={(v: string) => updateProfile({ firm_name: v })} icon={Store} placeholder="My Shop Name" />
                    <SettingInput label="Owner Name" value={formData.profile?.owner_name || ''} onChange={(v: string) => updateProfile({ owner_name: v })} icon={User} placeholder="Your Name" />
                    <SettingInput label="Phone Number" value={formData.profile?.contact || ''} onChange={(v: string) => updateProfile({ contact: v })} icon={Phone} placeholder="+91 9876543210" />
                </div>
                <SettingInput label="Email" value={formData.profile?.email || ''} onChange={(v: string) => updateProfile({ email: v })} icon={Mail} placeholder="business@example.com" />
                <SettingInput label="Business Address" value={formData.profile?.address || ''} onChange={(v: string) => updateProfile({ address: v })} icon={MapPin} placeholder="Full Address" />
                <SettingInput label="Website / Link" value={formData.profile?.website || ''} onChange={(v: string) => updateProfile({ website: v })} icon={Globe} placeholder="https://myshop.com" />
            </SettingsSection>

            <SettingsSection title="Invoice & Printing Settings" icon={FileSignature}>
                {/* Business Logo Upload */}
                <div className="mb-4">
                    <label className="text-xs font-bold text-[rgba(203,213,225,0.75)] block mb-2">Business Logo (Max 500KB)</label>
                    <div className="flex gap-3 items-center">
                        {formData.profile?.logo_base64 && (
                            <img 
                                src={formData.profile.logo_base64} 
                                alt="Logo Preview" 
                                className="w-20 h-20 object-contain rounded-lg p-2"
                            />
                        )}
                        <button
                            type="button"
                            onClick={() => fileInputRef.current?.click()}
                            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-bold transition-colors active:scale-95"
                        >
                            <ImageIcon className="inline mr-2" size={16} />
                            {formData.profile?.logo_base64 ? 'Change Logo' : 'Upload Logo'}
                        </button>
                        {formData.profile?.logo_base64 && (
                            <button
                                type="button"
                                onClick={() => updateProfile({ logo_base64: undefined })}
                                className="px-4 py-2 bg-red-100 hover:bg-red-200 text-red-600 rounded-lg text-sm font-bold transition-colors"
                            >
                                Remove
                            </button>
                        )}
                    </div>
                    <input 
                        ref={fileInputRef}
                        type="file" 
                        accept="image/*" 
                        onChange={handleLogoUpload}
                        className="hidden"
                    />
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <SettingInput 
                        label="Authorized Signatory Name" 
                        value={formData.profile?.authorized_signatory || ''} 
                        onChange={(v: string) => updateProfile({ authorized_signatory: v })} 
                        icon={FileSignature}
                        placeholder="Name of person authorized to sign"
                    />
                    <SettingInput 
                        label="Business Email (For Invoices)" 
                        value={formData.profile?.business_email || ''} 
                        onChange={(v: string) => updateProfile({ business_email: v })} 
                        icon={Mail}
                        placeholder="contact@business.com"
                    />
                </div>

                <div className="mt-4 p-3 bg-[rgba(59,130,246,0.08)] rounded-lg border border-[rgba(59,130,246,0.2)]">
                    <p className="text-xs text-[#93c5fd]">
                        Authorized Signatory Name and Business Email set here will override any template defaults on all generated invoices and receipts. Leave blank to use the template default.
                    </p>
                </div>
            </SettingsSection>
        </div>
    );
};

export const GeneralTab = ({ formData, setFormData }: any) => {
    // FIX: use functional updater (prev =>) instead of stale closure spread
    const updatePreferences = (patch: any) => {
        setFormData((prev: any) => ({
            ...prev,
            preferences: {
                ...(prev.preferences || {}),
                ...patch,
            },
        }));
    };

    const updateAutomation = (patch: any) => {
        setFormData((prev: any) => ({
            ...prev,
            automation: {
                ...(prev.automation || {}),
                ...patch,
            },
        }));
    };

    return (
        <div className="space-y-4 animate-in slide-in-from-right duration-300">
            <SettingsSection title="App Preferences" icon={Store}>
                {/* DISPLAY_MODE_HIDDEN: set FORCE_DARK_MODE=false in App.tsx to re-enable this toggle */}
                {false && (
                <div className="flex items-center justify-between p-2 border-b border-white/07 pb-4">
                    <div className="flex items-center gap-3">
                        <div className="p-2 rounded-lg" style={{ background: formData.preferences?.dark_mode ? 'rgba(139,92,246,0.15)' : 'rgba(251,191,36,0.15)' }}>
                            {formData.preferences?.dark_mode
                                ? <Moon size={20} style={{ color: '#a78bfa' }} />
                                : <Sun size={20} style={{ color: '#fbbf24' }} />
                            }
                        </div>
                        <div>
                            <div className="font-bold text-sm" style={{ color: 'rgba(226,232,240,0.88)' }}>Display Mode</div>
                            <div className="text-xs" style={{ color: 'rgba(148,163,184,0.45)' }}>
                                {formData.preferences?.dark_mode ? 'Dark mode active' : 'Light mode active'}
                            </div>
                        </div>
                    </div>
                    <div className="flex p-1 rounded-2xl gap-1" style={{ background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.08)' }}>
                        <button
                            type="button"
                            onClick={() => updatePreferences({ dark_mode: false })}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-black transition-all active:scale-95"
                            style={!formData.preferences?.dark_mode
                                ? { background: 'rgba(255,255,255,0.92)', color: '#1e293b', boxShadow: '0 1px 6px rgba(0,0,0,0.18)' }
                                : { color: 'rgba(148,163,184,0.5)' }
                            }
                        >
                            <Sun size={13} /> Light
                        </button>
                        <button
                            type="button"
                            onClick={() => updatePreferences({ dark_mode: true })}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-black transition-all active:scale-95"
                            style={formData.preferences?.dark_mode
                                ? { background: 'rgba(30,20,60,0.85)', color: '#a78bfa', boxShadow: '0 1px 6px rgba(0,0,0,0.3)', border: '1px solid rgba(139,92,246,0.3)' }
                                : { color: 'rgba(148,163,184,0.5)' }
                            }
                        >
                            <Moon size={13} /> Dark
                        </button>
                    </div>
                </div>
                )}

                <div className="flex items-center justify-between p-2 border-b border-white/07 pb-4 pt-4">
                    <div className="flex items-center gap-3">
                        <div className="p-2 rounded-lg bg-[rgba(245,158,11,0.15)] text-[#fbbf24]"><Bell size={20}/></div>
                        <div>
                            <div className="font-bold text-sm text-[rgba(226,232,240,0.88)]">Notifications</div>
                            <div className="text-xs text-[rgba(148,163,184,0.45)]">Payment reminders & alerts</div>
                        </div>
                    </div>
                    <label className="relative inline-flex items-center cursor-pointer">
                        <input 
                            type="checkbox" 
                            className="sr-only peer" 
                            checked={!!formData.notifications_enabled} 
                            onChange={e => { const v = e.target.checked; setFormData((prev: any) => ({...prev, notifications_enabled: v})); }} 
                        />
                        <div className="w-11 h-6 bg-[rgba(255,255,255,0.1)] border border-white/10 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-amber-500"></div>
                    </label>
                </div>

                {/* ── Auto WhatsApp Reminder ─────────────────────────────── */}
                <div className="flex items-center justify-between p-2 border-b border-white/07 pb-4 pt-4">
                    <div className="flex items-center gap-3">
                        <div className="p-2 rounded-lg bg-[rgba(34,197,94,0.15)] text-[#4ade80]">
                            <MessageSquare size={20}/>
                        </div>
                        <div>
                            <div className="font-bold text-sm text-[rgba(226,232,240,0.88)]">Auto WhatsApp Reminders</div>
                            <div className="text-xs text-[rgba(148,163,184,0.45)]">Daily alert for overdue customers</div>
                        </div>
                    </div>
                    <label className="relative inline-flex items-center cursor-pointer">
                        <input
                            type="checkbox"
                            className="sr-only peer"
                            checked={!!formData.automation?.auto_reminder_enabled}
                            onChange={e => updateAutomation({ auto_reminder_enabled: e.target.checked })}
                        />
                        <div className="w-11 h-6 bg-[rgba(255,255,255,0.1)] border border-white/10 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-green-500"></div>
                    </label>
                </div>

                {/* Reminder period selector — only visible when reminder is enabled */}
                {!!formData.automation?.auto_reminder_enabled && (
                    <div className="px-2 pt-3 pb-1">
                        <label className="block text-xs font-bold text-[rgba(148,163,184,0.6)] mb-2">
                            Reminder Period (days overdue)
                        </label>
                        <div className="flex gap-2 flex-wrap">
                            {[7, 10, 15, 21, 30].map(d => (
                                <button
                                    key={d}
                                    type="button"
                                    onClick={() => updateAutomation({ auto_reminder_days: d })}
                                    className="px-4 py-2 rounded-xl text-sm font-black transition-all active:scale-95"
                                    style={
                                        (formData.automation?.auto_reminder_days ?? 15) === d
                                            ? { background: 'rgba(34,197,94,0.2)', border: '1.5px solid rgba(74,222,128,0.5)', color: '#4ade80' }
                                            : { background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: 'rgba(148,163,184,0.6)' }
                                    }>
                                    {d}d
                                </button>
                            ))}
                        </div>
                        <p className="text-xs text-[rgba(148,163,184,0.4)] mt-2">
                            Notify daily if any customer has dues pending for this many days or more.
                        </p>
                    </div>
                )}

                <div className="pt-4 px-2">
                    <SettingInput
                        label="Currency Symbol"
                        value={formData.currency_symbol || '₹'}
                        onChange={(v: string) => setFormData((prev: any) => ({...prev, currency_symbol: v}))}
                        icon={IndianRupee}
                        placeholder="₹"
                    />
                </div>

                {/* GST View Toggle */}
                <div className="flex items-center justify-between p-2 border-b border-white/07 pb-4 pt-4">
                    <div className="flex items-center gap-3">
                        <div className="p-2 rounded-lg bg-[rgba(59,130,246,0.15)] text-[#60a5fa]"><Hash size={20}/></div>
                        <div>
                            <div className="font-bold text-sm text-[rgba(226,232,240,0.88)]">GST View</div>
                            <div className="text-xs text-[rgba(148,163,184,0.45)]">Show GSTIN, CGST/SGST across app</div>
                        </div>
                    </div>
                    <label className="relative inline-flex items-center cursor-pointer">
                        <input 
                            type="checkbox" 
                            className="sr-only peer" 
                            checked={!!formData.automation?.auto_calculate_gst} 
                            onChange={e => updateAutomation({ auto_calculate_gst: e.target.checked })} 
                        />
                        <div className="w-11 h-6 bg-[rgba(255,255,255,0.1)] border border-white/10 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-violet-600"></div>
                    </label>
                </div>

                {/* Auto Payment Distribution Toggle */}
                <div className="flex items-center justify-between p-2 border-b border-white/07 pb-4 pt-4">
                    <div className="flex items-center gap-3">
                        <div className="p-2 rounded-lg bg-[rgba(16,185,129,0.15)] text-[#34d399]"><IndianRupee size={20}/></div>
                        <div>
                            <div className="font-bold text-sm text-[rgba(226,232,240,0.88)]">Auto Payment Distribution</div>
                            <div className="text-xs text-[rgba(148,163,184,0.45)]">Distribute unlinked payments to orders (FIFO)</div>
                        </div>
                    </div>
                    <label className="relative inline-flex items-center cursor-pointer">
                        <input
                            type="checkbox"
                            className="sr-only peer"
                            checked={formData.automation?.auto_distribute_payments !== false}
                            onChange={e => updateAutomation({ auto_distribute_payments: e.target.checked })}
                        />
                        <div className="w-11 h-6 bg-[rgba(255,255,255,0.1)] border border-white/10 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-emerald-600"></div>
                    </label>
                </div>

                {/* ── Dynamic Navigation ─────────────────────────────────── */}
                <div className="flex items-center justify-between p-2 pt-4">
                    <div className="flex items-center gap-3">
                        <div className="p-2 rounded-lg bg-[rgba(99,102,241,0.15)] text-[#818cf8]">
                            <Smartphone size={20}/>
                        </div>
                        <div>
                            <div className="font-bold text-sm text-[rgba(226,232,240,0.88)]">Dynamic Navigation</div>
                            <div className="text-xs text-[rgba(148,163,184,0.45)]">Auto-hide bottom bar on detail pages</div>
                        </div>
                    </div>
                    <label className="relative inline-flex items-center cursor-pointer">
                        <input
                            type="checkbox"
                            className="sr-only peer"
                            checked={formData.preferences?.dynamic_nav !== false}
                            onChange={e => updatePreferences({ dynamic_nav: e.target.checked })}
                        />
                        <div className="w-11 h-6 bg-[rgba(255,255,255,0.1)] border border-white/10 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-indigo-500"></div>
                    </label>
                </div>
            </SettingsSection>

            {/* ── Privacy: Hide Amounts ──────────────────────────────────────── */}
            <SettingsSection title="Privacy" icon={Shield}>
                <div className="flex items-center justify-between p-2">
                    <div className="flex items-center gap-3">
                        <div className="p-2 rounded-lg bg-[rgba(99,102,241,0.15)] text-[#818cf8]">
                            <Moon size={20}/>
                        </div>
                        <div>
                            <div className="font-bold text-sm text-[rgba(226,232,240,0.88)]">Hide Amounts on Dashboard</div>
                            <div className="text-xs text-[rgba(148,163,184,0.45)]">Replace monetary values with ••••</div>
                        </div>
                    </div>
                    <label className="relative inline-flex items-center cursor-pointer">
                        <input
                            type="checkbox"
                            className="sr-only peer"
                            checked={!!formData.preferences?.hide_amounts}
                            onChange={e => updatePreferences({ hide_amounts: e.target.checked })}
                        />
                        <div className="w-11 h-6 bg-[rgba(255,255,255,0.1)] border border-white/10 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-indigo-500"></div>
                    </label>
                </div>
            </SettingsSection>

            {/* ── Invoice Print Format ───────────────────────────────────────── */}
            <SettingsSection title="Invoice Print Format" icon={List}>
                <div className="px-2 py-1">
                    <p className="text-xs font-bold text-[rgba(148,163,184,0.6)] mb-3">
                        Default paper size used when printing invoices
                    </p>
                    <div className="grid grid-cols-3 gap-2">
                        {([
                            { value: 'standard',  label: 'A4 / Letter'  },
                            { value: 'thermal58', label: '58 mm Thermal' },
                            { value: 'thermal80', label: '80 mm Thermal' },
                        ] as { value: string; label: string }[]).map(opt => {
                            const active = (formData.preferences?.print_format ?? 'standard') === opt.value;
                            return (
                                <button
                                    key={opt.value}
                                    onClick={() => updatePreferences({ print_format: opt.value })}
                                    className="py-2.5 rounded-xl font-bold text-xs active:scale-95 transition-all"
                                    style={{
                                        background: active ? 'rgba(99,102,241,0.25)' : 'rgba(255,255,255,0.05)',
                                        border: `1px solid ${active ? 'rgba(99,102,241,0.5)' : 'rgba(255,255,255,0.08)'}`,
                                        color: active ? '#a5b4fc' : 'rgba(148,163,184,0.6)',
                                    }}
                                >
                                    {opt.label}
                                </button>
                            );
                        })}
                    </div>
                </div>
            </SettingsSection>

            {/* ── Default Payment Mode ──────────────────────────────────────── */}
            <SettingsSection title="Default Payment Mode" icon={Smartphone}>
                <div className="px-2 py-1">
                    <p className="text-xs font-bold text-[rgba(148,163,184,0.6)] mb-3">
                        Pre-selected payment mode when adding new transactions
                    </p>
                    <div className="flex flex-wrap gap-2">
                        {(['Cash', 'UPI', 'Bank Transfer', 'Cheque', 'Card', 'Credit'] as string[]).map(mode => {
                            const active = (formData.preferences?.default_payment_mode ?? 'Cash') === mode;
                            return (
                                <button
                                    key={mode}
                                    onClick={() => updatePreferences({ default_payment_mode: mode })}
                                    className="px-3 py-1.5 rounded-xl font-bold text-xs active:scale-95 transition-all"
                                    style={{
                                        background: active ? 'rgba(99,102,241,0.25)' : 'rgba(255,255,255,0.05)',
                                        border: `1px solid ${active ? 'rgba(99,102,241,0.5)' : 'rgba(255,255,255,0.08)'}`,
                                        color: active ? '#a5b4fc' : 'rgba(148,163,184,0.6)',
                                    }}
                                >
                                    {mode}
                                </button>
                            );
                        })}
                    </div>
                </div>
            </SettingsSection>

            {/* ── Low Stock Threshold ───────────────────────────────────────── */}
            <SettingsSection title="Low Stock Threshold" icon={Bell}>
                <div className="px-2 py-1">
                    <p className="text-xs font-bold text-[rgba(148,163,184,0.6)] mb-3">
                        Warn when inventory quantity falls at or below this number
                    </p>
                    <div className="flex gap-2 items-center">
                        <input
                            type="number"
                            min={0}
                            max={9999}
                            value={formData.preferences?.low_stock_threshold ?? 5}
                            onChange={e => updatePreferences({ low_stock_threshold: Math.max(0, parseInt(e.target.value) || 0) })}
                            className="w-24 py-2 px-3 rounded-xl font-black text-sm text-white outline-none text-center"
                            style={{ background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.12)' }}
                        />
                        <span className="text-xs text-[rgba(148,163,184,0.5)]">units</span>
                    </div>
                </div>
            </SettingsSection>

            {/* ── Default Filter Period ──────────────────────────────── */}
            <SettingsSection title="Default Date Filter" icon={List}>
                <div className="px-2 py-1">
                    <p className="text-xs font-bold text-[rgba(148,163,184,0.6)] mb-3">
                        Default date range shown in Expenses, Transactions and Reports
                    </p>
                    <div className="grid grid-cols-2 gap-2">
                        {([
                            { value: 'all',                   label: 'All Time'           },
                            { value: 'current_month',         label: 'Current Month'      },
                            { value: 'current_year',          label: 'Current Year'       },
                            { value: 'current_business_year', label: 'Business Year'      },
                        ] as const).map(opt => {
                            const active = (formData.automation?.default_filter_period ?? 'all') === opt.value;
                            return (
                                <button
                                    key={opt.value}
                                    type="button"
                                    onClick={() => updateAutomation({ default_filter_period: opt.value })}
                                    className="px-3 py-2.5 rounded-xl text-xs font-black transition-all active:scale-95 text-left"
                                    style={
                                        active
                                            ? { background: 'rgba(99,102,241,0.2)', border: '1.5px solid rgba(99,102,241,0.5)', color: '#a5b4fc' }
                                            : { background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: 'rgba(148,163,184,0.6)' }
                                    }>
                                    {opt.label}
                                </button>
                            );
                        })}
                    </div>
                    <p className="text-[10px] text-[rgba(148,163,184,0.4)] mt-2">
                        "Business Year" uses your Financial Year Start from Firm Profile (defaults to April).
                    </p>
                </div>
            </SettingsSection>

            {/* ── Haptic Feedback ───────────────────────────────────────────── */}
            <SettingsSection title="Haptic Feedback" icon={Zap}>
                <div className="flex items-center justify-between p-2">
                    <div className="flex items-center gap-3">
                        <div className="p-2 rounded-lg bg-[rgba(245,158,11,0.15)] text-[#fbbf24]"><Zap size={20}/></div>
                        <div>
                            <div className="font-bold text-sm text-[rgba(226,232,240,0.88)]">Vibration on Actions</div>
                            <div className="text-xs text-[rgba(148,163,184,0.45)]">Tactile feedback on taps and confirmations</div>
                        </div>
                    </div>
                    <label className="relative inline-flex items-center cursor-pointer">
                        <input
                            type="checkbox"
                            className="sr-only peer"
                            checked={formData.preferences?.haptics_enabled !== false}
                            onChange={e => {
                                const v = e.target.checked;
                                updatePreferences({ haptics_enabled: v });
                                localStorage.setItem('haptics_enabled', v ? 'true' : 'false');
                            }}
                        />
                        <div className="w-11 h-6 bg-[rgba(255,255,255,0.1)] border border-white/10 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-amber-500"></div>
                    </label>
                </div>
            </SettingsSection>

            {/* ── Confirm Before Delete ─────────────────────────────────────── */}
            <SettingsSection title="Delete Confirmation" icon={Shield}>
                <div className="flex items-center justify-between p-2">
                    <div className="flex items-center gap-3">
                        <div className="p-2 rounded-lg bg-[rgba(239,68,68,0.15)] text-[#f87171]"><Shield size={20}/></div>
                        <div>
                            <div className="font-bold text-sm text-[rgba(226,232,240,0.88)]">Confirm Before Delete</div>
                            <div className="text-xs text-[rgba(148,163,184,0.45)]">Show extra confirmation dialog on every delete</div>
                        </div>
                    </div>
                    <label className="relative inline-flex items-center cursor-pointer">
                        <input
                            type="checkbox"
                            className="sr-only peer"
                            checked={formData.preferences?.confirm_before_delete !== false}
                            onChange={e => updatePreferences({ confirm_before_delete: e.target.checked })}
                        />
                        <div className="w-11 h-6 bg-[rgba(255,255,255,0.1)] border border-white/10 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-red-500"></div>
                    </label>
                </div>
            </SettingsSection>

            {/* ── Default Landing Tab ───────────────────────────────────────── */}
            <SettingsSection title="Default Landing Tab" icon={Home}>
                <div className="px-2 py-1">
                    <p className="text-xs font-bold text-[rgba(148,163,184,0.6)] mb-3">
                        Which tab opens when you launch the app
                    </p>
                    <div className="grid grid-cols-3 gap-2">
                        {([
                            { value: 'dashboard',    label: 'Dashboard'    },
                            { value: 'ledger',       label: 'Ledger'       },
                            { value: 'transactions', label: 'Transactions' },
                            { value: 'inventory',    label: 'Inventory'    },
                            { value: 'parties',      label: 'Parties'      },
                            { value: 'expenses',     label: 'Expenses'     },
                        ] as const).map(opt => {
                            const active = (formData.preferences?.default_tab ?? 'dashboard') === opt.value;
                            return (
                                <button
                                    key={opt.value}
                                    type="button"
                                    onClick={() => updatePreferences({ default_tab: opt.value })}
                                    className="py-2 rounded-xl text-xs font-black transition-all active:scale-95"
                                    style={
                                        active
                                            ? { background: 'rgba(99,102,241,0.2)', border: '1.5px solid rgba(99,102,241,0.5)', color: '#a5b4fc' }
                                            : { background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)', color: 'rgba(148,163,184,0.5)' }
                                    }>
                                    {opt.label}
                                </button>
                            );
                        })}
                    </div>
                </div>
            </SettingsSection>

            {/* ── Compact List View ─────────────────────────────────────────── */}
            <SettingsSection title="List Density" icon={LayoutList}>
                <div className="flex items-center justify-between p-2">
                    <div className="flex items-center gap-3">
                        <div className="p-2 rounded-lg bg-[rgba(99,102,241,0.15)] text-[#818cf8]"><LayoutList size={20}/></div>
                        <div>
                            <div className="font-bold text-sm text-[rgba(226,232,240,0.88)]">Compact View</div>
                            <div className="text-xs text-[rgba(148,163,184,0.45)]">Smaller list items to show more on screen</div>
                        </div>
                    </div>
                    <label className="relative inline-flex items-center cursor-pointer">
                        <input
                            type="checkbox"
                            className="sr-only peer"
                            checked={!!formData.preferences?.compact_view}
                            onChange={e => updatePreferences({ compact_view: e.target.checked })}
                        />
                        <div className="w-11 h-6 bg-[rgba(255,255,255,0.1)] border border-white/10 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-indigo-500"></div>
                    </label>
                </div>
            </SettingsSection>

            {/* ── Date Display Format ───────────────────────────────────────── */}
            <SettingsSection title="Date Display Format" icon={Calendar}>
                <div className="px-2 py-1">
                    <p className="text-xs font-bold text-[rgba(148,163,184,0.6)] mb-3">
                        How dates appear across the app
                    </p>
                    <div className="grid grid-cols-3 gap-2">
                        {([
                            { value: 'DD/MM/YYYY',   label: 'DD/MM/YYYY'   },
                            { value: 'DD-MMM-YYYY',  label: 'DD-MMM-YYYY'  },
                            { value: 'DD/MM/YY',     label: 'DD/MM/YY'     },
                        ] as const).map(opt => {
                            const active = (formData.preferences?.date_format ?? 'DD/MM/YYYY') === opt.value;
                            return (
                                <button
                                    key={opt.value}
                                    type="button"
                                    onClick={() => updatePreferences({ date_format: opt.value })}
                                    className="py-2.5 rounded-xl text-xs font-black transition-all active:scale-95"
                                    style={
                                        active
                                            ? { background: 'rgba(99,102,241,0.2)', border: '1.5px solid rgba(99,102,241,0.5)', color: '#a5b4fc' }
                                            : { background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)', color: 'rgba(148,163,184,0.5)' }
                                    }>
                                    {opt.label}
                                </button>
                            );
                        })}
                    </div>
                </div>
            </SettingsSection>

            <SettingsSection title="Theme" icon={Palette}>
                <div className="px-2">
                    <ThemePicker
                        value={formData.preferences?.theme}
                        onChange={(id) => updatePreferences({ theme: id })}
                        custom={formData.preferences?.custom_primary_hsl}
                        onChangeCustom={(hsl) => updatePreferences({ theme: 'custom', custom_primary_hsl: hsl })}
                    />
                    <p className="mt-3 text-[10px] text-slate-400 italic">
                        Tip: Choose a heartwarming color, then tap <span className="font-bold">Save</span>.
                    </p>
                </div>
            </SettingsSection>
        </div>
    );
};

export const ListsTab = ({ formData, setFormData }: any) => {
    const { confirm, showToast } = useUI();
    const [newItem, setNewItem] = useState('');
    const [activeList, setActiveList] = useState('payment_modes');

    const listTypes = [
        { id: 'payment_modes', label: 'Payment Modes' },
        { id: 'expense_types', label: 'Expense Categories' },
        { id: 'inventory_units', label: 'Item Units' },
        { id: 'vehicle_types', label: 'Vehicle Types' },
        { id: 'staff_members', label: 'Staff Members' },
        { id: 'purposes', label: 'Payment Purposes' },
        { id: 'charge_types', label: 'Handling Charges' },
    ];

    const handleAdd = () => {
        if (!newItem.trim()) return;
        const trimmed = newItem.trim();
        // FIX: functional updater to avoid stale closure
        setFormData((prev: any) => {
            const current = prev.custom_lists?.[activeList] || [];
            return {
                ...prev,
                custom_lists: {
                    ...prev.custom_lists,
                    [activeList]: [...current, trimmed]
                }
            };
        });
        setNewItem('');
        showToast('Item added', 'success');
    };

    const handleRemove = async (idx: number) => {
        const confirmed = await confirm('Delete Item', "Are you sure you want to delete this item?");
        if (!confirmed) return;

        // FIX: functional updater to avoid stale closure
        setFormData((prev: any) => {
            const current = prev.custom_lists?.[activeList] || [];
            return {
                ...prev,
                custom_lists: {
                    ...prev.custom_lists,
                    [activeList]: current.filter((_: any, i: number) => i !== idx)
                }
            };
        });
        showToast('Item deleted', 'success');
    };

    return (
        <div className="space-y-4 animate-in slide-in-from-right duration-300">
            <div className="flex overflow-x-auto pb-2 gap-2 scrollbar-hide">
                {listTypes.map(l => (
                    <button
                        key={l.id}
                        onClick={() => setActiveList(l.id)}
                        className={`px-4 py-2 rounded-xl text-xs font-bold whitespace-nowrap transition-colors ${activeList === l.id ? 'bg-violet-600/30 text-violet-300 border border-violet-500/30' : 'border border-white/10 text-slate-400'}`}
                    >
                        {l.label}
                    </button>
                ))}
            </div>

            <SettingsSection title={`Manage ${listTypes.find(l => l.id === activeList)?.label}`} icon={List}>
                <div className="flex gap-2 mb-4">
                    <input 
                        className="flex-1  border border-white/12 rounded-xl px-4 text-sm font-bold outline-none"
                        placeholder="Add new item..."
                        value={newItem}
                        onChange={e => setNewItem(e.target.value)}
                        onKeyDown={e => e.key === 'Enter' && handleAdd()}
                    />
                    <button onClick={handleAdd} className="bg-blue-600 text-white p-3 rounded-xl hover:bg-blue-700"><Plus size={20}/></button>
                </div>

                <div className="space-y-2 max-h-[300px] overflow-y-auto">
                    {(formData.custom_lists?.[activeList] || []).map((item: string, idx: number) => (
                        <div key={idx} className="flex justify-between items-center p-3 rounded-xl border border-white/10 group">
                            <span className="font-bold text-sm text-[rgba(203,213,225,0.75)]">{item}</span>
                            <button onClick={() => handleRemove(idx)} className="text-slate-400 hover:text-red-500 opacity-100 transition-opacity"><Trash2 size={16}/></button>
                        </div>
                    ))}
                    {(formData.custom_lists?.[activeList] || []).length === 0 && (
                        <div className="text-center py-8 text-slate-400 text-xs italic">No items in this list yet.</div>
                    )}
                </div>
            </SettingsSection>
        </div>
    );
};

export const SecurityTab = ({ formData, setFormData, user, onSave }: any) => {
    const { showToast } = useUI();
    const { sendPasswordReset } = useAuth();
    const isEmailPasswordUser = !!(user?.providerData?.some((p: any) => p.providerId === 'password'));
    const [passwordLoading, setPasswordLoading] = useState(false);
    const [showEditPwInput, setShowEditPwInput] = useState(false);
    const [newEditPw, setNewEditPw] = useState('');
    const [confirmEditPw, setConfirmEditPw] = useState('');
    const [currentEditPwInput, setCurrentEditPwInput] = useState('');
    const [showUpgradePwInput, setShowUpgradePwInput] = useState(false);
    const [currentUpgradePw, setCurrentUpgradePw] = useState('');
    const [newUpgradePw, setNewUpgradePw] = useState('');
    const [confirmUpgradePw, setConfirmUpgradePw] = useState('');
    const [showChangePinUi, setShowChangePinUi] = useState(false);
    const [currentAppPin, setCurrentAppPin] = useState('');
    const [newAppPin, setNewAppPin] = useState('');
    const [confirmAppPin, setConfirmAppPin] = useState('');
    const [forgotAppPinStep, setForgotAppPinStep] = useState<'idle' | 'sent'>('idle');
    const [forgotEditPwStep, setForgotEditPwStep] = useState<'idle' | 'sent'>('idle');
    const [forgotLoading, setForgotLoading] = useState(false);

    const updateSecurity = (field: string, value: any) => {
        setFormData((prev: any) => ({
            ...prev,
            security: {
                ...(prev.security || {}),
                [field]: value
            }
        }));
    };

    const updateEditPassword = (patch: any) => {
        setFormData((prev: any) => ({
            ...prev,
            edit_password: {
                enabled: true,
                password: '1234',
                ...(prev.edit_password || {}),
                ...patch,
            }
        }));
    };

    // ── Immediate save helper ─────────────────────────────────────────────────
    // Computes new settings via patchFn, updates local formData, and immediately
    // persists to Firebase via onSave — removing the need for a separate global
    // "Save" button click on the Security tab.
    const saveNow = async (patchFn: (prev: any) => any) => {
        const newSettings = patchFn(formData);
        setFormData(newSettings);
        if (!onSave) return;
        try {
            await onSave(newSettings);
        } catch {
            showToast('Save failed. Try again.', 'error');
        }
    };

    const handleSaveUpgradePassword = async () => {
        if (!currentUpgradePw) return showToast('Enter your current password first', 'error');
        if (!newUpgradePw) return showToast('New password cannot be empty', 'error');
        if (newUpgradePw.length < 6) return showToast('Password too short (min 6 chars)', 'error');
        if (newUpgradePw !== confirmUpgradePw) return showToast('Passwords do not match', 'error');
        if (!auth.currentUser || !auth.currentUser.email) return showToast('Not logged in', 'error');
        setPasswordLoading(true);
        try {
            const credential = EmailAuthProvider.credential(auth.currentUser.email, currentUpgradePw);
            await reauthenticateWithCredential(auth.currentUser, credential);
            await updatePassword(auth.currentUser, newUpgradePw);
            showToast('Login password updated successfully', 'success');
            setCurrentUpgradePw('');
            setNewUpgradePw('');
            setConfirmUpgradePw('');
            setShowUpgradePwInput(false);
        } catch (error: any) {
            console.error(error);
            if (error.code === 'auth/wrong-password' || error.code === 'auth/invalid-credential') {
                showToast('Current password is incorrect', 'error');
            } else {
                showToast(error.message || 'Failed to update password', 'error');
            }
        } finally {
            setPasswordLoading(false);
        }
    };

    const handleSaveAppPin = async () => {
        const existingPin = formData.security?.pin;
        if (existingPin && forgotAppPinStep !== 'sent') {
            if (!currentAppPin) return showToast('Enter your current PIN first', 'error');
            if (currentAppPin !== existingPin) return showToast('Current PIN is incorrect', 'error');
        }
        if (!newAppPin || newAppPin.length !== 4) return showToast('PIN must be exactly 4 digits', 'error');
        if (newAppPin !== confirmAppPin) return showToast('PINs do not match — please re-enter', 'error');
        await saveNow((prev: any) => ({
            ...prev,
            security: { ...(prev.security || {}), pin: newAppPin }
        }));
        setCurrentAppPin('');
        setNewAppPin('');
        setConfirmAppPin('');
        setShowChangePinUi(false);
        setForgotAppPinStep('idle');
        showToast('App lock PIN saved', 'success');
    };

    const handleSaveEditPassword = async () => {
        if (forgotEditPwStep !== 'sent') {
            if (!currentEditPwInput) return showToast('Enter your current password first', 'error');
            const existingPw = formData.edit_password?.password || '1234';
            if (currentEditPwInput !== existingPw) return showToast('Current password is incorrect', 'error');
        }
        if (!newEditPw) return showToast('New password cannot be empty', 'error');
        if (newEditPw !== confirmEditPw) return showToast('Passwords do not match', 'error');
        await saveNow((prev: any) => ({
            ...prev,
            edit_password: {
                enabled: true,
                password: '1234',
                ...(prev.edit_password || {}),
                password: newEditPw,
            }
        }));
        setCurrentEditPwInput('');
        setNewEditPw('');
        setConfirmEditPw('');
        setShowEditPwInput(false);
        setForgotEditPwStep('idle');
        showToast('Data edit password saved', 'success');
    };

    const handleForgotAppPin = async () => {
        const email = user?.email;
        if (!email) { showToast('No email on your account', 'error'); return; }
        setForgotLoading(true);
        try {
            await sendPasswordReset(email);
            setForgotAppPinStep('sent');
            showToast('Reset email sent!', 'success');
        } catch (e: any) {
            showToast(e.message || 'Failed to send reset email', 'error');
        } finally {
            setForgotLoading(false);
        }
    };

    const handleForgotEditPw = async () => {
        const email = user?.email;
        if (!email) { showToast('No email on your account', 'error'); return; }
        setForgotLoading(true);
        try {
            await sendPasswordReset(email);
            setForgotEditPwStep('sent');
            showToast('Reset email sent!', 'success');
        } catch (e: any) {
            showToast(e.message || 'Failed to send reset email', 'error');
        } finally {
            setForgotLoading(false);
        }
    };

    const isEditPwEnabled = formData.edit_password?.enabled !== false;
    const currentEditPw = formData.edit_password?.password || '1234';

    return (
        <div className="space-y-4 animate-in slide-in-from-right duration-300">
            <SettingsSection title="App Access" icon={Shield}>
                <div className="flex items-center justify-between p-2">
                    <div className="flex items-center gap-3">
                        <div className="p-2 rounded-lg bg-[rgba(139,92,246,0.15)] text-[#a78bfa]"><Lock size={20}/></div>
                        <div>
                            <div className="font-bold text-sm text-[rgba(226,232,240,0.88)]">App Lock</div>
                            <div className="text-xs text-[rgba(148,163,184,0.45)]">Require PIN on startup</div>
                        </div>
                    </div>
                    <label className="relative inline-flex items-center cursor-pointer">
                        <input
                            type="checkbox"
                            className="sr-only peer"
                            checked={!!formData.security?.enabled}
                            onChange={e => {
                                const enabled = e.target.checked;
                                void saveNow((prev: any) => ({
                                    ...prev,
                                    security: { ...(prev.security || {}), enabled }
                                })).then(() => showToast(enabled ? 'App lock enabled' : 'App lock disabled', 'success'));
                            }}
                        />
                         <div className="w-11 h-6 bg-[rgba(255,255,255,0.1)] border border-white/10 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-violet-600"></div>
                    </label>
                </div>
                
                {formData.security?.enabled && (
                    <div className="pt-2 animate-in slide-in-from-top-2">
                        {formData.security?.pin && !showChangePinUi ? (
                            <div className="flex items-center justify-between p-2">
                                <div>
                                    <div className="text-xs font-bold text-[rgba(203,213,225,0.7)]">App Lock PIN</div>
                                    <div className="text-sm font-black text-[rgba(226,232,240,0.88)]">{'•'.repeat(4)}</div>
                                </div>
                                <button onClick={() => setShowChangePinUi(true)}
                                    className="px-3 py-1.5 rounded-xl text-[11px] font-black active:scale-95 transition-all"
                                    style={{ background: 'rgba(139,92,246,0.15)', color: '#a78bfa', border: '1px solid rgba(139,92,246,0.25)' }}>
                                    Change PIN
                                </button>
                            </div>
                        ) : (
                            <div className="w-full min-w-0 space-y-3 animate-in slide-in-from-top-2">
                                {formData.security?.pin && forgotAppPinStep !== 'sent' && (
                                    <SettingInput
                                        label="Current PIN"
                                        type="password"
                                        value={currentAppPin}
                                        onChange={setCurrentAppPin}
                                        icon={Lock}
                                        placeholder="Enter current PIN"
                                    />
                                )}
                                {formData.security?.pin && forgotAppPinStep === 'idle' && (
                                    <button
                                        onClick={handleForgotAppPin}
                                        disabled={forgotLoading}
                                        className="text-[11px] font-bold px-1 disabled:opacity-40 active:scale-95 transition-all"
                                        style={{ color: 'rgba(96,165,250,0.7)' }}
                                    >
                                        {forgotLoading ? 'Sending…' : 'Forgot PIN? Send reset email'}
                                    </button>
                                )}
                                {forgotAppPinStep === 'sent' && (
                                    <div className="p-3 rounded-xl text-center"
                                        style={{ background: 'rgba(59,130,246,0.1)', border: '1px solid rgba(59,130,246,0.25)' }}>
                                        <Mail size={13} className="inline mb-1" style={{ color: '#60a5fa' }} />
                                        <p className="text-[10px] font-black" style={{ color: '#93c5fd' }}>
                                            Reset email sent to {user?.email}
                                        </p>
                                        <p className="text-[9px] mt-1" style={{ color: 'rgba(148,163,184,0.5)' }}>
                                            You can now set a new PIN below without the current one.
                                        </p>
                                    </div>
                                )}
                                <div>
                                    <SettingInput
                                        label="New 4-Digit PIN"
                                        type="number"
                                        value={newAppPin}
                                        onChange={(v: string) => { if (v.length <= 4) setNewAppPin(v); }}
                                        icon={Smartphone}
                                        placeholder="0000"
                                    />
                                    {(() => { const s = getPinStrength(newAppPin); return s && s.level !== 'strong' ? <p className="text-[10px] font-bold mt-1 px-1" style={{ color: s.color }}>⚠ {s.message}</p> : null; })()}
                                </div>
                                <SettingInput
                                    label="Confirm New PIN"
                                    type="number"
                                    value={confirmAppPin}
                                    onChange={(v: string) => { if (v.length <= 4) setConfirmAppPin(v); }}
                                    icon={Smartphone}
                                    placeholder="0000"
                                />
                                <div className="flex flex-col gap-2 w-full">
                                    <button onClick={handleSaveAppPin}
                                        className="w-full py-3 rounded-xl font-black text-sm text-white active:scale-95 transition-all"
                                        style={{ background: 'linear-gradient(135deg,#8b5cf6,#6366f1)' }}>
                                        {formData.security?.pin ? 'Save PIN' : 'Set PIN'}
                                    </button>
                                    {formData.security?.pin && (
                                        <button onClick={() => { setShowChangePinUi(false); setCurrentAppPin(''); setNewAppPin(''); setConfirmAppPin(''); setForgotAppPinStep('idle'); }}
                                            className="w-full py-2.5 rounded-xl font-black text-sm active:scale-95 transition-all"
                                            style={{ background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.1)', color: 'rgba(203,213,225,0.7)' }}>
                                            Cancel
                                        </button>
                                    )}
                                </div>
                            </div>
                        )}
                    </div>
                )}
            </SettingsSection>

            {/* ── Auto-Lock Timeout ────────────────────────────────────────────── */}
            {formData.security?.enabled && (
              <SettingsSection title="Auto-Lock Timeout" icon={Shield}>
                <div className="px-2 py-1">
                  <p className="text-xs font-bold text-[rgba(148,163,184,0.6)] mb-3">
                    Automatically lock the app after this period of inactivity
                  </p>
                  <div className="grid grid-cols-3 gap-2">
                    {([
                      { value: 0,  label: 'Immediately' },
                      { value: 1,  label: '1 min'       },
                      { value: 5,  label: '5 min'       },
                      { value: 15, label: '15 min'      },
                      { value: 30, label: '30 min'      },
                      { value: -1, label: 'Never'       },
                    ] as { value: number; label: string }[]).map(opt => {
                      const current = formData.security?.auto_lock_minutes ?? 5;
                      const active = current === opt.value;
                      return (
                        <button
                          key={opt.value}
                          onClick={() => {
                            void saveNow((prev: any) => ({
                              ...prev,
                              security: { ...(prev.security || {}), auto_lock_minutes: opt.value }
                            })).then(() => showToast(`Auto-lock: ${opt.label}`, 'success'));
                          }}
                          className="py-2.5 rounded-xl font-bold text-xs active:scale-95 transition-all"
                          style={{
                            background: active ? 'rgba(139,92,246,0.25)' : 'rgba(255,255,255,0.05)',
                            border: `1px solid ${active ? 'rgba(139,92,246,0.5)' : 'rgba(255,255,255,0.08)'}`,
                            color: active ? '#c4b5fd' : 'rgba(148,163,184,0.6)',
                          }}
                        >
                          {opt.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </SettingsSection>
            )}

            {/* ── Data Edit / Delete Password ─────────────────────────────────── */}
            <SettingsSection title="Data Edit Password" icon={Key}>
                <div className="mb-4 p-3 rounded-xl"
                    style={{ background: 'rgba(99,102,241,0.08)', border: '1px solid rgba(99,102,241,0.18)' }}>
                    <p className="text-xs text-[#a5b4fc]">
                        Requires a separate password before editing or deleting any data entry.
                        Default password is <span className="font-black">1234</span>.
                    </p>
                </div>

                {/* Enable / Disable toggle */}
                <div className="flex items-center justify-between p-2 mb-3">
                    <div className="flex items-center gap-3">
                        <div className="p-2 rounded-lg bg-[rgba(99,102,241,0.15)] text-[#818cf8]"><Lock size={20}/></div>
                        <div>
                            <div className="font-bold text-sm text-[rgba(226,232,240,0.88)]">Require Password</div>
                            <div className="text-xs text-[rgba(148,163,184,0.45)]">
                                {isEditPwEnabled ? 'Currently enabled' : 'Currently disabled'}
                            </div>
                        </div>
                    </div>
                    <label className="relative inline-flex items-center cursor-pointer">
                        <input
                            type="checkbox"
                            className="sr-only peer"
                            checked={isEditPwEnabled}
                            onChange={e => {
                                const enabled = e.target.checked;
                                void saveNow((prev: any) => ({
                                    ...prev,
                                    edit_password: {
                                        enabled: true,
                                        password: '1234',
                                        ...(prev.edit_password || {}),
                                        enabled,
                                    }
                                })).then(() => showToast(enabled ? 'Edit password enabled' : 'Edit password disabled', 'success'));
                            }}
                        />
                        <div className="w-11 h-6 bg-[rgba(255,255,255,0.1)] border border-white/10 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-indigo-500"></div>
                    </label>
                </div>

                {/* Change password section */}
                {isEditPwEnabled && (
                    <div className="animate-in slide-in-from-top-2">
                        <div className="flex items-center justify-between mb-3 p-2">
                            <div>
                                <div className="text-xs font-bold text-[rgba(203,213,225,0.7)]">Current Password</div>
                                <div className="text-sm font-black text-[rgba(226,232,240,0.88)]">
                                    {'•'.repeat(currentEditPw.length)}
                                </div>
                            </div>
                            <button
                                onClick={() => setShowEditPwInput(v => !v)}
                                className="px-3 py-1.5 rounded-xl text-[11px] font-black active:scale-95 transition-all"
                                style={{ background: 'rgba(99,102,241,0.15)', color: '#a5b4fc', border: '1px solid rgba(99,102,241,0.25)' }}
                            >
                                {showEditPwInput ? 'Cancel' : 'Change'}
                            </button>
                        </div>

                        {showEditPwInput && (
                            <div className="space-y-3 animate-in slide-in-from-top-2">
                                {forgotEditPwStep !== 'sent' && (
                                    <SettingInput
                                        label="Current Password"
                                        type="password"
                                        value={currentEditPwInput}
                                        onChange={setCurrentEditPwInput}
                                        icon={Lock}
                                        placeholder="Enter current password"
                                    />
                                )}
                                {forgotEditPwStep === 'idle' && (
                                    <button
                                        onClick={handleForgotEditPw}
                                        disabled={forgotLoading}
                                        className="text-[11px] font-bold px-1 disabled:opacity-40 active:scale-95 transition-all"
                                        style={{ color: 'rgba(96,165,250,0.7)' }}
                                    >
                                        {forgotLoading ? 'Sending…' : 'Forgot Password? Send reset email'}
                                    </button>
                                )}
                                {forgotEditPwStep === 'sent' && (
                                    <div className="p-3 rounded-xl text-center"
                                        style={{ background: 'rgba(59,130,246,0.1)', border: '1px solid rgba(59,130,246,0.25)' }}>
                                        <Mail size={13} className="inline mb-1" style={{ color: '#60a5fa' }} />
                                        <p className="text-[10px] font-black" style={{ color: '#93c5fd' }}>
                                            Reset email sent to {user?.email}
                                        </p>
                                        <p className="text-[9px] mt-1" style={{ color: 'rgba(148,163,184,0.5)' }}>
                                            You can now set a new password below without the current one.
                                        </p>
                                    </div>
                                )}
                                <div>
                                    <SettingInput
                                        label="New Password"
                                        type="password"
                                        value={newEditPw}
                                        onChange={setNewEditPw}
                                        icon={Lock}
                                        placeholder="Enter new password"
                                    />
                                    {(() => { const s = getPasswordStrength(newEditPw); return s && s.level !== 'strong' ? <p className="text-[10px] font-bold mt-1 px-1" style={{ color: s.color }}>⚠ {s.message}</p> : null; })()}
                                </div>
                                <SettingInput
                                    label="Confirm New Password"
                                    type="password"
                                    value={confirmEditPw}
                                    onChange={setConfirmEditPw}
                                    icon={Lock}
                                    placeholder="Confirm new password"
                                />
                                <button
                                    onClick={handleSaveEditPassword}
                                    className="w-full py-3 rounded-xl font-black text-sm text-white active:scale-95 transition-all"
                                    style={{ background: 'linear-gradient(135deg,#6366f1,#8b5cf6)' }}
                                >
                                    Save New Password
                                </button>
                            </div>
                        )}
                    </div>
                )}
            </SettingsSection>

            {isEmailPasswordUser && (
            <SettingsSection title="Account Security" icon={Key}>
                <div className="mb-4 p-3 rounded-xl"
                    style={{ background: 'rgba(56,189,248,0.08)', border: '1px solid rgba(56,189,248,0.18)' }}>
                    <p className="text-xs text-[#7dd3fc]">
                        Update your login (email/password) account password. Requires a recent login.
                    </p>
                </div>

                <div className="flex items-center justify-between p-2 mb-3">
                    <div>
                        <div className="text-xs font-bold text-[rgba(203,213,225,0.7)]">Login Password</div>
                        <div className="text-sm font-black text-[rgba(226,232,240,0.88)]">
                            {'•'.repeat(10)}
                        </div>
                    </div>
                    <button
                        onClick={() => setShowUpgradePwInput(v => !v)}
                        className="px-3 py-1.5 rounded-xl text-[11px] font-black active:scale-95 transition-all"
                        style={{ background: 'rgba(56,189,248,0.15)', color: '#7dd3fc', border: '1px solid rgba(56,189,248,0.25)' }}
                    >
                        {showUpgradePwInput ? 'Cancel' : 'Change'}
                    </button>
                </div>

                {showUpgradePwInput && (
                    <div className="space-y-3 animate-in slide-in-from-top-2">
                        <SettingInput
                            label="Current Password"
                            type="password"
                            value={currentUpgradePw}
                            onChange={setCurrentUpgradePw}
                            icon={Lock}
                            placeholder="Enter current password"
                        />
                        <div>
                            <SettingInput
                                label="New Password"
                                type="password"
                                value={newUpgradePw}
                                onChange={setNewUpgradePw}
                                icon={Lock}
                                placeholder="Enter new password (min 6 chars)"
                            />
                            {(() => { const s = getPasswordStrength(newUpgradePw); return s && s.level !== 'strong' ? <p className="text-[10px] font-bold mt-1 px-1" style={{ color: s.color }}>⚠ {s.message}</p> : null; })()}
                        </div>
                        <SettingInput
                            label="Confirm New Password"
                            type="password"
                            value={confirmUpgradePw}
                            onChange={setConfirmUpgradePw}
                            icon={Lock}
                            placeholder="Confirm new password"
                        />
                        <LoadingButton
                            loading={passwordLoading}
                            onClick={handleSaveUpgradePassword}
                            label="Save New Password"
                            className="w-full text-white"
                            style={{ background: 'linear-gradient(135deg,#0ea5e9,#38bdf8)' }}
                        />
                    </div>
                )}
            </SettingsSection>
            )}
        </div>
    );
};
