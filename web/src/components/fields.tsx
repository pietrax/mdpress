import type { ReactNode } from 'react';
import type { Slot } from '../../../src/core/theme.js';
import type { Template } from '../api';
import { useI18n } from '../i18n';

export function Field({ label, error, hint, children }: { label: string; error?: string; hint?: string; children: ReactNode }) {
  return (
    <label className="field">
      <span className="label">{label}</span>
      {children}
      {hint && <span className="hint">{hint}</span>}
      {error && <span className="error">{error}</span>}
    </label>
  );
}

export function NumberInput(props: { value: number; onChange(v: number): void; min: number; max: number; step?: number }) {
  return (
    <input
      type="number"
      value={Number.isNaN(props.value) ? '' : props.value}
      min={props.min}
      max={props.max}
      step={props.step ?? 1}
      onChange={(e) => props.onChange(e.target.valueAsNumber)}
    />
  );
}

export function ColorInput({ value, onChange }: { value: string; onChange(v: string): void }) {
  const valid = /^#[0-9a-fA-F]{6}$/.test(value);
  return (
    <span className="color">
      <input type="color" value={valid ? value : '#000000'} onChange={(e) => onChange(e.target.value)} />
      <input type="text" value={value} onChange={(e) => onChange(e.target.value)} />
    </span>
  );
}

export function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange(v: boolean): void }) {
  return (
    <label className="check">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} /> {label}
    </label>
  );
}

export function SlotInput({ value, onChange, hasLogo }: { value: Slot; onChange(v: Slot): void; hasLogo: boolean }) {
  const { t: tr } = useI18n();
  return (
    <span className="slot">
      <select
        value={value.type}
        onChange={(e) => {
          const type = e.target.value as Slot['type'];
          onChange(type === 'text' ? { type, value: value.type === 'text' ? value.value : '' } : { type });
        }}
      >
        <option value="empty">{tr('web.fields.slotEmpty')}</option>
        <option value="text">{tr('web.fields.slotText')}</option>
        <option value="logo" disabled={!hasLogo}>
          {tr('web.fields.slotLogo')}
        </option>
      </select>
      {value.type === 'text' && (
        <input
          type="text"
          value={value.value}
          placeholder={tr('web.fields.slotPlaceholder')}
          onChange={(e) => onChange({ type: 'text', value: e.target.value })}
        />
      )}
    </span>
  );
}

type Band = Template['header'];
const POSITIONS = ['left', 'center', 'right'] as const;

export function BandEditor(props: { value: Band; onChange(v: Band): void; hasLogo: boolean; issues: Record<string, string>; prefix: string }) {
  const { value, onChange } = props;
  const { t: tr } = useI18n();
  return (
    <div className="band">
      {POSITIONS.map((pos) => (
        <Field key={pos} label={tr(`web.fields.positions.${pos}`)} error={props.issues[`${props.prefix}.${pos}.value`]}>
          <SlotInput value={value[pos]} hasLogo={props.hasLogo} onChange={(slot) => onChange({ ...value, [pos]: slot })} />
        </Field>
      ))}
      <Field label={tr('web.fields.textSize')} hint={tr('web.fields.textSizeHint')} error={props.issues[`${props.prefix}.textSize`]}>
        <NumberInput
          value={value.textSize ?? NaN}
          min={5}
          max={14}
          step={0.5}
          onChange={(v) => onChange({ ...value, textSize: Number.isNaN(v) ? null : v })}
        />
      </Field>
      <Toggle label={tr('web.fields.bold')} checked={value.bold} onChange={(bold) => onChange({ ...value, bold })} />
      <Toggle label={tr('web.fields.rule')} checked={value.rule} onChange={(rule) => onChange({ ...value, rule })} />
      <Toggle label={tr('web.fields.skipFirstPage')} checked={value.skipFirstPage} onChange={(skipFirstPage) => onChange({ ...value, skipFirstPage })} />
      <p className="hint">{tr('web.fields.centerOnlyHint')}</p>
    </div>
  );
}
