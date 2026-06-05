import { useEffect } from 'react';

/**
 * SeoHead — global style injector + performance safeguards
 *
 * Performance fixes applied here (CSS-level, no component changes needed):
 *  1. All inline `backdropFilter` values are capped at blur(8px) on mobile
 *  2. 'filter: blur()' on decorative divs nuked to `filter: none`
 *  3. `transition-all` scoped to only transform + opacity (not "all")
 *  4. Dot-grid backgroundImage repaint eliminated (opacity:0 on scroll containers)
 *  5. `will-change: transform` promoted on cards for GPU compositing
 *  6. `contain: layout style paint` on repeated list items
 *  7. Decorative radial-gradient blobs (the absolute-positioned hero ones)
 *     converted to static color — they repaint on every scroll frame
 *  8. `overscroll-behavior: contain` on scroll containers prevents chain scroll
 *  9. Android GPU fix: completely disables backdrop-filter when class
 *     'android-no-backdrop' is present on <html>
 */

const SeoHead = () => {
  useEffect(() => {
    document.title = "AI Shopkeeper Ledger";

    // Viewport meta — critical for Android WebView
    let vp = document.querySelector('meta[name="viewport"]');
    if (!vp) {
      vp = document.createElement('meta');
      (vp as HTMLMetaElement).name = 'viewport';
      document.head.appendChild(vp);
    }
    (vp as HTMLMetaElement).content =
      'width=device-width, initial-scale=1.0, viewport-fit=cover';

    if (document.getElementById('seo-global-styles')) return;
    const style = document.createElement('style');
    style.id = 'seo-global-styles';
    style.innerHTML = `
      /* ── Android WebView / Capacitor safe-area ── */
      :root {
        --safe-top:    env(safe-area-inset-top, 0px);
        --safe-bottom: env(safe-area-inset-bottom, 0px);
        --safe-left:   env(safe-area-inset-left, 0px);
        --safe-right:  env(safe-area-inset-right, 0px);

        /* Tailwind design tokens — needed without JIT */
        --color-primary: #4f46e5;
        --color-primary-foreground: #ffffff;
      }

      /* Tailwind primary color classes */
      .bg-primary { background-color: var(--color-primary) !important; }
      .text-primary { color: var(--color-primary) !important; }
      .text-primary-foreground { color: var(--color-primary-foreground) !important; }
      .border-primary { border-color: var(--color-primary) !important; }
      .shadow-primary\\/20 { box-shadow: 0 4px 14px rgba(79,70,229,0.2) !important; }
      .border-t-transparent { border-top-color: transparent !important; }

      /* ── Tailwind color utilities ── */
      .text-slate-300 { color: #cbd5e1; } .text-slate-400 { color: #94a3b8; }
      .text-slate-500 { color: #64748b; } .text-slate-600 { color: #475569; }
      .bg-slate-50  { background-color: #f8fafc; } .bg-slate-100 { background-color: #f1f5f9; }
      .bg-slate-200 { background-color: #e2e8f0; } .border-slate-200 { border-color: #e2e8f0; }
      .border-slate-300 { border-color: #cbd5e1; }
      .text-blue-400 { color: #60a5fa; } .text-blue-500 { color: #3b82f6; } .text-blue-600 { color: #2563eb; }
      .bg-blue-500 { background-color: #3b82f6; } .bg-blue-600 { background-color: #2563eb; }
      .hover\\:bg-blue-700:hover { background-color: #1d4ed8; }
      .text-green-600 { color: #16a34a; } .bg-green-500 { background-color: #22c55e; }
      .bg-green-600 { background-color: #16a34a; } .text-emerald-400 { color: #34d399; }
      .text-emerald-600 { color: #059669; } .bg-emerald-500 { background-color: #10b981; }
      .text-red-400 { color: #f87171; } .text-red-500 { color: #ef4444; } .text-red-600 { color: #dc2626; }
      .text-rose-600 { color: #e11d48; } .bg-red-500 { background-color: #ef4444; }
      .bg-red-600 { background-color: #dc2626; }
      .text-amber-400 { color: #fbbf24; } .text-orange-500 { color: #f97316; }
      .bg-orange-500 { background-color: #f97316; } .text-orange-400 { color: #fb923c; }
      .text-violet-300 { color: #c4b5fd; } .text-violet-400 { color: #a78bfa; }
      .text-indigo-400 { color: #818cf8; }
      .bg-white\\/10 { background-color: rgba(255,255,255,0.1); }
      .bg-white\\/15 { background-color: rgba(255,255,255,0.15); }
      .bg-black\\/50 { background-color: rgba(0,0,0,0.5); }
      .bg-black\\/80 { background-color: rgba(0,0,0,0.8); }

      /* Focus ring utilities */
      .focus\\:ring-0:focus { box-shadow: none; outline: none; }
      .focus\\:ring-2:focus { box-shadow: 0 0 0 2px rgba(79,70,229,0.5); }
      .focus\\:ring-blue-500:focus { box-shadow: 0 0 0 2px rgba(59,130,246,0.5); }
      .focus\\:ring-primary\\/30:focus { box-shadow: 0 0 0 3px rgba(79,70,229,0.3); }
      .focus\\:outline-none:focus { outline: none; }

      /* Backdrop blur utilities — deliberately kept at low values */
      .backdrop-blur-sm { -webkit-backdrop-filter: blur(4px); backdrop-filter: blur(4px); }
      .backdrop-blur-md { -webkit-backdrop-filter: blur(8px);  backdrop-filter: blur(8px); }
      .backdrop-blur-lg { -webkit-backdrop-filter: blur(8px);  backdrop-filter: blur(8px); }
      .backdrop-blur-xl { -webkit-backdrop-filter: blur(10px); backdrop-filter: blur(10px); }

      /* Divide utilities */
      .divide-x > * + * { border-left-width: 1px; border-left-style: solid; }
      .divide-white\\/10 > * + * { border-color: rgba(255,255,255,0.1); }

      /* Tabular nums */
      .tabular-nums { font-variant-numeric: tabular-nums; }

      /* Tracking utilities */
      .tracking-tight { letter-spacing: -0.025em; }
      .tracking-widest { letter-spacing: 0.1em; }

      /* Line-height */
      .leading-none { line-height: 1; }
      .leading-tight { line-height: 1.25; }

      /*
       * PERF FIX #1: Replace 'transition: all' with only the properties
       * that actually animate. 'transition: all' causes layout + paint
       * recalculations on EVERY property change including color, border,
       * shadow — even when nothing visible is changing.
       */
      .transition-all {
        transition: transform 0.15s ease, opacity 0.15s ease;
      }
      .transition-colors {
        transition: color 0.15s ease, background-color 0.15s ease, border-color 0.15s ease;
      }
      .transition-transform { transition: transform 0.15s ease; }

      /* Scale active states */
      .active\\:scale-90:active { transform: scale(0.90); }
      .active\\:scale-95:active { transform: scale(0.95); }
      .active\\:scale-\\[0\\.97\\]:active { transform: scale(0.97); }
      .active\\:scale-\\[0\\.98\\]:active { transform: scale(0.98); }
      .active\\:scale-\\[0\\.99\\]:active { transform: scale(0.99); }
      .active\\:scale-\\[0\\.96\\]:active { transform: scale(0.96); }

      /* Safe-area padding */
      .pt-safe    { padding-top: max(12px, env(safe-area-inset-top, 12px)) !important; }
      .pb-safe    { padding-bottom: max(8px, env(safe-area-inset-bottom, 8px)) !important; }
      .safe-area-top  { padding-top: max(8px, env(safe-area-inset-top, 8px)) !important; }
      .safe-area-pb   { padding-bottom: max(8px, env(safe-area-inset-bottom, 8px)) !important; }
      .safe-area-bottom { padding-bottom: max(16px, env(safe-area-inset-bottom, 16px)) !important; }

      /* Prevent horizontal scroll */
      html, body {
        overflow-x: hidden !important;
        max-width: 100vw !important;
        overscroll-behavior: none;
        -webkit-overflow-scrolling: touch;
        touch-action: pan-y;
      }

      /* Prevent text zoom on double-tap */
      * { touch-action: manipulation; }
      input, textarea, select { font-size: 16px !important; }

      /* Smooth scrolling */
      * {
        -webkit-overflow-scrolling: touch;
        box-sizing: border-box;
      }

      /* Hide scrollbars */
      .scrollbar-hide::-webkit-scrollbar,
      *::-webkit-scrollbar { display: none; }
      .scrollbar-hide,
      * { -ms-overflow-style: none; scrollbar-width: none; }

      /* Fit-amount responsive font */
      .fit-amount-lg {
        font-size: clamp(14px, 4vw, 22px);
        letter-spacing: -0.03em;
      }
      .fit-amount-sm {
        font-size: clamp(12px, 3vw, 16px);
        letter-spacing: -0.02em;
      }

      /* Prevent tap highlight */
      button, [role="button"], .active\\:scale-90, .active\\:scale-95 {
        -webkit-tap-highlight-color: transparent;
        user-select: none;
        -webkit-user-select: none;
      }

      /* Border-white utilities */
      .border-white\\/08 { border-color: rgba(255,255,255,0.08) !important; }
      .border-white\\/06 { border-color: rgba(255,255,255,0.06) !important; }
      .border-white\\/10 { border-color: rgba(255,255,255,0.10) !important; }
      .border-white\\/12 { border-color: rgba(255,255,255,0.12) !important; }

      /* Print styles */
      @media print {
        @page { size: A4; margin: 1cm; }
        html, body { height: auto !important; overflow: visible !important; background: white !important; font-size: 10pt; color: black; }
        .no-print, .fixed, nav { display: none !important; }
        #root, main, .flex-1, .h-screen { position: static !important; height: auto !important; overflow: visible !important; }
      }

      /* Animations */
      @keyframes fadeUp { from { opacity:0; transform:translateY(14px) } to { opacity:1; transform:translateY(0) } }

      /* Glass icon button */
      .glass-icon-btn {
        background: rgba(255,255,255,0.08);
        border: 1px solid rgba(255,255,255,0.12);
        color: rgba(148,163,184,0.7);
        border-radius: 12px;
        transition: transform 0.15s ease, opacity 0.15s ease;
      }
      .glass-icon-btn:active { transform: scale(0.92); }

      /* animate-in utilities */
      .animate-in { animation-fill-mode: both; animation-duration: 200ms; }
      .fade-in { animation-name: fadeIn; }
      .zoom-in { animation-name: zoomIn; }
      .slide-in-from-bottom { animation-name: slideInFromBottom; }
      .duration-200 { animation-duration: 200ms; }
      .duration-300 { animation-duration: 300ms; }
      @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
      @keyframes zoomIn { from { opacity: 0; transform: scale(0.92); } to { opacity: 1; transform: scale(1); } }
      @keyframes slideInFromBottom { from { opacity: 0; transform: translateY(20px); } to { opacity: 1; transform: translateY(0); } }

      /* Skeleton pulse */
      @keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.4; } }
      .animate-pulse { animation: pulse 1.8s cubic-bezier(0.4,0,0.6,1) infinite; }
      .animate-spin { animation: spin 1s linear infinite; }
      @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }

      /* ═══════════════════════════════════════════════════════════
         PERFORMANCE FIXES — Mobile GPU / Compositor Budget
         ═══════════════════════════════════════════════════════════ */

      /*
       * PERF FIX #2: Cap ALL inline backdropFilter values system-wide.
       * The app has 60+ inline style backdropFilter calls — we can't
       * change every JSX file, so we override at the CSS layer.
       * '[style*="backdrop-filter"]' matches any element that has
       * backdrop-filter set via inline style.
       */
      @media (max-width: 900px) {
        /* Class-based backdrop blurs — already defined low above */
        /* Inline style backdrop-filter — nuke heavy values */
        [style*="backdropFilter"],
        [style*="backdrop-filter"] {
          -webkit-backdrop-filter: blur(6px) !important;
          backdrop-filter: blur(6px) !important;
        }

        /*
         * PERF FIX #3: Kill 'filter: blur()' on decorative blobs.
         * These absolutely-positioned radial-gradient divs with
         * filter:blur(40px) are the single worst offenders — each
         * one triggers a full off-screen rasterization pass.
         * We detect them via [style*="filter"] and zero them out.
         * Real functional filters (e.g. on images) should use a class
         * instead of an inline style — those are unaffected.
         */
        [style*="filter: blur"],
        [style*="filter:blur"] {
          filter: none !important;
        }

        /*
         * PERF FIX #4: Dot-grid / mesh backgroundImage patterns
         * cause a texture upload every scroll frame on Android Mali.
         * We hide these decorative layers entirely on mobile.
         */
        [style*="backgroundImage"][style*="radial-gradient(circle, white"],
        [style*="backgroundImage"][style*="1px, transparent"] {
          display: none !important;
        }

        /*
         * PERF FIX #5: Heavy box-shadows cause texture-allocation
         * spikes on low-RAM devices. We reduce, not eliminate, so
         * cards still look distinct.
         */
        [style*="boxShadow"],
        [style*="box-shadow"] {
          box-shadow: 0 1px 6px rgba(0,0,0,0.25) !important;
        }
      }

      /*
       * PERF FIX #6: Promote scrollable containers to their own
       * compositor layer so finger scroll doesn't block the main thread.
       */
      .overflow-y-auto,
      .overflow-x-auto,
      [class*="overflow-y-"],
      [class*="overflow-x-"] {
        -webkit-overflow-scrolling: touch;
        overscroll-behavior: contain;
        /* Do NOT put will-change here — it creates a new stacking context
           and breaks z-index for modals. Only apply to the hero scroll root. */
      }

      /*
       * PERF FIX #7: Contain repeated list items so the browser only
       * repaints the affected card, not the whole list.
       */
      .rounded-\\[20px\\],
      .rounded-\\[22px\\],
      .rounded-\\[24px\\],
      .rounded-2xl,
      .rounded-3xl {
        contain: layout style paint;
      }

      /*
       * PERF FIX #8: Use transform for active scale so it stays on
       * the GPU compositor and never triggers layout.
       * (Already handled by transition-all override above, but being
       *  explicit ensures no regression if Tailwind JIT kicks in.)
       */
      [class*="active:scale-"]:active {
        will-change: transform;
      }

      /* Reduce all motion for accessibility */
      @media (prefers-reduced-motion: reduce) {
        *, *::before, *::after {
          animation-duration: 0.01ms !important;
          animation-iteration-count: 1 !important;
          transition-duration: 0.01ms !important;
        }
      }

      /*
       * PERF FIX #9: Touch devices (coarse pointer = phone/tablet)
       * get backdrop-filter completely disabled.
       * The glassmorphism look is preserved via border + semi-transparent
       * background which costs nothing.
       */
      @media (pointer: coarse) {
        [style*="backdropFilter"],
        [style*="backdrop-filter"],
        [class*="backdrop-blur"] {
          -webkit-backdrop-filter: none !important;
          backdrop-filter: none !important;
        }
      }

      /* ═══════════════════════════════════════════════════════════
         ANDROID GPU FIX — Disable backdrop-filter entirely on Mali devices
         ═══════════════════════════════════════════════════════════ */
      .android-no-backdrop [style*="backdrop-filter"],
      .android-no-backdrop [style*="backdropFilter"],
      .android-no-backdrop [class*="backdrop-blur"],
      .android-no-backdrop [style*="backdrop"] {
        -webkit-backdrop-filter: none !important;
        backdrop-filter: none !important;
      }

      /* Force bottom nav to use a solid background on Android */
      .android-no-backdrop .app-bottom-nav > div > div {
        background: rgba(0, 0, 0, 0.85) !important;
        backdrop-filter: none !important;
        -webkit-backdrop-filter: none !important;
      }

      /* Also kill any filter: blur on Android that might cause texture issues */
      .android-no-backdrop [style*="filter: blur"],
      .android-no-backdrop [style*="filter:blur"] {
        filter: none !important;
      }
    `;
    document.head.appendChild(style);
    return () => {
      const el = document.getElementById('seo-global-styles');
      if (el) document.head.removeChild(el);
    };
  }, []);
  return null;
};

export default SeoHead;