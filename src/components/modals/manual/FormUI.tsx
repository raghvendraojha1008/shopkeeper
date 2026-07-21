import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import ReactDOM from 'react-dom';
import { ChevronDown, X } from 'lucide-react';
import { Sanitizer } from '../../../services/sanitizer';

// FIX (Issue #10 + keyboard/list conflict):
//
// Original problem A — dropdown was an absolutely-positioned child of the
// modal's overflow-y-auto scroll container, causing hard clipping. Fixed by
// portaling the dropdown to document.body with getBoundingClientRect() positioning.
//
// Original problem B — tapping the field opened BOTH the keyboard (input focus)
// AND the dropdown list simultaneously, causing an open-close race on mobile:
//   • handleFocus called setOpen(true) → dropdown appears
//   • keyboard slides up → layout shifts → synthesized events land on backdrop
//   → dropdown closes immediately (open-close cycle)
//
// Fix B: two clearly separated interaction zones (mirrors SearchBarWithSuggest):
//   INPUT  → tap → keyboard only. While typing → inline filtered dropdown auto-shows.
//   ARROW  → tap (onPointerDown + preventDefault) → dropdown only, keyboard stays closed.
//
// Additional: outside-click uses pointerdown (more reliable on Android WebView than
// mousedown), with a 300 ms guard so the touch that opened the dropdown can't
// immediately close it via the document listener.

export const AutoComplete = ({ label, value, onChange, options, icon: Icon, placeholder = '', className = 'mb-3' }: any) => {
  const [open, setOpen] = useState(false);
  // Internal inputValue so partial typing is never lost on parent re-render.
  const [inputValue, setInputValue] = useState(Sanitizer.asString(value));
  // Portal position: track the input's bounding rect so the dropdown follows it.
  const [dropdownStyle, setDropdownStyle] = useState<React.CSSProperties>({});
  const wrapperRef  = useRef<HTMLDivElement>(null);
  const inputRef    = useRef<HTMLInputElement>(null);
  const portalRef   = useRef<HTMLDivElement | null>(null);
  const isUserTyping = useRef(false);
  // Timestamp when dropdown last opened — prevents the opening touch from
  // immediately closing the dropdown via the document pointerdown listener.
  const openedAt = useRef(0);

  // Sync from prop only when value changes externally (not while user is typing)
  useEffect(() => {
    if (!isUserTyping.current) {
      setInputValue(Sanitizer.asString(value));
    }
  }, [value]);

  // Compute and cache dropdown position from the input's bounding rect.
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

  // Outside-click handler — uses pointerdown for Android WebView reliability.
  // Excludes clicks inside the portaled dropdown (portalRef) so selecting an
  // item doesn't trigger the outside-close path.
  useEffect(() => {
    const close = (e: PointerEvent) => {
      // Ignore events that fire within 300 ms of the dropdown opening (the
      // same touch that opened it would otherwise close it immediately).
      if (Date.now() - openedAt.current < 300) return;
      const target = e.target as Node;
      const outsideWrapper = !wrapperRef.current?.contains(target);
      const outsidePortal  = !portalRef.current?.contains(target);
      if (outsideWrapper && outsidePortal) {
        setOpen(false);
        isUserTyping.current = false;
        const safeV = Sanitizer.asString(inputValue);
        if (safeV !== Sanitizer.asString(value)) onChange(safeV);
      }
    };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [inputValue, value, onChange]);

  // Reposition dropdown on scroll / resize so it tracks the input.
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

  // Filter options against what the user has typed.
  const filtered = useMemo(
    () => (options || []).filter((o: any) =>
      String(o).toLowerCase().includes(inputValue.toLowerCase())
    ),
    [options, inputValue]
  );

  // User picked an item from the dropdown list.
  const handleSelect = useCallback((val: string, e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    isUserTyping.current = false;
    setInputValue(val);
    onChange(val);
    setOpen(false);
  }, [onChange]);

  // User is typing — show filtered results automatically.
  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    isUserTyping.current = true;
    const v = e.target.value;
    setInputValue(v);
    onChange(v);
    updateDropdownPosition();
    setOpen(true);
  };

  // Focus: keyboard opens (normal input behaviour). Dropdown does NOT open —
  // that's the arrow button's job. This eliminates the keyboard/list race.
  const handleFocus = () => {
    updateDropdownPosition();
    // Intentionally NOT calling setOpen(true) here.
  };

  // Arrow / clear button (onPointerDown so preventDefault() fires before focus).
  //
  //  • hasValue → acts as a clear (X) button.
  //  • empty   → opens/closes the full dropdown without opening the keyboard,
  //              because preventDefault() suppresses the synthesized focus event
  //              that would normally follow a pointer tap.
  const hasValue = inputValue.trim().length > 0;

  const handleArrowDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (hasValue) {
      // Clear the field and let the user type a fresh value.
      isUserTyping.current = false;
      setInputValue('');
      onChange('');
      setOpen(false);
      requestAnimationFrame(() => inputRef.current?.focus());
    } else {
      // Toggle the browse list. Blur first so the keyboard closes (if open).
      inputRef.current?.blur();
      if (open) {
        setOpen(false);
      } else {
        updateDropdownPosition();
        openedAt.current = Date.now();
        setOpen(true);
      }
    }
  }, [hasValue, open, onChange, updateDropdownPosition]);

  // Portal dropdown rendered at document.body to escape modal overflow clipping.
  const dropdown = open && filtered.length > 0
    ? ReactDOM.createPortal(
        <div
          ref={portalRef}
          style={dropdownStyle}
          className="border border-white/10 rounded-lg shadow-2xl max-h-44 overflow-auto bg-col-surface-dark"
          // Prevent taps inside the dropdown from bubbling to the document
          // pointerdown outside-click handler.
          onPointerDown={e => e.stopPropagation()}
        >
          {filtered.map((opt: string, i: number) => (
            <div
              key={i}
              className="p-2.5 text-sm font-semibold hover:bg-[var(--rgba-white-10)] cursor-pointer text-[var(--text-secondary)]"
              onPointerDown={(e) => handleSelect(opt, e)}
            >
              {opt}
            </div>
          ))}
        </div>,
        document.body
      )
    : null;

  return (
    <div className={`${className} relative`} ref={wrapperRef}>
      {label && (
        <label className="block text-xs font-bold text-[var(--text-muted)] mb-1 flex items-center gap-1">
          {Icon && <Icon size={12} />} {label}
        </label>
      )}
      <div className="relative">
        <input
          ref={inputRef}
          className="w-full border border-white/12 rounded-lg p-2.5 pr-8 text-sm font-bold outline-none focus:ring-2 focus:ring-violet-500 bg-[var(--rgba-white-05)] text-[var(--text-secondary)] placeholder:text-[var(--text-muted)]"
          value={inputValue}
          placeholder={placeholder}
          onFocus={handleFocus}
          onChange={handleInputChange}
          onBlur={() => { isUserTyping.current = false; }}
        />
        {/* Arrow / clear button — onPointerDown fires before focus so
            preventDefault() reliably prevents the keyboard from opening. */}
        <button
          type="button"
          tabIndex={-1}
          className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center justify-center w-6 h-6 rounded-full transition-all active:scale-90"
          style={{ touchAction: 'none' }}
          onPointerDown={handleArrowDown}
          aria-label={hasValue ? 'Clear' : open ? 'Close list' : 'Browse options'}
        >
          {hasValue
            ? <X size={12} className="text-slate-400" />
            : <ChevronDown size={14} className={`text-violet-400 transition-transform duration-200 ${open ? 'rotate-180' : ''}`} />
          }
        </button>
      </div>
      {dropdown}
    </div>
  );
};


