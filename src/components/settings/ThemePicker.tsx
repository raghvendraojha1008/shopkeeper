import React from 'react';
import { Check, SlidersHorizontal } from 'lucide-react';
import type { CustomHsl, ThemePresetId } from '../../theme/theme';
import { THEME_PRESETS } from '../../theme/theme';

type Props = {
  value?: ThemePresetId | string;
  onChange: (id: ThemePresetId) => void;
  custom?: CustomHsl;
  onChangeCustom: (hsl: CustomHsl) => void;
};

const DEFAULT_CUSTOM: CustomHsl = { h: 24, s: 94, l: 56 };

export const ThemePicker: React.FC<Props> = ({ value, onChange, custom, onChangeCustom }) => {
  const current = (value || 'warm-saffron') as ThemePresetId;
  const c = custom || DEFAULT_CUSTOM;

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-7 gap-2">
        {THEME_PRESETS.map((t) => {
          const selected = current === t.id;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => onChange(t.id)}
              aria-label={t.label}
              className={
                'relative h-9 w-9 rounded-full border border-border/60 shadow-sm transition-transform active:scale-95 ' +
                (selected ? 'ring-2 ring-primary ring-offset-2 ring-offset-background' : '')
              }
              style={{ backgroundColor: `hsl(var(${t.cssVar}))` }}
            >
              {selected && (
                <span className="absolute inset-0 flex items-center justify-center text-primary-foreground">
                  <Check size={16} />
                </span>
              )}
            </button>
          );
        })}

        {/* Custom = 15th option */}
        <button
          type="button"
          onClick={() => onChange('custom')}
          className={
            'relative h-9 w-9 rounded-full border border-border/60 bg-card shadow-sm transition-transform active:scale-95 ' +
            (current === 'custom' ? 'ring-2 ring-primary ring-offset-2 ring-offset-background' : '')
          }
          aria-label="Custom theme"
        >
          <span className="absolute inset-0 flex items-center justify-center text-muted-foreground">
            <SlidersHorizontal size={16} />
          </span>
        </button>
      </div>

      {current === 'custom' && (
        <div className="rounded-xl border border-white/10 bg-[rgba(255,255,255,0.05)] p-3 space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-xs font-extrabold text-foreground">Custom color</div>
              <div className="text-[10px] text-muted-foreground">Adjust primary accent (HSL)</div>
            </div>
            <div
              className="h-8 w-8 rounded-full border border-border"
              style={{ backgroundColor: `hsl(${c.h} ${c.s}% ${c.l}%)` }}
              aria-label="Custom color preview"
            />
          </div>

          <SliderRow
            label="Hue"
            value={c.h}
            min={0}
            max={360}
            onChange={(h) => onChangeCustom({ ...c, h })}
          />
          <SliderRow
            label="Sat"
            value={c.s}
            min={0}
            max={100}
            onChange={(s) => onChangeCustom({ ...c, s })}
          />
          <SliderRow
            label="Light"
            value={c.l}
            min={0}
            max={100}
            onChange={(l) => onChangeCustom({ ...c, l })}
          />
        </div>
      )}
    </div>
  );
};

const SliderRow = ({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
}) => {
  return (
    <div className="grid grid-cols-[48px_1fr_42px] items-center gap-3">
      <div className="text-[11px] font-extrabold text-[rgba(148,163,184,0.55)]">{label}</div>
      <input
        type="range"
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full"
      />
      <div className="text-[11px] font-black text-[rgba(240,244,255,0.9)] text-right tabular-nums">{value}</div>
    </div>
  );
};







