import React, { useState } from 'react';
import { Upload, Download, X, CheckCircle, AlertCircle, Loader2 } from 'lucide-react';
import * as XLSX from 'xlsx';
import { writeBatch, doc, collection, getDocs } from 'firebase/firestore';
import { db } from '../../config/firebase';
import { useUI } from '../../context/UIContext';
import { exportService } from '../../services/export';
import {
  generatePrefixedID, seedCountersFromFirestore,
  generatePartyCode, seedPartyCounter,
} from '../../utils/idGenerator';

const { read, utils } = XLSX;

interface BulkImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  entityType: 'inventory' | 'parties' | 'expenses';
  userId: string;
  onImportComplete: (results: ImportResults) => void;
}

interface ImportResults {
  successful: number;
  failed: number;
  errors: Array<{ row: number; field: string; error: string }>;
}

// Each entry: display header → internal field name
const COLUMN_MAPPINGS = {
  inventory: {
    required: ['name', 'sale_rate', 'purchase_rate', 'current_stock', 'unit'],
    optional: ['category', 'hsn_code', 'gst_percent', 'price_type', 'min_stock', 'primary_supplier'],
    displayName: 'Inventory Items',
    template: {
      'Item Name':        'e.g. Rice',
      'Category':         'e.g. Grains',
      'Sale Rate':        '100',
      'Purchase Rate':    '80',
      'Current Stock':    '50',
      'Min Stock':        '10',
      'Unit':             'Kg',
      'HSN Code':         '1006',
      'GST %':            '5',
      'GST Type':         'exclusive',
      'Primary Supplier': 'Supplier Name',
    },
    headerToField: {
      'Item Name':        'name',
      'Category':         'category',
      'Sale Rate':        'sale_rate',
      'Purchase Rate':    'purchase_rate',
      'Current Stock':    'current_stock',
      'Min Stock':        'min_stock',
      'Unit':             'unit',
      'HSN Code':         'hsn_code',
      'GST %':            'gst_percent',
      'GST Type':         'price_type',
      'Primary Supplier': 'primary_supplier',
    } as Record<string, string>,
  },
  parties: {
    required: ['name', 'role'],
    optional: ['contact', 'address', 'gstin', 'legal_name', 'site', 'state', 'credit_limit'],
    displayName: 'Parties (Customers/Suppliers)',
    template: {
      'Party Name':              'e.g. ABC Traders',
      'Role (customer/supplier)': 'customer',
      'Contact':                 '9876543210',
      'Address':                 'City, State',
      'GSTIN':                   '27XXXXX',
      'Legal Name':              'ABC Pvt Ltd',
      'Site':                    'Main Branch',
      'State':                   'Maharashtra',
      'Credit Limit':            '50000',
    },
    headerToField: {
      'Party Name':               'name',
      'Role (customer/supplier)': 'role',
      'Contact':                  'contact',
      'Address':                  'address',
      'GSTIN':                    'gstin',
      'Legal Name':               'legal_name',
      'Site':                     'site',
      'State':                    'state',
      'Credit Limit':             'credit_limit',
    } as Record<string, string>,
  },
  expenses: {
    required: ['date', 'category', 'amount'],
    optional: ['notes'],
    displayName: 'Expenses',
    template: {
      'Date (YYYY-MM-DD)': '2024-01-15',
      'Category':          'Fuel',
      'Amount':            '500',
      'Notes':             'Optional description',
    },
    headerToField: {
      'Date (YYYY-MM-DD)': 'date',
      'Category':          'category',
      'Amount':            'amount',
      'Notes':             'notes',
    } as Record<string, string>,
  },
} as const;

type StepType = 'upload' | 'mapping' | 'validation' | 'progress';