export const InputField = ({ label, field, type = 'text', icon: Icon, value, onChange, placeholder, disabled = false }: any) => (
  <div className="mb-3">
    <label className="block text-xs font-bold text-[var(--text-muted)] mb-1 flex items-center gap-1">{Icon && <Icon size={12} />} {label}</label>
    <input
      type={type}
      value={Sanitizer.asString(value)}
      placeholder={placeholder}
      disabled={disabled}
      onChange={e => onChange(field, e.target.value)}
      className="w-full border border-white/12 rounded-lg p-2.5 text-sm font-bold outline-none focus:ring-2 focus:ring-violet-500 disabled:opacity-50 bg-[var(--rgba-white-05)] text-[var(--text-secondary)] placeholder:text-[var(--text-muted)]"
    />
  </div>
);

/** Input with a fixed (non-editable) prefix like "S-", "REC-", "PAY-" */
export const PrefixedInputField = ({ label, field, icon: Icon, value, onChange, placeholder, prefix }: any) => {
  const numericPart = typeof value === 'string' && value.startsWith(prefix) ? value.slice(prefix.length) : value || '';
  return (
    <div className="mb-3">
      <label className="block text-xs font-bold text-[var(--text-muted)] mb-1 flex items-center gap-1">{Icon && <Icon size={12} />} {label}</label>
      <div className="flex border border-white/12 rounded-lg overflow-hidden focus-within:ring-2 focus-within:ring-violet-500">
        <span className="px-2.5 flex items-center text-sm font-black bg-[var(--rgba-white-10)] text-[var(--text-muted)] select-none border-r border-white/12">
          {prefix}
        </span>
        <input
          type="text"
          value={Sanitizer.asString(numericPart)}
          placeholder={placeholder}
          onChange={e => onChange(field, `${prefix}${e.target.value}`)}
          className="flex-1 p-2.5 text-sm font-bold outline-none bg-[var(--rgba-white-05)] text-[var(--text-secondary)] placeholder:text-[var(--text-muted)]"
        />
      </div>
    </div>
  );
};

