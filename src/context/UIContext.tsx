import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { BackStack } from '../services/backStack';
import Toast, { ToastType } from '../components/common/Toast';
import ConfirmDialog from '../components/common/ConfirmDialog';

interface ToastData { 
    id: string; 
    message: string; 
    type: ToastType;
    actionLabel?: string;
    onAction?: () => void;
}

interface UIContextType {
  showToast: (message: string, type?: ToastType, actionLabel?: string, onAction?: () => void) => void;
  confirm: (title: string, message: string) => Promise<boolean>;
}

const UIContext = createContext<UIContextType | null>(null);

export const UIProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [toasts, setToasts] = useState<ToastData[]>([]);
  const [confirmState, setConfirmState] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    resolve: ((value: boolean) => void) | null;
  }>({ isOpen: false, title: '', message: '', resolve: null });

  const showToast = useCallback((message: string, type: ToastType = 'success', actionLabel?: string, onAction?: () => void) => {
    const id = Date.now().toString();
    // FIX 13: Cap at 5 toasts to prevent unbounded state growth
    setToasts(prev => [...prev.slice(-4), { id, message, type, actionLabel, onAction }]);
  }, []);

  const closeToast = useCallback((id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  const confirm = useCallback((title: string, message: string): Promise<boolean> => {
    return new Promise((resolve) => {
      // FIX 8: Cancel any existing dangling promise first, then open new one
      setConfirmState(prev => {
        if (prev.resolve) prev.resolve(false); // auto-cancel previous if open
        return { isOpen: true, title, message, resolve };
      });
    });
  }, []);

  const handleConfirm = () => { if (confirmState.resolve) confirmState.resolve(true); setConfirmState(prev => ({ ...prev, isOpen: false })); };
  const handleCancel = () => { if (confirmState.resolve) confirmState.resolve(false); setConfirmState(prev => ({ ...prev, isOpen: false })); };

  // Register ConfirmDialog with the central BackStack so Android back cancels it
  useEffect(() => {
    if (!confirmState.isOpen) return;
    const DIALOG_ID = 'ui-confirm-dialog';
    BackStack.register(DIALOG_ID, handleCancel, 100);
    return () => BackStack.unregister(DIALOG_ID);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [confirmState.isOpen]);

  return (
    <UIContext.Provider value={{ showToast, confirm }}>
      {children}
      
      {/* Toast container - positioned safely below status bar */}
      <div className="fixed left-3 right-3 z-[300] flex flex-col gap-2 pointer-events-none transition-all duration-300"
        style={{ top: 'max(16px, calc(env(safe-area-inset-top, 0px) + 8px))', maxWidth: '100vw' }}>
        <div className="pointer-events-auto flex flex-col gap-2 items-center w-full">
            {toasts.map(t => (
                <Toast key={t.id} {...t} onClose={closeToast} />
            ))}
        </div>
      </div>

      <ConfirmDialog 
        isOpen={confirmState.isOpen} 
        title={confirmState.title} 
        message={confirmState.message} 
        onConfirm={handleConfirm} 
        onCancel={handleCancel} 
      />
    </UIContext.Provider>
  );
};

export const useUI = () => {
  const context = useContext(UIContext);
  if (!context) throw new Error("useUI must be used within a UIProvider");
  return context;
};







