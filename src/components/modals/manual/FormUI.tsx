import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import ReactDOM from 'react-dom';
import { Sanitizer } from '../../../services/sanitizer';

// FIX (Issue #10): AutoComplete dropdown was an absolutely-positioned child of the
// modal's overflow-y-auto scroll container. That container creates a new stacking/
// clipping context, so any dropdown that extends past the bottom of a form is hard-
// clipped — the user sees it cut off mid-list or not at all.
//
// The fix portals the dropdown to document.body and positions it via
// getBoundingClientRect() so it always renders above the scroll container's clip.
// z-index 9999 ensures it sits on top of the modal backdrop.

export const AutoComplete = ({ label, value, onChange, options, icon: Icon, placeholder = '', className = 'mb-3' }: any) => {
  const [open, setOpen] = useState(false);
  // Internal inputValue state so partial typing is never lost on parent re-render.
  const [inputValue, setInputValue] = useState(Sanitizer.asString(value));
  // Portal position: track the input's bounding rect so the dropdown follows it.
  const [dropdownStyle, setDropdownStyle] = useState<React.CSSProperties>({});
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const isUserTyping = useRef(false);

  // Sync from prop only when value changes externally (not while user is typing)
  useEffect(() => {
    if (!isUserTyping.current) {
      setInputValue(Sanitizer.asString(value));
    }
  }, [value]);

  // Compute dropdown position from the input's bounding rect
  const updateDropdownPosition = useCallback(() => {
    if (inputRef.current) {
      const rect = inputRef.current.getBoundingClientRect();
      setDropdownStyle({
        position: 'fixed',
        top: rect.bottom + 4,
        left: rect.left,
        width: rect.width,
        zIndex: 9999,
      });
    }
  }, []);

  // Outside-click handler — closes dropdown and commits typed value
  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
        isUserTyping.current = false;
        const safeV = Sanitizer.asString(inputValue);
        if (safeV !== Sanitizer.asString(value)) {
          onChange(safeV);
        }
      }
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [inputValue, value, onChange]);

  // Reposition dropdown on scroll or resize so it tracks the input
  useEffect(() => {
    if (!open) return;
    const reposition = () => updateDropdownPosition();
    window.addEventListener('scroll', reposition, true);
    window.addEventListener('resize', reposition);
    return () => {
      window.removeEventListener('scroll', reposition, true);
      window.removeEventListener('resize', reposition);
    };
  }, [open, updateDropdownPosition]);

  // SAFE FILTERING: filter against internal inputValue
  const filtered = useMemo(
    () => ((options || []).filter((o: any) => String(o).toLowerCase().includes(inputValue.toLowerCase()))),
    [options, inputValue]
  );

  const handleSelect = (val: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    isUserTyping.current = false;
    setInputValue(val);
    onChange(val);
    setOpen(false);
    setTimeout(() => inputRef.current?.focus(), 10);
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    isUserTyping.current = true;
    const v = e.target.value;
    setInputValue(v);
    onChange(v);
    updateDropdownPosition();
    setOpen(true);
  };

  const handleFocus = () => {
    updateDropdownPosition();
    setOpen(true);
  };

  // Portal dropdown rendered at document.body to escape modal overflow clipping
  const dropdown = open && filtered.length > 0
    ? ReactDOM.createPortal(
        <div
          style={dropdownStyle}
          className="border border-white/10 rounded-lg shadow-2xl max-h-40 overflow-auto bg-[#1a1f35]"
        >
          {filtered.map((opt: string, i: number) => (
            <div
              key={i}
              className="p-2 text-sm hover:bg-[rgba(255,255,255,0.1)] cursor-pointer text-[rgba(226,232,240,0.88)]"
              onMouseDown={(e) => handleSelect(opt, e)}
            >
              {opt}
            </div>
          ))}
        </div>,
        document.body
      )
    : null;

  return (
    <div className={`${className} relative`} ref={ref}>
      {label && <label className="block text-xs font-bold text-[rgba(148,163,184,0.45)] mb-1 flex items-center gap-1">{Icon && <Icon size={12} />} {label}</label>}
      <input
        ref={inputRef}
        className="w-full border border-white/12 rounded-lg p-2.5 text-sm font-bold outline-none focus:ring-2 focus:ring-violet-500 bg-[rgba(255,255,255,0.05)] text-[rgba(226,232,240,0.88)] placeholder:text-[rgba(148,163,184,0.4)]"
        value={inputValue}
        placeholder={placeholder}
        onFocus={handleFocus}
        onChange={handleInputChange}
        onBlur={() => {
          isUserTyping.current = false;
        }}
      />
      {dropdown}
    </div>
  );
};


export const InputField = ({ label, field, type = 'text', icon: Icon, value, onChange, placeholder, disabled = false }: any) => (
  <div className="mb-3">
    <label className="block text-xs font-bold text-[rgba(148,163,184,0.55)] mb-1 flex items-center gap-1">{Icon && <Icon size={12} />} {label}</label>
    <input
      type={type}
      value={Sanitizer.asString(value)}
      placeholder={placeholder}
      disabled={disabled}
      onChange={e => onChange(field, e.target.value)}
      className="w-full border border-white/12 rounded-lg p-2.5 text-sm font-bold outline-none focus:ring-2 focus:ring-violet-500 disabled:opacity-50 bg-[rgba(255,255,255,0.05)] text-[rgba(226,232,240,0.88)] placeholder:text-[rgba(148,163,184,0.4)]"
    />
  </div>
);

/** Input with a fixed (non-editable) prefix like "S-", "REC-", "PAY-" */
export const PrefixedInputField = ({ label, field, icon: Icon, value, onChange, placeholder, prefix }: any) => {
  const numericPart = typeof value === 'string' && value.startsWith(prefix) ? value.slice(prefix.length) : value || '';
  return (
    <div className="mb-3">
      <label className="block text-xs font-bold text-[rgba(148,163,184,0.55)] mb-1 flex items-center gap-1">{Icon && <Icon size={12} />} {label}</label>
      <div className="flex border border-white/12 rounded-lg overflow-hidden focus-within:ring-2 focus-within:ring-violet-500">
        <span className="px-2.5 flex items-center text-sm font-black bg-[rgba(255,255,255,0.1)] text-[rgba(148,163,184,0.7)] select-none border-r border-white/12">
          {prefix}
        </span>
        <input
          type="text"
          value={Sanitizer.asString(numericPart)}
          placeholder={placeholder}
          onChange={e => onChange(field, `${prefix}${e.target.value}`)}
          className="flex-1 p-2.5 text-sm font-bold outline-none bg-[rgba(255,255,255,0.05)] text-[rgba(226,232,240,0.88)] placeholder:text-[rgba(148,163,184,0.4)]"
        />
      </div>
    </div>
  );
};

