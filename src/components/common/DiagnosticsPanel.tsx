import React, { useState, useEffect } from 'react';
import { ChevronDown, Copy, X } from 'lucide-react';
import { diagnosticLogger } from '../../utils/diagnosticLogger';

/**
 * Debug panel that shows recent error logs from the diagnostic logger
 * Press Ctrl+Shift+D to toggle (or long-press device back button)
 * 
 * Only visible in development or when explicitly enabled
 */
const DiagnosticsPanel: React.FC = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [logs, setLogs] = useState<string>('');
  const [showPanel, setShowPanel] = useState(false);

  // Enable diagnostics panel with keyboard shortcut
  useEffect(() => {
    const handleKeyPress = (e: KeyboardEvent) => {
      // Ctrl+Shift+D to toggle diagnostics
      if (e.ctrlKey && e.shiftKey && e.key === 'D') {
        setShowPanel(prev => !prev);
      }
    };

    window.addEventListener('keydown', handleKeyPress);
    return () => window.removeEventListener('keydown', handleKeyPress);
  }, []);

  const handleOpen = () => {
    setLogs(diagnosticLogger.getLogs());
    setIsOpen(true);
  };

  const handleCopy = () => {
    const text = diagnosticLogger.getLogs();
    navigator.clipboard.writeText(text).then(() => {
      alert('Diagnostics copied to clipboard');
    });
  };

  const handleDump = () => {
    diagnosticLogger.dumpToConsole();
    alert('Diagnostics dumped to console - check logcat or DevTools');
  };

  if (!showPanel) return null;

  return (
    <div className="fixed bottom-4 right-4 z-[999] max-w-sm">
      {!isOpen ? (
        <button
          onClick={handleOpen}
          className="px-3 py-2 rounded-lg bg-red-500/20 border border-red-500/50 text-red-300 text-xs font-mono hover:bg-red-500/30"
        >
          📋 Debug Logs
        </button>
      ) : (
        <div className="bg-gray-900 border border-gray-700 rounded-lg shadow-xl overflow-hidden">
          <div className="flex items-center justify-between bg-gray-800 px-3 py-2 border-b border-gray-700">
            <div className="flex items-center gap-2">
              <ChevronDown size={14} className="text-gray-400" />
              <span className="text-xs font-bold text-gray-300">Diagnostics</span>
            </div>
            <div className="flex gap-1">
              <button
                onClick={handleCopy}
                className="p-1 hover:bg-gray-700 rounded transition-colors"
                title="Copy to clipboard"
              >
                <Copy size={14} className="text-gray-400" />
              </button>
              <button
                onClick={handleDump}
                className="p-1 hover:bg-gray-700 rounded transition-colors text-[10px]"
                title="Dump to console"
              >
                🔍
              </button>
              <button
                onClick={() => setIsOpen(false)}
                className="p-1 hover:bg-gray-700 rounded transition-colors"
              >
                <X size={14} className="text-gray-400" />
              </button>
            </div>
          </div>
          <div className="bg-gray-950 p-3 max-h-64 overflow-y-auto font-mono text-[10px] text-gray-300 space-y-1">
            {logs ? (
              logs.split('\n').map((line, i) => (
                <div key={i} className="whitespace-pre-wrap break-words">
                  {line}
                </div>
              ))
            ) : (
              <div className="text-gray-500">No errors logged yet</div>
            )}
          </div>
          <div className="bg-gray-800 px-3 py-2 border-t border-gray-700 text-[10px] text-gray-400">
            Ctrl+Shift+D to toggle • Logs auto-clear after {100} entries
          </div>
        </div>
      )}
    </div>
  );
};

export default DiagnosticsPanel;
