import React, { useState, useEffect } from 'react';
import { User } from 'firebase/auth';
import { ArrowLeft, Trash2, RotateCcw, Clock } from 'lucide-react';
import { TrashService, DeletedItem } from '../../services/trash';
import { useUI } from '../../context/UIContext';
import { haptic } from '../../utils/haptics';
import { useEditPassword } from '../../context/EditPasswordContext';

interface RecycleBinProps { user: User; onBack: () => void; }

const RecycleBin: React.FC<RecycleBinProps> = ({ user, onBack }) => {
    const { showToast, confirm } = useUI();
    const { requireEditPassword } = useEditPassword();
    const [items, setItems] = useState<DeletedItem[]>([]);
    const [loading, setLoading] = useState(true);

    const loadItems = async () => {
        setLoading(true);
        try {
            const data = await TrashService.getTrashItems(user.uid);
            data.sort((a, b) => new Date(b.deleted_at).getTime() - new Date(a.deleted_at).getTime());
            setItems(data);
        } catch (e) { console.error(e); showToast("Failed to load bin", "error"); }
        finally { setLoading(false); }
    };

    useEffect(() => { loadItems(); }, [user]);

    const handleRestore = async (item: DeletedItem) => {
        const label = item.data.party_name || item.data.name || item.data.vehicle_number || item.data.notes || 'this item';
        const confirmed = await confirm('Restore Item?', `Restore "${label}" back to your data?`);
        if (!confirmed) return;
        haptic.medium();
        try {
            const result = await TrashService.restoreItem(user.uid, item);
            setItems(prev => prev.filter(i => i.id !== item.id));
            showToast(result.usedNewId ? "Restored as new record (original ID was reused)" : "Item Restored", "success");
            haptic.success();
        } catch (e) { showToast("Restore failed", "error"); haptic.error(); }
    };

    const handlePermanentDelete = async (item: DeletedItem) => {
        const authed = await requireEditPassword('delete');
        if (!authed) return;
        if (await confirm("Delete Forever?", "This item will be permanently deleted and cannot be recovered.")) {
            haptic.heavy();
            try {
                await TrashService.permanentDelete(user.uid, item.id);
                setItems(prev => prev.filter(i => i.id !== item.id));
                showToast("Permanently Deleted", "success");
            } catch (e) { showToast("Delete failed", "error"); }
        }
    };

    const getIcon = (col: string) => {
        if (col.includes('ledger')) return "📖";
        if (col.includes('inventory')) return "📦";
        if (col.includes('transactions')) return "💰";
        if (col.includes('parties')) return "👥";
        if (col.includes('vehicles')) return "🚚";
        if (col.includes('expenses')) return "💸";
        return "📄";
    };

    const getDaysColor = (days: number) => {
        if (days <= 5) return { text: "var(--col-red)", bg: 'var(--col-danger-12)', border: 'var(--col-danger-25)' };
        if (days <= 10) return { text: "var(--col-orange)", bg: 'rgba(249,115,22,0.12)', border: 'rgba(249,115,22,0.2)' };
        return { text: "var(--col-success-light)", bg: 'var(--col-emerald-15)', border: 'var(--col-emerald-18)' };
    };

    return (
        <div className="flex flex-col h-full px-4 pb-6" style={{ background: 'var(--app-bg)', paddingTop: 'max(8px, env(safe-area-inset-top, 8px))' }}>
            <div className="flex items-center gap-3 mb-4 mt-2">
                <button onClick={onBack} className="p-2 rounded-full glass-icon-btn">
                    <ArrowLeft size={20} className="text-[var(--text-primary)]" />
                </button>
                <div>
                    <h1 className="text-xl font-black text-[var(--text-primary)]">Recycle Bin</h1>
                    <p className="text-app-sm text-[var(--text-muted)]">Items auto-delete after 30 days</p>
                </div>
            </div>

            {loading ? (
                <div className="flex-1 flex justify-center items-center text-[var(--text-muted)]">Loading...</div>
            ) : items.length === 0 ? (
                <div className="flex-1 flex flex-col items-center justify-center text-center opacity-50 space-y-4">
                    <Trash2 size={64} className="text-[var(--rgba-white-20)]" />
                    <h3 className="text-lg font-bold text-[var(--text-muted)]">Bin is Empty</h3>
                    <p className="text-xs text-[var(--text-muted)] max-w-[200px]">
                        Deleted items appear here for 30 days before permanent deletion.
                    </p>
                </div>
            ) : (
                <div className="flex-1 overflow-y-auto space-y-3 pb-20">
                    <p className="text-app-sm font-bold text-[var(--text-muted)] uppercase tracking-widest px-1 mb-2">
                        {items.length} item{items.length !== 1 ? 's' : ''} · Stored up to 30 days
                    </p>
                    {items.map(item => {
                        const days = TrashService.daysRemaining(item.deleted_at);
                        const dayColor = getDaysColor(days);
                        return (
                            <div key={item.id}
                                className="p-4 rounded-[18px] flex justify-between items-start gap-3"
                                style={{ background:  'var(--rgba-white-09)', border: '1px solid var(--glass-border)' }}>
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                                        <span className="text-base">{getIcon(item.collection_name)}</span>
                                        <span className="text-app-sm font-bold px-2 py-0.5 rounded-full"
                                            style={{ background: dayColor.bg, color: dayColor.text, border: `1px solid ${dayColor.border}` }}>
                                            <Clock size={8} className="inline mr-1" />
                                            {days}d left
                                        </span>
                                        <span className="text-app-xs text-[var(--text-muted)]">
                                            {new Date(item.deleted_at).toLocaleDateString()}
                                        </span>
                                    </div>
                                    <div className="font-bold text-sm text-[var(--text-secondary)] truncate">
                                        {item.data.party_name || item.data.name || item.data.vehicle_number || item.data.notes || 'Unknown Item'}
                                    </div>
                                    <div className="text-app-sm text-[var(--text-muted)] capitalize mt-0.5">
                                        {item.collection_name.replace(/_/g, ' ')}
                                        {item.data.total_amount ? ` · ₹${item.data.total_amount}` : ''}
                                        {item.data.amount ? ` · ₹${item.data.amount}` : ''}
                                    </div>
                                </div>
                                <div className="flex gap-2 flex-shrink-0">
                                    <button onClick={() => handleRestore(item)}
                                        className="p-2.5 rounded-[12px] active:scale-95 transition-all"
                                        style={{ background: 'var(--col-emerald-22)', border: '1px solid var(--col-emerald-35)' }}
                                        title="Restore">
                                        <RotateCcw size={16} style={{ color: "var(--col-success)" }} />
                                    </button>
                                    <button onClick={() => handlePermanentDelete(item)}
                                        className="p-2.5 rounded-[12px] active:scale-95 transition-all"
                                        style={{ background: 'var(--col-danger-25)', border: '1px solid rgba(239,68,68,0.32)' }}
                                        title="Delete forever">
                                        <Trash2 size={16} style={{ color: "var(--col-danger)" }} />
                                    </button>
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
};
export default RecycleBin;