export const BulkImportModal: React.FC<BulkImportModalProps> = ({
  isOpen,
  onClose,
  entityType,
  userId,
  onImportComplete,
}) => {
  // FIX: Removed duplicate/conflicting step state variables (`step` vs `currentStep`)
  // and the unused `rawData` state.  There is now a single `step` variable.
  const [step, setStep] = useState<StepType>('upload');
  const { showToast } = useUI();
  const [uploadedData, setUploadedData] = useState<Record<string, any>[] | null>(null);
  const [columnMapping, setColumnMapping] = useState<Record<string, string>>({});
  const [validationErrors, setValidationErrors] = useState<ImportResults['errors']>([]);
  const [importProgress, setImportProgress] = useState({ current: 0, total: 0 });
  const [isImporting, setIsImporting] = useState(false);

  const config = COLUMN_MAPPINGS[entityType];

  const downloadTemplate = async () => {
    const ws = utils.json_to_sheet([config.template]);
    const wb = utils.book_new();
    utils.book_append_sheet(wb, ws, 'Template');
    const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    const blob = new Blob([wbout], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    await exportService.sharePdfBlob(blob, `${entityType}_import_template.xlsx`);
    showToast('Template ready to share', 'success');
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const data = event.target?.result;
        const workbook = read(data, { type: 'array' });
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        const parsed = utils.sheet_to_json(worksheet) as Record<string, any>[];
        setUploadedData(parsed);

        // Auto-map columns whose headers match our known headerToField entries
        const autoMapping: Record<string, string> = {};
        if (parsed.length > 0) {
          Object.keys(parsed[0]).forEach(header => {
            const field = (config as any).headerToField?.[header];
            if (field) autoMapping[header] = field;
          });
        }
        setColumnMapping(autoMapping);
        setStep('mapping');
      } catch (err) {
        showToast('Failed to parse file', 'error');
      }
    };
    reader.readAsArrayBuffer(file);
  };

  const validateData = () => {
    if (!uploadedData) return;
    const errors: ImportResults['errors'] = [];

    uploadedData.forEach((row, idx) => {
      config.required.forEach((field) => {
        const excelCol = Object.keys(columnMapping).find(k => columnMapping[k] === field) || '';
        const value = row[excelCol];
        if (!value || value.toString().trim() === '') {
          errors.push({ row: idx + 2, field, error: `${field} is required` });
        }
      });

      if (entityType === 'inventory') {
        const saleRateCol = Object.keys(columnMapping).find(k => columnMapping[k] === 'sale_rate') || '';
        const saleRate = row[saleRateCol];
        if (saleRate && isNaN(Number(saleRate))) {
          errors.push({ row: idx + 2, field: 'sale_rate', error: 'Sale rate must be a number' });
        }
        const stockCol = Object.keys(columnMapping).find(k => columnMapping[k] === 'current_stock') || '';
        const stock = row[stockCol];
        if (stock && isNaN(Number(stock))) {
          errors.push({ row: idx + 2, field: 'current_stock', error: 'Stock must be a number' });
        }
      }

      if (entityType === 'expenses') {
        const dateCol   = Object.keys(columnMapping).find(k => columnMapping[k] === 'date')   || '';
        const amountCol = Object.keys(columnMapping).find(k => columnMapping[k] === 'amount') || '';
        const date   = row[dateCol];
        const amount = row[amountCol];
        if (date && isNaN(Date.parse(date.toString()))) {
          errors.push({ row: idx + 2, field: 'date', error: 'Invalid date format (use YYYY-MM-DD)' });
        }
        if (amount && isNaN(Number(amount))) {
          errors.push({ row: idx + 2, field: 'amount', error: 'Amount must be a number' });
        }
      }
    });

    setValidationErrors(errors);
    setStep(errors.length === 0 ? 'progress' : 'validation');
  };

  // FIX: The old implementation wrote one document per Firestore call (sequential),
  // meaning 500 rows triggered 1 000 serial round-trips.  We now use writeBatch()
  // chunked at 450 ops, matching the backup/restore strategy.
  const performImport = async () => {
    if (!uploadedData) return;

    setIsImporting(true);
    setImportProgress({ current: 0, total: uploadedData.length });

    // Pre-seed ID counters from existing Firestore records so generated IDs
    // never collide with records already in the database.
    try {
      if (entityType === 'inventory') {
        const snap = await getDocs(collection(db, `users/${userId}/inventory`));
        seedCountersFromFirestore(snap.docs.map(d => (d.data() as any).item_id), 'inventory');
      } else if (entityType === 'parties') {
        const snap = await getDocs(collection(db, `users/${userId}/parties`));
        seedPartyCounter(snap.docs.map(d => (d.data() as any).party_code));
      } else if (entityType === 'expenses') {
        const snap = await getDocs(collection(db, `users/${userId}/expenses`));
        seedCountersFromFirestore(snap.docs.map(d => (d.data() as any).expense_no), 'expenses');
      }
    } catch { /* non-fatal — IDs will still be unique within this batch */ }

    const MAX_BATCH = 450;
    let batch = writeBatch(db);
    let opCount = 0;
    let successful = 0;
    let failed = 0;

    const reverseMapping: Record<string, string> = {};
    Object.entries(columnMapping).forEach(([excelCol, appField]) => {
      reverseMapping[appField] = excelCol;
    });

    for (let i = 0; i < uploadedData.length; i++) {
      const row = uploadedData[i];

      const docData: Record<string, any> = { created_at: new Date().toISOString() };
      Object.entries(reverseMapping).forEach(([appField, excelCol]) => {
        let value = row[excelCol];
        if (['sale_rate', 'purchase_rate', 'current_stock', 'min_stock', 'amount', 'gst_percent', 'credit_limit'].includes(appField)) {
          value = Number(value) || 0;
        }
        docData[appField] = value;
      });

      if (entityType === 'inventory') {
        if (!docData.price_type) docData.price_type = 'exclusive';
        if (!docData.item_id) docData.item_id = generatePrefixedID('inventory');
      }
      if (entityType === 'parties' && !docData.party_code) {
        docData.party_code = generatePartyCode(
          docData.role === 'supplier' ? 'supplier' : 'customer'
        );
      }
      if (entityType === 'expenses' && !docData.expense_no) {
        docData.expense_no = generatePrefixedID('expenses');
      }

      try {
        const ref = doc(collection(db, `users/${userId}/${entityType}`));
        batch.set(ref, docData);
        opCount++;
        successful++;

        if (opCount >= MAX_BATCH) {
          await batch.commit();
          batch = writeBatch(db);
          opCount = 0;
        }
      } catch (err: any) {
        console.error(`[BulkImport] Row ${i + 2} error:`, err);
        failed++;
      }

      setImportProgress({ current: i + 1, total: uploadedData.length });
    }

    // Commit remaining
    if (opCount > 0) {
      try {
        await batch.commit();
      } catch (err) {
        console.error('[BulkImport] Final batch commit error:', err);
      }
    }

    setIsImporting(false);
    onImportComplete({ successful, failed, errors: [] });
    showToast(
      `Imported ${successful} items${failed > 0 ? `, ${failed} failed` : ''}`,
      successful > 0 ? 'success' : 'error',
    );
    setTimeout(() => onClose(), 2000);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 backdrop-blur-sm">
      <div className="rounded-2xl shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto border border-white/10" style={{ background: 'var(--app-bg)' }}>
        {/* Header */}
        <div className="sticky top-0 p-6 flex justify-between items-center border-b border-white/08" style={{ background: 'linear-gradient(135deg,#4f46e5,#7c3aed)' }}>
          <div>
            <h2 className="text-2xl font-black text-white">Bulk Import</h2>
            <p className="text-violet-200 text-sm mt-1">{config.displayName}</p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-white/20 rounded-lg transition text-white">
            <X size={24} />
          </button>
        </div>

        {/* Content */}
        <div className="p-6" style={{ background: 'var(--app-bg)' }}>
          {step === 'upload' && (
            <div className="space-y-4">
              <div className="p-8 border-2 border-dashed border-[var(--col-violet-35)] rounded-2xl text-center bg-[var(--col-violet-08)]">
                <Upload size={48} className="mx-auto text-blue-600 mb-3" />
                <p className="font-bold mb-2">Upload CSV or Excel File</p>
                <p className="text-sm text-[var(--text-muted)] mb-4">Drag and drop or click to select</p>
                <input type="file" accept=".csv,.xlsx,.xls" onChange={handleFileUpload} className="mx-auto block" />
              </div>
              <button
                onClick={downloadTemplate}
                className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl font-bold text-sm transition glass-icon-btn"
              >
                <Download size={18} />
                Download Template
              </button>
            </div>
          )}

          {step === 'mapping' && uploadedData && (
            <div className="space-y-4">
              <p className="text-sm text-[var(--text-muted)]">Found {uploadedData.length} rows. Map your columns:</p>
              <div className="max-h-64 overflow-y-auto space-y-2">
                {Object.keys(uploadedData[0] || {}).map((header) => (
                  <div key={header} className="flex items-center gap-3">
                    <label className="w-40 text-sm font-bold text-[var(--text-secondary)]">{header}</label>
                    <select
                      value={columnMapping[header] || ''}
                      onChange={(e) => setColumnMapping({ ...columnMapping, [header]: e.target.value })}
                      className="flex-1 px-3 py-2 dark-input rounded-lg text-sm"
                    >
                      <option value="">-- Don't Import --</option>
                      {[...config.required, ...config.optional].map((field) => (
                        <option key={field} value={field}>{field}</option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>
              <button
                onClick={validateData}
                className="w-full px-4 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-bold transition"
              >
                Continue to Validation
              </button>
            </div>
          )}

          {step === 'validation' && (
            <div className="space-y-4">
              {validationErrors.length > 0 ? (
                <>
                  <div className="p-4 bg-[var(--col-danger-12)] border border-[var(--col-danger-25)] rounded-xl">
                    <p className="font-bold text-col-danger flex items-center gap-2">
                      <AlertCircle size={20} />
                      {validationErrors.length} Errors Found
                    </p>
                  </div>
                  <div className="max-h-64 overflow-y-auto space-y-2">
                    {validationErrors.map((error, idx) => (
                      <div key={idx} className="p-3 bg-[var(--col-danger-10)] border border-[var(--col-danger-18)] rounded-lg text-sm">
                        <p className="font-bold text-col-danger">Row {error.row}: {error.field}</p>
                        <p className="text-col-danger-light">{error.error}</p>
                      </div>
                    ))}
                  </div>
                  <button onClick={() => setStep('mapping')} className="w-full px-4 py-3 bg-[var(--rgba-white-08)] hover:bg-[var(--rgba-white-12)] rounded-xl font-bold transition">
                    Fix Mapping
                  </button>
                </>
              ) : (
                <>
                  <div className="p-4 bg-[var(--col-emerald-10)] border border-[var(--col-emerald-25)] rounded-xl">
                    <p className="font-bold text-col-success flex items-center gap-2">
                      <CheckCircle size={20} />
                      All {uploadedData?.length} rows validated successfully
                    </p>
                  </div>
                  <button
                    onClick={performImport}
                    disabled={isImporting}
                    className="w-full px-4 py-3 rounded-xl font-bold transition disabled:cursor-not-allowed text-white disabled:opacity-50"
                    style={{ background: 'linear-gradient(135deg,#4f46e5,#7c3aed)' }}
                  >
                    {isImporting ? 'Importing...' : 'Start Import'}
                  </button>
                </>
              )}
            </div>
          )}

          {step === 'progress' && (
            <div className="space-y-4">
              <div className="flex justify-between mb-2">
                <span className="font-bold">Progress</span>
                <span className="text-sm text-[var(--text-muted)]">
                  {importProgress.current} / {importProgress.total}
                </span>
              </div>
              <div className="w-full bg-[var(--rgba-white-09)] rounded-full h-3 overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-blue-500 to-blue-600 transition-all duration-300"
                  style={{ width: `${importProgress.total > 0 ? (importProgress.current / importProgress.total) * 100 : 0}%` }}
                />
              </div>
              {isImporting && (
                <div className="flex items-center justify-center gap-2 text-[var(--text-muted)] mt-4">
                  <Loader2 className="animate-spin" size={20} />
                  <span>Importing...</span>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default BulkImportModal;

