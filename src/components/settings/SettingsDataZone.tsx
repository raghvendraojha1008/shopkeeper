import React, { useRef, useState, useEffect, useCallback } from 'react';
import { Database, Download, Upload, AlertTriangle, RefreshCw, FileSpreadsheet, History, Trash2, Smartphone, Clock, Calendar, Cloud, ShieldAlert, Mail, KeyRound, X, Archive, ShieldCheck, MessageSquare, Info } from 'lucide-react';
import { ApiService } from '../../services/api';
import { AuditService } from '../../services/audit';
import { exportService } from '../../services/export';
import { AutoBackupService } from '../../services/autoBackup';
import { GoogleDriveBackupService } from '../../services/googleDriveBackupService';
import { FactoryResetBinService } from '../../services/factoryResetBin';
import { SyncQueueService } from '../../services/syncQueue';
import { useSyncControl } from '../../hooks/useOnlineStatus';
import { useUI } from '../../context/UIContext';
import { SettingsSection, LoadingButton } from './SettingsCommon';
import RecycleBin from '../common/RecycleBin';
import FactoryResetBin from '../common/FactoryResetBin';
// MODULE 5 — Trust signals: "Last backup at X" + restore validation
import { LastBackupTracker } from '../../services/lastBackupTracker';
// FINAL MODULE — In-app feedback + version info
import FeedbackModal from '../modals/FeedbackModal';
import { APP_VERSION } from '../../constants/appVersion';

