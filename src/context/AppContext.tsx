import React, { createContext, useContext, useState, useCallback, useEffect, ReactNode } from 'react';
import { User } from 'firebase/auth';
import { AppSettings } from '../types';
import { DEFAULT_SETTINGS } from '../config/constants';

// Unified App State
interface AppState {
  user: User | null;
  appSettings: AppSettings;
  activeTab: string;
  isOnline: boolean;
  pendingSync: number;
}

interface AppContextType {
  state: AppState;
  setUser: (user: User | null) => void;
  setAppSettings: (settings: AppSettings) => void;
  updateAppSettings: (partial: Partial<AppSettings>) => void;
  setActiveTab: (tab: string) => void;
  setOnlineStatus: (online: boolean) => void;
  incrementPendingSync: () => void;
  decrementPendingSync: () => void;
}

const AppContext = createContext<AppContextType | null>(null);

export const AppContextProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [state, setState] = useState<AppState>({
    user: null,
    appSettings: DEFAULT_SETTINGS,
    activeTab: 'dashboard',
    // FIX: initialise from navigator.onLine (unchanged), but also subscribe to
    // window online/offline events so isOnline tracks the real network state
    // instead of being a stale snapshot taken only at app startup.
    isOnline: navigator.onLine,
    pendingSync: 0,
  });

  // FIX: Keep isOnline in sync with actual connectivity events.
  useEffect(() => {
    const handleOnline  = () => setState(prev => ({ ...prev, isOnline: true  }));
    const handleOffline = () => setState(prev => ({ ...prev, isOnline: false }));

    window.addEventListener('online',  handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online',  handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  const setUser = useCallback((user: User | null) => {
    setState(prev => ({ ...prev, user }));
  }, []);

  const setAppSettings = useCallback((appSettings: AppSettings) => {
    setState(prev => ({ ...prev, appSettings }));
  }, []);

  const updateAppSettings = useCallback((partial: Partial<AppSettings>) => {
    setState(prev => ({
      ...prev,
      appSettings: { ...prev.appSettings, ...partial },
    }));
  }, []);

  const setActiveTab = useCallback((activeTab: string) => {
    setState(prev => ({ ...prev, activeTab }));
  }, []);

  const setOnlineStatus = useCallback((isOnline: boolean) => {
    setState(prev => ({ ...prev, isOnline }));
  }, []);

  const incrementPendingSync = useCallback(() => {
    setState(prev => ({ ...prev, pendingSync: prev.pendingSync + 1 }));
  }, []);

  const decrementPendingSync = useCallback(() => {
    setState(prev => ({ ...prev, pendingSync: Math.max(0, prev.pendingSync - 1) }));
  }, []);

  return (
    <AppContext.Provider
      value={{
        state,
        setUser,
        setAppSettings,
        updateAppSettings,
        setActiveTab,
        setOnlineStatus,
        incrementPendingSync,
        decrementPendingSync,
      }}
    >
      {children}
    </AppContext.Provider>
  );
};

export const useAppContext = () => {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error('useAppContext must be used within AppContextProvider');
  }
  return context;
};

// Convenience hooks
export const useAppSettings = () => {
  const { state, setAppSettings, updateAppSettings } = useAppContext();
  return {
    appSettings: state.appSettings,
    setAppSettings,
    updateAppSettings,
  };
};

export const useOnlineStatus = () => {
  const { state, setOnlineStatus, incrementPendingSync, decrementPendingSync } = useAppContext();
  return {
    isOnline: state.isOnline,
    pendingSync: state.pendingSync,
    setOnlineStatus,
    incrementPendingSync,
    decrementPendingSync,
  };
};

