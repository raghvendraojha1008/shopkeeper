/**
 * KeyboardContext — App-wide keyboard state provider
 *
 * Wraps useKeyboard so any component can access keyboard state without
 * prop-drilling. Provides isKeyboardOpen, keyboardHeight, and dismissKeyboard.
 */

import React, { createContext, useContext } from 'react';
import { useKeyboard, dismissKeyboard as _dismiss } from '../hooks/useKeyboard';

interface KeyboardContextValue {
  isKeyboardOpen: boolean;
  keyboardHeight: number;
  dismissKeyboard: () => Promise<void>;
}

const KeyboardContext = createContext<KeyboardContextValue>({
  isKeyboardOpen : false,
  keyboardHeight : 0,
  dismissKeyboard: async () => {},
});

export const KeyboardProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { isKeyboardOpen, keyboardHeight } = useKeyboard();

  return (
    <KeyboardContext.Provider value={{ isKeyboardOpen, keyboardHeight, dismissKeyboard: _dismiss }}>
      {children}
    </KeyboardContext.Provider>
  );
};

export const useKeyboardContext = () => useContext(KeyboardContext);
