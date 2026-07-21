import React, { useState, useMemo, useRef, useCallback } from 'react';
import ReactDOM from 'react-dom';
import { Search, ChevronDown, X } from 'lucide-react';

interface SearchBarWithSuggestProps {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  suggestions: string[];
  className?: string;
  inputClassName?: string;
  containerStyle?: React.CSSProperties;
  inputStyle?: React.CSSProperties;
}

/**
 * Search bar with two clearly separated interaction zones:
 *
 *  INPUT AREA  → tap/click → opens keyboard only. While typing, matching
 *                suggestions appear as an inline dropdown automatically.
 *
 *  ARROW BTN   → tap/click → opens the full "browse" list sheet only.
 *                Keyboard does NOT open. No conflict.
 *
 * Root-cause of the previous conflict:
 *   • Both onMouseDown + onTouchStart were registered on the arrow button,
 *     causing double-firing on mobile.
 *   • The synthesized "click" that fires at the end of a touch sequence would
 *     land on the freshly-rendered backdrop and immediately close the sheet
 *     (open-close cycle).
 *   • Fix: use onPointerDown + preventDefault() on the arrow button — this
 *     fires before any focus change and suppresses the synthesized click, so
 *     the button press and the backdrop never race each other.
 *   • Backdrop uses onPointerDown + a 400 ms guard to ignore the stale touch
 *     that originally opened the sheet.
 */
