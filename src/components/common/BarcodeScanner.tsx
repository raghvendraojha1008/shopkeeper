import React, { useState, useRef, useEffect } from 'react';
import { Camera, X, AlertCircle, Loader2 } from 'lucide-react';
import { ScannerService } from '../../services/scanner';
import { Capacitor } from '@capacitor/core';

interface BarcodeScannerProps {
  onScan: (barcode: string) => void;
  onClose: () => void;
  title?: string;
  description?: string;
}

const BarcodeScanner: React.FC<BarcodeScannerProps> = ({
  onScan,
  onClose,
  title = 'Scan Barcode',
  description = 'Point your camera at the barcode to scan',
}) => {
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [manualInput, setManualInput] = useState('');
  const [isNative, setIsNative] = useState(false);

  useEffect(() => {
    setIsNative(Capacitor.isNativePlatform());
  }, []);

  // Hide app bottom navigation while the scanner is open so the keyboard
  // doesn't push the nav up over the manual-entry input on Android.
  useEffect(() => {
    document.body.classList.add('scanner-open');
    return () => { document.body.classList.remove('scanner-open'); };
  }, []);

  const handleNativeScan = async () => {
    setScanning(true);
    setError(null);
    try {
      const result = await ScannerService.scan();
      if (result) {
        onScan(result);
        setScanning(false);
        onClose();
      } else {
        setError('No barcode detected. Please try again.');
        setScanning(false);
      }
    } catch (err: any) {
      setError(err.message || 'Scanning failed. Please try again.');
      setScanning(false);
    }
  };

  const handleManualSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (manualInput.trim()) {
      onScan(manualInput.trim());
      setManualInput('');
      onClose();
    }
  };

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-in fade-in duration-200">
      <div
        className="rounded-3xl max-w-sm w-full p-6 shadow-2xl animate-in zoom-in duration-300"
        style={{ background: '#0f1221', border: '1px solid rgba(255,255,255,0.1)', color: 'rgba(240,244,255,0.9)' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-[rgba(59,130,246,0.15)]">
              <Camera size={24} className="text-blue-400" />
            </div>
            <div>
              <h2 className="text-lg font-black ">{title}</h2>
              <p className="text-xs text-[rgba(148,163,184,0.55)] mt-0.5">{description}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-slate-100 hover:bg-[rgba(255,255,255,0.08)] rounded-xl transition-colors"
          >
            <X size={20} className="" style={{color:"rgba(148,163,184,0.45)"}} />
          </button>
        </div>

        {/* Native Camera Scanner */}
        {isNative && (
          <div className="mb-6">
            <button
              onClick={handleNativeScan}
              disabled={scanning}
              className="w-full p-4 bg-gradient-to-br from-blue-500 to-blue-600 hover:from-blue-600 hover:to-blue-700 disabled:from-blue-400 disabled:to-blue-500 text-white rounded-2xl font-bold text-sm flex items-center justify-center gap-2 transition-all active:scale-95 disabled:opacity-70"
            >
              {scanning ? (
                <>
                  <Loader2 size={18} className="animate-spin" />
                  Scanning...
                </>
              ) : (
                <>
                  <Camera size={18} />
                  Open Camera to Scan
                </>
              )}
            </button>
            <p className="text-xs text-[rgba(148,163,184,0.55)] text-center mt-3">
              or enter barcode manually below
            </p>
          </div>
        )}

        {/* Error Message */}
        {error && (
          <div className="mb-4 p-3 bg-[rgba(239,68,68,0.1)] border border-[rgba(239,68,68,0.25)] rounded-xl flex items-start gap-2">
            <AlertCircle size={16} className="text-red-400 mt-0.5 flex-shrink-0" />
            <p className="text-xs text-red-400">{error}</p>
          </div>
        )}

        {/* Manual Input */}
        <form onSubmit={handleManualSubmit} className="space-y-3">
          <div>
            <label className="block text-xs font-bold text-[rgba(203,213,225,0.75)] mb-2">
              Enter Barcode Manually
            </label>
            <input
              type="text"
              value={manualInput}
              onChange={(e) => setManualInput(e.target.value)}
              placeholder="Scan or type barcode here..."
              className="w-full dark-input rounded-xl p-3 text-sm font-bold outline-none focus:ring-2 focus:ring-violet-500/40 transition-all"
              autoFocus
            />
          </div>

          <div className="flex gap-2 pt-2">
            <button
              type="submit"
              disabled={!manualInput.trim()}
              className="flex-1 p-3 text-white rounded-xl font-bold text-sm transition-all active:scale-95 disabled:cursor-not-allowed disabled:opacity-50" style={{background:"linear-gradient(135deg,#4f46e5,#7c3aed)"}}
            >
              Search Product
            </button>
            <button
              type="button"
              onClick={onClose}
              className="flex-1 p-3 bg-[rgba(255,255,255,0.09)] hover:bg-[rgba(255,255,255,0.13)] rounded-xl font-bold text-sm transition-all active:scale-95"
            >
              Cancel
            </button>
          </div>
        </form>

        {/* Info Box */}
        <div className="mt-4 p-3 bg-[rgba(59,130,246,0.08)] border border-[rgba(59,130,246,0.2)] rounded-xl">
          <p className="text-xs text-[#93c5fd] leading-relaxed">
            <strong>Tip:</strong> {isNative ? 'Press "Open Camera" to scan using your device camera, or type the barcode manually.' : 'Enter the barcode code to search for products in your inventory.'}
          </p>
        </div>
      </div>
    </div>
  );
};

export default BarcodeScanner;