export const SettingsDataZone = ({ user }: any) => {
    const { showToast, confirm } = useUI();
    const { isSyncing, syncMessage, syncProgress, syncNow, queueCount } = useSyncControl();
    const fileInputRef = useRef<HTMLInputElement>(null);
    
    const [backupLoading, setBackupLoading] = useState(false);
    const [restoreLoading, setRestoreLoading] = useState(false);
    const [excelLoading, setExcelLoading] = useState(false);
    const [showAuditLog, setShowAuditLog] = useState(false);
    const [auditLogs, setAuditLogs] = useState<any[]>([]);
    const [showRecycleBin, setShowRecycleBin] = useState(false);
    const [showResetBin, setShowResetBin] = useState(false);
    const [snapshotLoading, setSnapshotLoading] = useState(false);
    const [localBackupLoading, setLocalBackupLoading] = useState(false);
    const [localBackups, setLocalBackups] = useState<any[]>([]);
    const [showLocalBackups, setShowLocalBackups] = useState(false);
    const [restoreLocalLoading, setRestoreLocalLoading] = useState<string | null>(null);
    const [driveBackupLoading, setDriveBackupLoading] = useState(false);
    const [driveLastFile, setDriveLastFile] = useState<string | null>(
        () => localStorage.getItem(`drive_last_backup_file_${user?.uid}`)
    );

    // FINAL MODULE — feedback modal visibility (lives in this zone because
    // "Help & Feedback" naturally pairs with "Data Management").
    const [showFeedback, setShowFeedback] = useState(false);

    // OTP Reset state
    const [showResetOtp, setShowResetOtp] = useState(false);
    const [generatedOtp, setGeneratedOtp] = useState('');
    const [otpExpiry, setOtpExpiry] = useState(0);
    const [otpSecondsLeft, setOtpSecondsLeft] = useState(0);
    const [enteredOtp, setEnteredOtp] = useState('');
    const [resetLoading, setResetLoading] = useState(false);

    useEffect(() => {
        loadLocalBackups();
    }, []);

    // OTP countdown timer
    useEffect(() => {
        if (!showResetOtp || otpExpiry === 0) return;
        const interval = setInterval(() => {
            const left = Math.max(0, Math.ceil((otpExpiry - Date.now()) / 1000));
            setOtpSecondsLeft(left);
            if (left === 0) clearInterval(interval);
        }, 500);
        return () => clearInterval(interval);
    }, [showResetOtp, otpExpiry]);

    const loadLocalBackups = async () => {
        const backups = await AutoBackupService.listBackups();
        setLocalBackups(backups);
    };

    const handleLocalBackup = async () => {
        setLocalBackupLoading(true);
        try {
            const result = await AutoBackupService.createLocalBackup(user.uid, user.email, 'manual');
            if (result.success) {
                showToast(result.message, 'success');
                await loadLocalBackups();
            } else {
                showToast(result.message, 'error');
            }
        } catch (e: any) {
            showToast('Local backup failed: ' + e.message, 'error');
        } finally {
            setLocalBackupLoading(false);
        }
    };

    const handleGoogleDriveBackup = async () => {
        setDriveBackupLoading(true);
        try {
            const result = await GoogleDriveBackupService.backupToGoogleDrive(user.uid, user.email);
            if (result.success) {
                if (result.fileName) {
                    localStorage.setItem(`drive_last_backup_file_${user.uid}`, result.fileName);
                    setDriveLastFile(result.fileName);
                }
                showToast(result.message, 'success');
            } else {
                showToast(result.message, 'error');
            }
        } catch (e: any) {
            showToast('Google Drive backup failed: ' + e.message, 'error');
        } finally {
            setDriveBackupLoading(false);
        }
    };

    const handleRestoreLocal = async (fileName: string) => {
        // MODULE 5 — Same validate-then-preview pattern as the upload restore.
        // Read the device file once; validate; show counts; then confirm.
        setRestoreLocalLoading(fileName);

        let backupData: any;
        try {
            backupData = await AutoBackupService.restoreFromFile(fileName);
        } catch (e: any) {
            showToast('Could not read backup: ' + (e?.message || 'unknown error'), 'error');
            setRestoreLocalLoading(null);
            return;
        }

        const validation = validateBackup(backupData);
        if (!validation.ok) {
            showToast(validation.error, 'error');
            setRestoreLocalLoading(null);
            return;
        }

        const data = backupData.data || backupData;
        const confirmed = await confirm(
            'Restore Backup',
            `From ${fileName}: ${buildPreviewLine(data)} This will OVERWRITE your current data.`,
        );
        if (!confirmed) {
            setRestoreLocalLoading(null);
            return;
        }

        try {
            await ApiService.restoreBackup(user.uid, data);
            showToast('Data restored. Reloading...', 'success');
            setTimeout(() => window.location.reload(), 2000);
        } catch (e: any) {
            showToast('Restore failed: ' + (e?.message || 'unknown error'), 'error');
            setRestoreLocalLoading(null);
        }
    };

    const handleBackup = async () => {
        setBackupLoading(true);
        try {
            const [ledger, transactions, inventory, parties, vehicles, expenses] = await Promise.all([
                ApiService.getAll(user.uid, 'ledger_entries'),
                ApiService.getAll(user.uid, 'transactions'),
                ApiService.getAll(user.uid, 'inventory'),
                ApiService.getAll(user.uid, 'parties'),
                ApiService.getAll(user.uid, 'vehicles'),
                ApiService.getAll(user.uid, 'expenses')
            ]);

            const backupData = {
                version: '1.0',
                timestamp: new Date().toISOString(),
                data: {
                    ledger_entries: ledger.docs.map(d => ({ id: d.id, ...d.data() })),
                    transactions: transactions.docs.map(d => ({ id: d.id, ...d.data() })),
                    inventory: inventory.docs.map(d => ({ id: d.id, ...d.data() })),
                    parties: parties.docs.map(d => ({ id: d.id, ...d.data() })),
                    vehicles: vehicles.docs.map(d => ({ id: d.id, ...d.data() })),
                    expenses: expenses.docs.map(d => ({ id: d.id, ...d.data() }))
                }
            };

            const blob = new Blob([JSON.stringify(backupData, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `ledger_backup_${new Date().toISOString().split('T')[0]}.json`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url); // Free memory

            // MODULE 5 — record so "Last backup" updates immediately on web too
            LastBackupTracker.markCompleted(user.uid, 'manual-json');
            showToast('Backup downloaded successfully', 'success');
        } catch (e) {
            console.error(e);
            showToast('Backup generation failed. Check internet.', 'error');
        } finally {
            setBackupLoading(false);
        }
    };

    const handleExportExcel = async () => {
        setExcelLoading(true);
        try {
            const [ledger, transactions, inventory, parties] = await Promise.all([
                ApiService.getAll(user.uid, 'ledger_entries'),
                ApiService.getAll(user.uid, 'transactions'),
                ApiService.getAll(user.uid, 'inventory'),
                ApiService.getAll(user.uid, 'parties')
            ]);

            // Export Ledger
            const ledgerData = ledger.docs.map(d => {
                const data = d.data();
                return {
                    Date: data.date,
                    Type: data.type === 'sell' ? 'Sale' : 'Purchase',
                    Party: data.party_name,
                    Invoice: data.invoice_no || '-',
                    Items: data.items?.map((i: any) => `${i.quantity} ${i.item_name}`).join('; ') || '-',
                    Total: data.total_amount,
                    Vehicle: data.vehicle || '-',
                    Rent: data.vehicle_rent || 0
                };
            });
            
            // Export Transactions
            const transData = transactions.docs.map(d => {
                const data = d.data();
                return {
                    Date: data.date,
                    Type: data.type === 'received' ? 'Received' : 'Paid',
                    Party: data.party_name,
                    Amount: data.amount,
                    Mode: data.payment_mode || 'Cash',
                    Reference: data.bill_no || '-',
                    Notes: data.notes || '-'
                };
            });

            // Export Inventory
            const invData = inventory.docs.map(d => {
                const data = d.data();
                return {
                    Name: data.name,
                    Unit: data.unit,
                    Stock: data.current_stock,
                    'Min Stock': data.min_stock,
                    'Sale Rate': data.sale_rate,
                    'Purchase Rate': data.purchase_rate,
                    HSN: data.hsn_code || '-',
                    GST: data.gst_percent || 0
                };
            });

            // Export Parties
            const partyData = parties.docs.map(d => {
                const data = d.data();
                return {
                    'Party Code': data.party_code || '-',
                    Name: data.name,
                    Role: data.role,
                    Contact: data.contact || '-',
                    Address: data.address || '-',
                    GSTIN: data.gstin || '-',
                    'Legal Name': data.legal_name || '-',
                    Site: data.site || '-',
                    State: data.state || '-',
                    'Credit Limit': data.credit_limit ?? '-',
                    'Linked Items': Array.isArray(data.linked_items) ? data.linked_items.join('|') : (data.linked_items || '-'),
                };
            });

            // Download all as separate CSVs
            if (ledgerData.length > 0) {
                await exportService.exportToCSV(ledgerData, Object.keys(ledgerData[0]), 'Ledger_Export.csv');
            }
            if (transData.length > 0) {
                await exportService.exportToCSV(transData, Object.keys(transData[0]), 'Transactions_Export.csv');
            }
            if (invData.length > 0) {
                await exportService.exportToCSV(invData, Object.keys(invData[0]), 'Inventory_Export.csv');
            }
            if (partyData.length > 0) {
                await exportService.exportToCSV(partyData, Object.keys(partyData[0]), 'Parties_Export.csv');
            }

            showToast('Excel files exported successfully', 'success');
        } catch (e) {
            console.error(e);
            showToast('Export failed', 'error');
        } finally {
            setExcelLoading(false);
        }
    };

    const loadAuditLogs = async () => {
        const logs = await AuditService.getRecent(user.uid, 200);
        const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
        const filtered = logs.filter((l: any) => new Date(l.timestamp).getTime() >= cutoff);
        setAuditLogs(filtered.slice(0, 100));
        setShowAuditLog(true);
    };

    const handleRestore = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        // MODULE 5 — Read + validate FIRST, then ask for confirmation with a
        // preview of what will be overwritten. This way the user sees what's
        // in the file (e.g. "12 parties, 47 ledger entries") and can spot a
        // wrong-firm or empty backup before nuking their current data.
        setRestoreLoading(true);
        const clearInput = () => { if (fileInputRef.current) fileInputRef.current.value = ''; };

        let parsed: any;
        try {
            parsed = JSON.parse(await file.text());
        } catch (err) {
            console.error(err);
            showToast('That file is not valid JSON.', 'error');
            setRestoreLoading(false);
            clearInput();
            return;
        }

        const validation = validateBackup(parsed);
        if (!validation.ok) {
            showToast(validation.error, 'error');
            setRestoreLoading(false);
            clearInput();
            return;
        }

        const data = parsed.data || parsed;
        const confirmed = await confirm(
            'Restore Backup',
            `${buildPreviewLine(data)} This will OVERWRITE your current data and cannot be undone.`,
        );
        if (!confirmed) {
            setRestoreLoading(false);
            clearInput();
            return;
        }

        try {
            await ApiService.restoreBackup(user.uid, data);
            showToast('Data restored successfully. Reloading...', 'success');
            setTimeout(() => window.location.reload(), 2000);
        } catch (err: any) {
            console.error(err);
            showToast('Restore failed: ' + (err?.message || 'unknown error'), 'error');
            setRestoreLoading(false);
            clearInput();
        }
    };

    const handleResetApp = async () => {
        const confirmed = await confirm('Factory Reset', 'This will permanently delete ALL data. Are you sure?');
        if (!confirmed) return;

        // Generate a 6-digit OTP and open verification modal
        const code = String(Math.floor(100000 + Math.random() * 900000));
        const expiry = Date.now() + 60_000; // 1 minute
        setGeneratedOtp(code);
        setOtpExpiry(expiry);
        setOtpSecondsLeft(60);
        setEnteredOtp('');
        setShowResetOtp(true);
    };

    const handleOtpVerify = async () => {
        if (otpSecondsLeft === 0) {
            showToast('Verification code expired. Please try again.', 'error');
            setShowResetOtp(false);
            return;
        }
        if (enteredOtp.trim() !== generatedOtp) {
            showToast('Incorrect code. Please try again.', 'error');
            return;
        }
        setResetLoading(true);
        try {
            showToast('Saving backup to Factory Reset Bin…', 'info');
            setSnapshotLoading(true);
            try {
                await FactoryResetBinService.savePreResetSnapshot(user.uid);
            } catch (snapErr) {
                console.warn('Snapshot save failed (proceeding with reset):', snapErr);
            } finally {
                setSnapshotLoading(false);
            }
            await ApiService.factoryReset(user.uid);

            // Clear ALL local caches so the reload starts completely fresh.
            // Without this, TanStack Query restores old IndexedDB data immediately
            // after reload — making stale data appear even though Firestore is empty.
            // Editing any of those stale records then throws (doc deleted) and wipes the UI.

            // 1. Clear the React Query IndexedDB cache
            try {
                const { del, createStore } = await import('idb-keyval');
                const store = createStore('shopkeeper-cache', 'react-query');
                await del('rq-cache-v1', store);
            } catch (_) { /* IDB unavailable — skip */ }

            // 2. Wipe localStorage: sync queue, ID counters, drafts, all app state
            try { localStorage.clear(); } catch (_) {}

            // 3. Wipe sessionStorage
            try { sessionStorage.clear(); } catch (_) {}

            showToast('App reset complete. Restarting...', 'success');
            setTimeout(() => window.location.reload(), 1500);
        } catch (e) {
            showToast('Reset failed', 'error');
            setResetLoading(false);
        }
        setShowResetOtp(false);
    };

    // When the Factory Reset Bin is open, show it as a full-screen view that
    // replaces the data-zone content. Its built-in back button restores us here.
    if (showResetBin) {
        return (
            <div className="fixed inset-0 z-[110]" style={{ background: 'var(--app-bg)' }}>
                <FactoryResetBin user={user} onBack={() => setShowResetBin(false)} />
            </div>
        );
    }

    return (
        <div className="space-y-6 animate-in slide-in-from-right duration-300">
             <SettingsSection title="Data Management" icon={Database}>

                {/* MODULE 5 — Trust signal: when did we last save your data? */}
                <LastBackupCard userId={user.uid} />

                {/* Offline Sync Section */}
                <div className="bg-[rgba(99,102,241,0.08)] p-4 rounded-xl border border-[rgba(99,102,241,0.2)] mb-4 flex gap-3">
                    <Cloud className="text-indigo-400 shrink-0" size={20}/>
                    <div className="flex-1">
                        <h4 className="font-bold text-sm text-[#a5b4fc]">Offline Sync</h4>
                        <p className="text-xs text-[rgba(165,180,252,0.7)] mt-1">
                            {queueCount > 0 
                                ? `${queueCount} pending item${queueCount !== 1 ? 's' : ''} waiting to sync` 
                                : 'All data synchronized'}
                        </p>
                        {syncMessage && (
                            <p className="text-xs text-indigo-400 mt-1 font-medium">
                                {syncMessage}
                            </p>
                        )}
                        {syncProgress && (
                            <div className="mt-2 w-full bg-[rgba(99,102,241,0.2)] h-1.5 rounded-full overflow-hidden">
                                <div
                                    className="h-full bg-indigo-600 transition-all duration-300"
                                    style={{
                                        width: `${(syncProgress.processed / syncProgress.total) * 100}%`,
                                    }}
                                />
                            </div>
                        )}
                    </div>
                </div>

                <LoadingButton 
                    loading={isSyncing}
                    onClick={syncNow}
                    icon={RefreshCw}
                    label={queueCount > 0 ? `Sync Now (${queueCount} pending)` : 'Sync Now'}
                    className="w-full bg-indigo-600 hover:bg-indigo-700 text-white mb-4"
                    disabled={queueCount === 0 && !isSyncing}
                />

                {/* Backup & Restore Section */}
                <div className="bg-[rgba(59,130,246,0.07)] p-4 rounded-xl border border-[rgba(59,130,246,0.18)] mb-4 flex gap-3">
                    <Database className="text-blue-400 shrink-0" size={20}/>
                    <div>
                        <h4 className="font-bold text-sm text-[#93c5fd]">Backup & Restore</h4>
                        <p className="text-xs text-blue-400 mt-1">Keep your data safe. Download a JSON backup regularly.</p>
                    </div>
                </div>

                <div className="grid grid-cols-2 gap-3 mb-4">
                    <LoadingButton 
                        loading={backupLoading}
                        onClick={handleBackup}
                        icon={Download}
                        label="JSON Backup"
                        className="text-white" style={{background:"linear-gradient(135deg,#4f46e5,#7c3aed)"}}
                    />
                    
                    <div className="relative">
                        <input 
                            type="file" 
                            ref={fileInputRef}
                            onChange={handleRestore}
                            accept=".json"
                            className="hidden"
                        />
                        <LoadingButton 
                            loading={restoreLoading}
                            onClick={() => fileInputRef.current?.click()}
                            icon={Upload}
                            label="Restore"
                            className="w-full border border-white/12 rounded-xl"
                        />
                    </div>
                </div>

                {/* Excel Export Section */}
                <div className="bg-[rgba(16,185,129,0.07)] p-4 rounded-xl border border-[rgba(16,185,129,0.18)] mb-4 flex gap-3">
                    <FileSpreadsheet className="text-green-600 shrink-0" size={20}/>
                    <div>
                        <h4 className="font-bold text-sm text-[#6ee7b7]">Export to Excel/CSV</h4>
                        <p className="text-xs text-[rgba(110,231,183,0.7)] mt-1">Download all data as spreadsheets for external use.</p>
                    </div>
                </div>
                
                <LoadingButton 
                    loading={excelLoading}
                    onClick={handleExportExcel}
                    icon={FileSpreadsheet}
                    label="Export All as CSV"
                    className="w-full bg-green-600 text-white"
                />

                {/* Recycle Bin Section */}
                <div className="mt-4 pt-4 border-t border-white/10">
                    <div className="bg-[rgba(244,63,94,0.07)] p-4 rounded-xl border border-[rgba(244,63,94,0.18)] mb-4 flex gap-3">
                        <Trash2 className="text-[#f87171] shrink-0" size={20}/>
                        <div>
                            <h4 className="font-bold text-sm text-[#fca5a5]">Recycle Bin</h4>
                            <p className="text-xs text-[rgba(252,165,165,0.7)] mt-1">Recover recently deleted items or permanently remove them.</p>
                        </div>
                    </div>
                    
                    <button 
                        onClick={() => setShowRecycleBin(true)}
                        className="w-full py-3 bg-[rgba(244,63,94,0.10)] text-[#fca5a5] rounded-xl font-bold text-sm flex items-center justify-center gap-2 active:scale-95 transition-all border border-[rgba(244,63,94,0.2)]"
                    >
                        <Trash2 size={16}/> Open Recycle Bin
                    </button>
                </div>
            </SettingsSection>

            {/* Local Auto-Backup Section */}
            <SettingsSection title="Device Backup (Auto)" icon={Smartphone}>
                <div className="bg-[rgba(99,102,241,0.07)] p-4 rounded-xl border border-[rgba(99,102,241,0.18)] mb-4 flex gap-3">
                    <Clock className="text-indigo-400 shrink-0" size={20}/>
                    <div>
                        <h4 className="font-bold text-sm text-[#a5b4fc]">Auto Daily Backup</h4>
                        <p className="text-xs text-[rgba(165,180,252,0.7)] mt-1">Saves automatically on app open. Keeps 3 JSON backups (today, 3d, 6d back) and 3 CSV sets (today, 3d, 6d back).</p>
                    </div>
                </div>

                <div className="grid grid-cols-2 gap-3 mb-4">
                    <LoadingButton
                        loading={localBackupLoading}
                        onClick={handleLocalBackup}
                        icon={Download}
                        label="Backup Now"
                        className="bg-indigo-600 text-white"
                    />
                    <button
                        onClick={() => { loadLocalBackups(); setShowLocalBackups(!showLocalBackups); }}
                        className="py-3 rounded-xl font-bold text-sm flex items-center justify-center gap-2 active:scale-95 transition-all border border-white/12"
                    >
                        <Calendar size={16}/> View Backups ({localBackups.length})
                    </button>
                </div>

                {showLocalBackups && (
                    <div className="space-y-2 max-h-[250px] overflow-y-auto">
                        {localBackups.length === 0 ? (
                            <div className="text-center py-6 text-slate-400 text-xs italic">No local backups found</div>
                        ) : localBackups.map((b, i) => (
                            <div key={i} className="flex justify-between items-center p-3 rounded-xl border border-white/10 bg-[rgba(255,255,255,0.04)]">
                                <div>
                                    <div className="font-bold text-xs text-[rgba(203,213,225,0.75)]">{b.date}</div>
                                    <div className="text-[10px] text-[rgba(148,163,184,0.45)]">{b.name}</div>
                                </div>
                                <button
                                    onClick={() => handleRestoreLocal(b.name)}
                                    disabled={restoreLocalLoading === b.name}
                                    className="px-3 py-1.5 bg-[rgba(99,102,241,0.15)] text-indigo-300 rounded-lg text-[10px] font-bold active:scale-95 disabled:opacity-50"
                                >
                                    {restoreLocalLoading === b.name ? 'Restoring...' : 'Restore'}
                                </button>
                            </div>
                        ))}
                    </div>
                )}
            </SettingsSection>

            {/* Google Drive Backup Section */}
            <SettingsSection title="Google Drive Backup" icon={Cloud}>
                <div className="rounded-[16px] p-4 mb-4 flex gap-3"
                    style={{ background: 'rgba(66,133,244,0.08)', border: '1px solid rgba(66,133,244,0.2)' }}>
                    <div className="shrink-0 mt-0.5">
                        <svg width="20" height="20" viewBox="0 0 87.3 78" xmlns="http://www.w3.org/2000/svg">
                            <path d="m6.6 66.85 3.85 6.65c.8 1.4 1.95 2.5 3.3 3.3l13.75-23.8h-27.5c0 1.55.4 3.1 1.2 4.5z" fill="#0066da"/>
                            <path d="m43.65 25-13.75-23.8c-1.35.8-2.5 1.9-3.3 3.3l-25.4 44a9.06 9.06 0 0 0 -1.2 4.5h27.5z" fill="#00ac47"/>
                            <path d="m73.55 76.8c1.35-.8 2.5-1.9 3.3-3.3l1.6-2.75 7.65-13.25c.8-1.4 1.2-2.95 1.2-4.5h-27.502l5.852 11.5z" fill="#ea4335"/>
                            <path d="m43.65 25 13.75-23.8c-1.35-.8-2.9-1.2-4.5-1.2h-18.5c-1.6 0-3.15.45-4.5 1.2z" fill="#00832d"/>
                            <path d="m59.8 53h-32.3l-13.75 23.8c1.35.8 2.9 1.2 4.5 1.2h50.8c1.6 0 3.15-.45 4.5-1.2z" fill="#2684fc"/>
                            <path d="m73.4 26.5-12.7-22c-.8-1.4-1.95-2.5-3.3-3.3l-13.75 23.8 16.15 27h27.45c0-1.55-.4-3.1-1.2-4.5z" fill="#ffba00"/>
                        </svg>
                    </div>
                    <div>
                        <h4 className="font-bold text-sm" style={{ color: '#93c5fd' }}>Backup to Google Drive</h4>
                        <p className="text-xs mt-1" style={{ color: 'rgba(147,197,253,0.65)' }}>
                            Saves a JSON backup file to your Google Drive. Visible and restorable from the Google Drive app on any device.
                        </p>
                    </div>
                </div>

                {driveLastFile && (
                    <div className="flex items-center gap-2 px-3 py-2 rounded-xl mb-3"
                        style={{ background: 'rgba(66,133,244,0.07)', border: '1px solid rgba(66,133,244,0.15)' }}>
                        <Cloud size={13} style={{ color: 'rgba(66,133,244,0.8)', flexShrink: 0 }} />
                        <span className="text-[10px] font-bold" style={{ color: 'rgba(147,197,253,0.7)' }}>
                            Last: {driveLastFile}
                        </span>
                    </div>
                )}

                <LoadingButton
                    loading={driveBackupLoading}
                    onClick={handleGoogleDriveBackup}
                    icon={Cloud}
                    label={driveBackupLoading ? 'Uploading to Drive…' : 'Backup to Google Drive'}
                    className="w-full text-white font-bold"
                    style={{ background: 'linear-gradient(135deg, #4285f4, #34a853)' }}
                />
                <p className="text-[10px] mt-2 text-center" style={{ color: 'rgba(148,163,184,0.45)' }}>
                    You'll be asked to sign in with Google and grant Drive access.
                </p>
            </SettingsSection>

            {/* Audit Log Section */}
            <SettingsSection title="Activity Log" icon={History}>
                <div className="bg-[rgba(255,255,255,0.04)] p-4 rounded-xl border border-white/10 mb-4">
                    <p className="text-xs text-[rgba(148,163,184,0.55)]">
                        Track all changes made to your data. See who edited, deleted, or created entries.
                    </p>
                </div>
                
                <button 
                    onClick={loadAuditLogs}
                    className="w-full py-3 rounded-xl font-bold text-sm flex items-center justify-center gap-2 active:scale-95 transition-all border border-white/12"
                >
                    <History size={16}/> View Activity Log
                </button>
            </SettingsSection>

            {/* FINAL MODULE — Help & Feedback section */}
            <SettingsSection title="Help & Feedback" icon={MessageSquare}>
                <div className="bg-[rgba(255,255,255,0.04)] p-4 rounded-xl border border-white/10 mb-4">
                    <p className="text-xs text-[rgba(148,163,184,0.55)]">
                        Found a bug, want a new feature, or just want to share how things are going? We read every message.
                    </p>
                </div>
                <button
                    onClick={() => setShowFeedback(true)}
                    className="w-full py-3 rounded-xl font-bold text-sm flex items-center justify-center gap-2 active:scale-95 transition-all border border-white/12 mb-3"
                    style={{ background: 'linear-gradient(135deg, rgba(99,102,241,0.18), rgba(139,92,246,0.18))', color: '#c4b5fd' }}
                >
                    <MessageSquare size={16}/> Send Feedback
                </button>
                <div className="flex items-center justify-between px-4 py-3 rounded-xl"
                    style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
                    <div className="flex items-center gap-2">
                        <Info size={14} style={{ color: 'rgba(148,163,184,0.6)' }} />
                        <span className="text-[11px] font-bold" style={{ color: 'rgba(148,163,184,0.7)' }}>App version</span>
                    </div>
                    <span className="text-[11px] font-mono font-black" style={{ color: 'rgba(196,181,253,0.85)' }}>
                        v{APP_VERSION}
                    </span>
                </div>
            </SettingsSection>

            <div className="bg-[rgba(239,68,68,0.07)] p-5 rounded-2xl border border-[rgba(239,68,68,0.2)] mt-8">
                <div className="flex items-center gap-2 text-red-600 font-black mb-4 uppercase text-xs tracking-widest">
                    <AlertTriangle size={16}/> Danger Zone
                </div>
                <p className="text-xs text-red-500 mb-4 font-medium">Resetting the app will delete all customers, inventory, and transaction history permanently. A full backup is saved to the Factory Reset Bin (kept 30 days) before wiping.</p>
                <div className="space-y-3">
                    <button
                        onClick={() => setShowResetBin(true)}
                        className="w-full py-3 rounded-xl border font-bold text-sm flex items-center justify-center gap-2 active:scale-95 transition-all"
                        style={{ borderColor: 'rgba(251,146,60,0.3)', color: '#fb923c', background: 'rgba(251,146,60,0.07)' }}
                    >
                        <Archive size={16}/> Factory Reset Bin
                    </button>
                    <button
                        onClick={handleResetApp}
                        className="w-full py-4 rounded-xl border border-red-500/30 text-red-400 font-bold text-sm flex items-center justify-center gap-2 active:scale-95 transition-all"
                    >
                        {snapshotLoading ? <RefreshCw size={16} className="animate-spin" /> : <RefreshCw size={16}/>} Factory Reset App
                    </button>
                </div>
            </div>

            {/* Audit Log Modal */}
            {showAuditLog && (
                <div className="fixed inset-0 bg-black/75 backdrop-blur-sm z-[100] flex items-end sm:items-center justify-center p-4">
                    <div className="audit-log-modal-root w-full max-w-lg max-h-[80vh] rounded-2xl shadow-2xl overflow-hidden border border-white/10 animate-in slide-in-from-bottom-8 duration-300">
                        <div className="p-4 border-b border-white/10 flex justify-between items-center sticky top-0 z-10" style={{ background: 'rgba(13,17,40,0.98)' }}>
                            <div className="flex items-center gap-3">
                                <div className="p-2 rounded-xl">
                                    <History size={20} className="text-[rgba(203,213,225,0.7)]"/>
                                </div>
                                <div>
                                    <h3 className="font-black">Edit History</h3>
                                    <p className="text-[10px] text-slate-400 uppercase font-bold">Last 30 days · {auditLogs.length} entries</p>
                                </div>
                            </div>
                            <button 
                                onClick={() => setShowAuditLog(false)}
                                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[11px] font-black active:scale-95 transition-all"
                                style={{ background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.1)', color: 'rgba(203,213,225,0.7)' }}
                            >
                                <X size={13}/> Close
                            </button>
                        </div>
                        
                        <div className="overflow-y-auto max-h-[60vh] p-4 space-y-3" style={{ background: 'rgba(10,14,34,0.97)' }}>
                            {auditLogs.length === 0 ? (
                                <div className="text-center py-10">
                                    <History size={40} className="mx-auto mb-3 text-slate-300"/>
                                    <p className="text-sm font-bold text-[rgba(148,163,184,0.45)]">No activity in the last 30 days</p>
                                </div>
                            ) : (
                                auditLogs.map((log, i) => {
                                    const changes: {field: string; before: any; after: any}[] = log.changes || [];
                                    return (
                                        <div key={log.id || i} className="p-3 rounded-xl border border-white/10 bg-[rgba(255,255,255,0.04)]">
                                            <div className="flex justify-between items-start mb-2">
                                                <span className={`text-[9px] font-black uppercase px-2 py-0.5 rounded ${
                                                    log.action === 'create' ? 'bg-[rgba(16,185,129,0.15)] text-emerald-400' :
                                                    log.action === 'update' ? 'bg-[rgba(59,130,246,0.15)] text-blue-400' :
                                                    log.action === 'delete' ? 'bg-[rgba(239,68,68,0.15)] text-red-400' :
                                                    'bg-[rgba(139,92,246,0.2)] text-violet-300'
                                                }`}>
                                                    {log.action}
                                                </span>
                                                <span className="text-[10px] text-[rgba(148,163,184,0.45)]">
                                                    {new Date(log.timestamp).toLocaleString('en-IN')}
                                                </span>
                                            </div>
                                            <p className="text-sm font-bold text-[rgba(240,244,255,0.95)]">{log.summary}</p>
                                            <p className="text-[10px] text-slate-400 mt-1">{log.collection?.replace(/_/g, ' ')}</p>
                                            {log.user_email && (
                                                <p className="text-[10px] text-slate-500 mt-0.5">By: {log.user_email}</p>
                                            )}
                                            {changes.length > 0 && (
                                                <div className="mt-2 space-y-1.5 border-t border-white/8 pt-2">
                                                    {changes.map((ch, ci) => (
                                                        <div key={ci} className="text-[10px] rounded-lg overflow-hidden">
                                                            <span className="font-black text-slate-400 capitalize">{ch.field}: </span>
                                                            <span className="line-through text-red-400 mr-1">{String(ch.before ?? '—')}</span>
                                                            <span className="text-emerald-400">→ {String(ch.after ?? '—')}</span>
                                                        </div>
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                    );
                                })
                            )}
                        </div>
                    </div>
                </div>
            )}

            {/* FINAL MODULE — Feedback Modal */}
            <FeedbackModal
                open={showFeedback}
                onClose={() => setShowFeedback(false)}
                userId={user.uid}
                screen="settings"
            />

            {/* Recycle Bin Modal */}
            {showRecycleBin && (
                <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-[100] flex items-end sm:items-center justify-center">
                    <div className="w-full h-full sm:max-w-lg sm:max-h-[85vh] sm:rounded-2xl border border-white/10 shadow-2xl overflow-hidden animate-in slide-in-from-bottom-8 duration-300">
                        <RecycleBin user={user} onBack={() => setShowRecycleBin(false)} />
                    </div>
                </div>
            )}

            {/* Factory Reset OTP Verification Modal */}
            {showResetOtp && (
                <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[110] flex items-center justify-center p-4">
                    <div className="w-full max-w-sm rounded-2xl border border-red-500/30 shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200" style={{ background: 'rgba(13,17,40,0.98)' }}>
                        {/* Header */}
                        <div className="p-5 border-b border-white/08">
                            <div className="flex items-center gap-3 mb-1">
                                <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.3)' }}>
                                    <ShieldAlert size={20} style={{ color: '#f87171' }} />
                                </div>
                                <div>
                                    <h3 className="font-black text-[rgba(240,244,255,0.95)]">Verify Identity</h3>
                                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Factory Reset Authorization</p>
                                </div>
                            </div>
                        </div>

                        {/* Body */}
                        <div className="p-5 space-y-4">
                            {/* Email notice */}
                            <div className="flex items-start gap-3 p-3 rounded-xl" style={{ background: 'rgba(59,130,246,0.08)', border: '1px solid rgba(59,130,246,0.2)' }}>
                                <Mail size={16} className="text-blue-400 mt-0.5 shrink-0" />
                                <div>
                                    <p className="text-[11px] font-bold text-blue-300">Verification code sent to:</p>
                                    <p className="text-[11px] text-blue-400 font-mono mt-0.5">{user?.email || 'your email'}</p>
                                </div>
                            </div>

                            {/* Show code (displayed in-app since no email service is connected) */}
                            <div className="p-4 rounded-xl text-center" style={{ background: 'rgba(239,68,68,0.07)', border: '1px dashed rgba(239,68,68,0.3)' }}>
                                <p className="text-[9px] font-black uppercase tracking-widest text-red-400 mb-2">Your Verification Code</p>
                                <div className="flex items-center justify-center gap-2">
                                    {generatedOtp.split('').map((d, i) => (
                                        <span key={i} className="w-9 h-11 flex items-center justify-center rounded-lg font-black text-xl" style={{ background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.25)', color: '#fca5a5' }}>
                                            {d}
                                        </span>
                                    ))}
                                </div>
                                <p className="text-[8px] text-slate-500 mt-2">Tip: Connect an email service to send this automatically</p>
                            </div>

                            {/* Timer */}
                            <div className="flex items-center justify-center gap-2">
                                <Clock size={13} style={{ color: otpSecondsLeft <= 15 ? '#f87171' : '#94a3b8' }} />
                                <span className={`text-[11px] font-black tabular-nums ${otpSecondsLeft <= 15 ? 'text-red-400 animate-pulse' : 'text-slate-400'}`}>
                                    {otpSecondsLeft}s remaining
                                </span>
                            </div>

                            {/* Input */}
                            <div className="relative">
                                <KeyRound size={14} className="absolute left-3 top-3 text-slate-400" />
                                <input
                                    type="text"
                                    inputMode="numeric"
                                    maxLength={6}
                                    value={enteredOtp}
                                    onChange={e => setEnteredOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                                    placeholder="Enter 6-digit code"
                                    disabled={otpSecondsLeft === 0}
                                    className="w-full pl-10 pr-4 py-3 rounded-xl text-sm font-bold tracking-widest outline-none"
                                    style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)', color: 'rgba(240,244,255,0.95)' }}
                                    onKeyDown={e => { if (e.key === 'Enter' && enteredOtp.length === 6) handleOtpVerify(); }}
                                />
                            </div>
                        </div>

                        {/* Footer buttons */}
                        <div className="px-5 pb-5 flex gap-3">
                            <button
                                onClick={() => { setShowResetOtp(false); setEnteredOtp(''); }}
                                className="flex-1 py-3 rounded-xl font-bold text-sm transition-all active:scale-95"
                                style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', color: 'rgba(148,163,184,0.8)' }}
                            >
                                Cancel
                            </button>
                            <button
                                onClick={handleOtpVerify}
                                disabled={enteredOtp.length !== 6 || otpSecondsLeft === 0 || resetLoading}
                                className="flex-1 py-3 rounded-xl font-bold text-sm flex items-center justify-center gap-2 transition-all active:scale-95 disabled:opacity-40"
                                style={{ background: 'rgba(239,68,68,0.25)', border: '1px solid rgba(239,68,68,0.4)', color: '#fca5a5' }}
                            >
                                {resetLoading ? <RefreshCw size={14} className="animate-spin" /> : <ShieldAlert size={14} />}
                                {resetLoading ? 'Resetting...' : 'Verify & Reset'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

// ─────────────────────────────────────────────────────────────────────────
// MODULE 5 — Helpers
// ─────────────────────────────────────────────────────────────────────────

// Known data collections we expect inside a valid backup file. The restore
// is allowed to succeed if AT LEAST ONE of these is present (so partial
// exports — e.g. inventory-only — still work) but we reject files that
// have none of them, which is almost always a wrong-file mistake.
const KNOWN_COLLECTIONS = [
    'ledger_entries',
    'transactions',
    'inventory',
    'parties',
    'vehicles',
    'expenses',
    'settings',
];

interface ValidationResult {
    ok: boolean;
    error: string;
}

/**
 * Validate that the parsed JSON looks like a Shopkeeper backup. Returns
 * a clear, user-facing reason on failure so the toast says exactly what's
 * wrong rather than the catch-all "Invalid backup file format".
 */
function validateBackup(parsed: any): ValidationResult {
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return { ok: false, error: 'Backup file is empty or not in the expected format.' };
    }
    // Allow either a wrapped {version, timestamp, data: {...}} shape or a
    // flat {parties: [...], inventory: [...]} shape (legacy / partial export).
    const data = parsed.data && typeof parsed.data === 'object' ? parsed.data : parsed;
    if (!data || typeof data !== 'object') {
        return { ok: false, error: 'Backup file does not contain a data section.' };
    }
    const matched = KNOWN_COLLECTIONS.filter(k => Array.isArray(data[k]));
    if (matched.length === 0) {
        return {
            ok: false,
            error: 'This file does not look like a Shopkeeper backup. No recognised collections found.',
        };
    }
    return { ok: true, error: '' };
}

/**
 * Build the human-readable preview line shown inside the restore confirm.
 * Example output: "Contains: 12 parties, 47 ledger entries, 23 inventory items".
 * Skips collections with zero items so the dialog stays scannable.
 */
function buildPreviewLine(data: any): string {
    if (!data) return 'Contains: nothing.';
    const labels: Record<string, [string, string]> = {
        parties: ['party', 'parties'],
        inventory: ['inventory item', 'inventory items'],
        ledger_entries: ['ledger entry', 'ledger entries'],
        transactions: ['transaction', 'transactions'],
        vehicles: ['vehicle', 'vehicles'],
        expenses: ['expense', 'expenses'],
        settings: ['setting', 'settings'],
    };
    const parts: string[] = [];
    for (const key of KNOWN_COLLECTIONS) {
        const arr = data[key];
        if (!Array.isArray(arr) || arr.length === 0) continue;
        const [singular, plural] = labels[key] || [key, key];
        parts.push(`${arr.length} ${arr.length === 1 ? singular : plural}`);
    }
    return parts.length ? `Contains: ${parts.join(', ')}.` : 'Contains: nothing yet.';
}

/**
 * Trust card pinned at the top of "Data Management". Subscribes to the
 * LastBackupTracker so it re-renders the moment any backup path completes
 * (web JSON download, native auto-backup, native "Backup Now").
 *
 * Fixed-height empty state: shows "Never backed up yet" with an amber
 * border so the user knows to click "JSON Backup" or "Backup Now".
 */
const LastBackupCard: React.FC<{ userId: string }> = ({ userId }) => {
    const [record, setRecord] = useState(() => LastBackupTracker.get(userId));

    useEffect(() => {
        // Pull fresh on mount + every time something else marks a backup.
        const refresh = () => setRecord(LastBackupTracker.get(userId));
        refresh();
        const unsub = LastBackupTracker.subscribe(refresh);
        // Re-read on tab focus so a backup taken in another tab also shows up.
        const onFocus = () => refresh();
        window.addEventListener('focus', onFocus);
        // Re-render every minute so "5 min ago" doesn't get stale while the
        // settings screen sits open. Not expensive — single setState/min.
        const tick = setInterval(refresh, 60_000);
        return () => {
            unsub();
            window.removeEventListener('focus', onFocus);
            clearInterval(tick);
        };
    }, [userId]);

    const never = !record;
    const label = LastBackupTracker.formatRelative(record);
    const sourceLabel = record?.source === 'manual-json'
        ? 'Web download'
        : record?.source === 'manual-device'
        ? 'Manual (device)'
        : record?.source === 'auto'
        ? 'Auto'
        : '';

    return (
        <div
            className="p-4 rounded-xl mb-4 flex gap-3 items-start"
            style={{
                background: never ? 'rgba(245,158,11,0.07)' : 'rgba(16,185,129,0.07)',
                border: never ? '1px solid rgba(245,158,11,0.22)' : '1px solid rgba(16,185,129,0.22)',
            }}
        >
            <ShieldCheck
                className="shrink-0"
                size={20}
                style={{ color: never ? '#fbbf24' : '#34d399' }}
            />
            <div className="flex-1 min-w-0">
                <h4 className="font-bold text-sm" style={{ color: never ? '#fcd34d' : '#6ee7b7' }}>
                    {never ? 'Never backed up yet' : 'Last backup'}
                </h4>
                <p className="text-xs mt-1" style={{ color: never ? 'rgba(252,211,77,0.78)' : 'rgba(110,231,183,0.85)' }}>
                    {never
                        ? 'Tap "JSON Backup" below to save your first backup.'
                        : <>{label}{sourceLabel ? <span className="ml-1.5 text-[10px] opacity-70">· {sourceLabel}</span> : null}</>}
                </p>
            </div>
        </div>
    );
};