const SearchBarWithSuggest: React.FC<SearchBarWithSuggestProps> = ({
  value,
  onChange,
  placeholder = 'Search…',
  suggestions,
  className = '',
  inputClassName = '',
  containerStyle,
  inputStyle,
}) => {
  const [focused, setFocused] = useState(false);
  const [showFullList, setShowFullList] = useState(false);
  const [listSearch, setListSearch] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const blurTimer = useRef<ReturnType<typeof setTimeout>>();
  // Timestamp when the list was last opened — used to ignore the residual
  // touch/click that triggered the open from also closing via the backdrop.
  const listOpenedAt = useRef(0);

  // ── Inline suggestions (while typing in the input) ────────────────────────
  const filteredSuggestions = useMemo(() => {
    const q = value.trim().toLowerCase();
    if (!q) return [];
    return suggestions
      .filter(s => s.toLowerCase().includes(q) && s.toLowerCase() !== q)
      .slice(0, 7);
  }, [value, suggestions]);

  // ── Items inside the full-list sheet ──────────────────────────────────────
  const filteredListItems = useMemo(() => {
    const q = listSearch.trim().toLowerCase();
    if (!q) return suggestions;
    return suggestions.filter(s => s.toLowerCase().includes(q));
  }, [suggestions, listSearch]);

  const hasValue = value.trim().length > 0;

  // Inline dropdown only shows when the keyboard is active (input focused)
  // and the full list is NOT open at the same time.
  const showSuggestions = focused && !showFullList && filteredSuggestions.length > 0;

  // ── Handlers ──────────────────────────────────────────────────────────────

  // User picked a suggestion from the inline dropdown (keyboard mode)
  const handleSelect = useCallback((item: string) => {
    onChange(item);
    clearTimeout(blurTimer.current);
    setFocused(false);
    inputRef.current?.blur();
  }, [onChange]);

  // User picked an item from the full list sheet
  const handleListSelect = useCallback((item: string) => {
    onChange(item);
    setShowFullList(false);
    setListSearch('');
  }, [onChange]);

  /**
   * Arrow / browse button handler.
   *
   * Uses onPointerDown (not onClick / onMouseDown / onTouchStart) because:
   *   • onPointerDown fires before any focus event → preventDefault() here
   *     reliably prevents the browser from focusing the input or the button,
   *     so the keyboard never opens.
   *   • Calling preventDefault() also suppresses the synthesized mousedown /
   *     click events that follow a touch, eliminating the race with the
   *     backdrop's close handler.
   */
  const handleArrowDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();

    if (hasValue) {
      // Act as a clear button when there is text
      onChange('');
      // Re-focus so the user can immediately type a new search
      requestAnimationFrame(() => inputRef.current?.focus());
    } else {
      // Open the full browse list — keyboard must stay closed
      clearTimeout(blurTimer.current);
      inputRef.current?.blur();
      setFocused(false);
      setListSearch('');
      listOpenedAt.current = Date.now();
      setShowFullList(true);
    }
  }, [hasValue, onChange]);

  /**
   * Backdrop tap/click closes the sheet.
   *
   * Uses onPointerDown instead of onClick and checks that at least 400 ms
   * have passed since the sheet opened, so the very touch that opened it
   * cannot immediately close it again (the open-close cycle).
   */
  const handleBackdropDown = useCallback((e: React.PointerEvent) => {
    if (Date.now() - listOpenedAt.current < 400) return;
    setShowFullList(false);
    setListSearch('');
  }, []);

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <>
      {/* ── Search bar ── */}
      <div className={`relative ${className}`} style={containerStyle}>
        <div className="relative flex items-center">
          <Search
            className="absolute left-3 text-slate-400 pointer-events-none"
            size={14}
            style={{ top: '50%', transform: 'translateY(-50%)' }}
          />

          {/* INPUT — tap here to open keyboard + get inline suggestions while typing */}
          <input
            ref={inputRef}
            type="text"
            inputMode="text"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            className={`w-full pl-9 pr-9 ${inputClassName}`}
            style={inputStyle}
            placeholder={placeholder}
            value={value}
            onChange={e => onChange(e.target.value)}
            onFocus={() => {
              clearTimeout(blurTimer.current);
              setFocused(true);
              // Never open the full list from input focus — that's the arrow's job
            }}
            onBlur={() => {
              blurTimer.current = setTimeout(() => setFocused(false), 350);
            }}
          />

          {/* ARROW / CLEAR BUTTON — tap here to open the list (no keyboard) */}
          <button
            type="button"
            tabIndex={-1}                        // not in tab order
            className="absolute right-2 flex items-center justify-center w-7 h-7 rounded-full transition-all active:scale-90"
            style={{ top: '50%', transform: 'translateY(-50%)', touchAction: 'none' }}
            onPointerDown={handleArrowDown}      // single unified handler, fires before focus
            aria-label={hasValue ? 'Clear search' : 'Browse all options'}
          >
            {hasValue
              ? <X size={13} className="text-slate-400" />
              : <ChevronDown size={15} className="text-violet-400" />
            }
          </button>
        </div>

        {/* ── Inline suggestions dropdown (keyboard open, user is typing) ── */}
        {showSuggestions && (
          <div
            className="absolute left-0 right-0 top-full mt-1 z-[200] rounded-2xl overflow-hidden"
            style={{
              background: 'var(--dropdown-bg)',
              border: '1px solid var(--glass-border)',
              backdropFilter: 'blur(20px)',
              boxShadow: '0 8px 32px var(--rgba-black-55)',
            }}
          >
            <div className="px-2 pt-2 pb-2 max-h-48 overflow-y-auto" style={{ WebkitOverflowScrolling: 'touch' }}>
              <p className="text-app-xs font-bold uppercase tracking-wide text-[var(--text-muted)] px-2 mb-1.5">
                Suggestions
              </p>
              {filteredSuggestions.map((s, i) => (
                <button
                  key={i}
                  type="button"
                  onPointerDown={e => e.preventDefault()}  // keep input focused while picking
                  onClick={() => handleSelect(s)}
                  className="w-full text-left px-3 py-2.5 rounded-xl mb-1 flex items-center gap-2 active:scale-[0.99] transition-all"
                  style={{ background: 'var(--rgba-white-05)', border: '1px solid var(--glass-border)' }}
                >
                  <Search size={11} className="text-violet-400 shrink-0" />
                  <span className="text-sm font-semibold text-[var(--text-secondary)] truncate">{s}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* ── Full browse list bottom sheet ──────────────────────────────────
          Rendered via createPortal directly on document.body so that
          position:fixed resolves to the TRUE viewport — not to any
          ancestor CSS transform (which Virtuoso's scroll container applies
          internally, causing the sheet to appear tiny / mis-positioned). */}
      {showFullList && ReactDOM.createPortal(
        <div
          className="fixed inset-0 z-[9998] flex flex-col justify-end"
          style={{ background: 'var(--rgba-black-60)', backdropFilter: 'blur(6px)' }}
          onPointerDown={handleBackdropDown}
        >
          <div
            style={{
              background: 'var(--modal-sheet-bg)',
              border: '1px solid var(--glass-border)',
              borderBottom: 'none',
              borderRadius: '24px 24px 0 0',
              maxHeight: '70vh',
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden',
            }}
            onPointerDown={e => e.stopPropagation()}
          >
            {/* Header */}
            <div
              className="flex items-center justify-between px-4 pt-4 pb-3"
              style={{ borderBottom: '1px solid var(--glass-border)', flexShrink: 0 }}
            >
              <span className="text-sm font-black" style={{ color: 'var(--text-primary)' }}>Select from list</span>
              <button
                className="p-1.5 rounded-full active:scale-90 transition-all"
                style={{ background: 'var(--rgba-white-07)' }}
                onPointerDown={e => { e.stopPropagation(); setShowFullList(false); setListSearch(''); }}
              >
                <X size={15} className="text-slate-400" />
              </button>
            </div>

            {/* Search inside the sheet */}
            <div
              className="px-4 py-2.5"
              style={{ borderBottom: '1px solid var(--glass-border)', flexShrink: 0 }}
            >
              <div className="relative">
                <Search
                  className="absolute left-3 text-slate-400 pointer-events-none"
                  size={13}
                  style={{ top: '50%', transform: 'translateY(-50%)' }}
                />
                <input
                  type="text"
                  inputMode="text"
                  autoComplete="off"
                  className="w-full pl-9 pr-3 py-2.5 text-sm font-semibold outline-none rounded-xl"
                  style={{
                    background: 'var(--rgba-white-07)',
                    border: '1px solid var(--glass-border)',
                    color: 'var(--text-primary)',
                  }}
                  placeholder="Search list…"
                  value={listSearch}
                  onChange={e => setListSearch(e.target.value)}
                />
              </div>
            </div>

            {/* Item list — flex-1 so it fills remaining height inside the sheet */}
            <div
              className="px-4 py-2"
              style={{ overflowY: 'auto', flex: 1 }}
            >
              {filteredListItems.length === 0 ? (
                <p className="text-center py-8 text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>
                  No matches
                </p>
              ) : (
                filteredListItems.map((item, i) => (
                  <button
                    key={i}
                    type="button"
                    onPointerDown={e => e.stopPropagation()}
                    onClick={() => handleListSelect(item)}
                    className="w-full text-left px-3 py-3 rounded-xl mb-1 flex items-center gap-2 transition-all"
                    style={{
                      background: item === value ? 'var(--col-violet-15)' : 'var(--rgba-white-03)',
                      border: '1px solid ' + (item === value ? 'var(--col-violet-25)' : 'transparent'),
                    }}
                  >
                    <span
                      className="flex-1 text-sm font-semibold truncate"
                      style={{ color: 'var(--text-primary)' }}
                    >
                      {item}
                    </span>
                    {item === value && <div className="w-1.5 h-1.5 rounded-full bg-violet-400 shrink-0" />}
                  </button>
                ))
              )}
              <div style={{ height: 'env(safe-area-inset-bottom, 16px)' }} />
            </div>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
};

export default SearchBarWithSuggest;
