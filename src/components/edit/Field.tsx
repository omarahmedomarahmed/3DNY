'use client';

import clsx from 'clsx';
import { useId } from 'react';

export type FieldType =
  | 'text'
  | 'number'
  | 'date'
  | 'select'
  | 'textarea'
  | 'string-array'
  | 'boolean';

export type FieldValue = string | number | boolean | string[] | null;

export interface FieldSpec {
  /** Property name on the entity — used verbatim in the PATCH body. */
  name: string;
  label: string;
  type: FieldType;
  options?: { value: string; label: string }[];
  placeholder?: string;
  hint?: string;
  /** Rendered full width in the drawer's two-column grid. */
  wide?: boolean;
}

const inputClass =
  'w-full rounded border border-hairline-strong bg-white px-2.5 py-1.5 text-sm text-ink ' +
  'placeholder:text-subtle transition-colors ' +
  'disabled:cursor-not-allowed disabled:bg-surface-alt disabled:opacity-60';

/** ISO timestamps arrive with a time component; <input type="date"> wants none. */
function toDateInput(value: FieldValue): string {
  if (typeof value !== 'string' || !value) return '';
  return value.slice(0, 10);
}

export function parseFieldInput(type: FieldType, raw: string | boolean): FieldValue {
  switch (type) {
    case 'boolean':
      return Boolean(raw);
    case 'number': {
      const text = String(raw).trim();
      if (!text) return null;
      const n = Number(text);
      return Number.isFinite(n) ? n : null;
    }
    case 'string-array':
      return String(raw)
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
    default: {
      const text = String(raw);
      return text.trim() === '' ? null : text;
    }
  }
}

export default function Field({
  spec,
  value,
  onChange,
  disabled,
  error,
}: {
  spec: FieldSpec;
  value: FieldValue;
  onChange: (next: FieldValue) => void;
  disabled?: boolean;
  error?: string | null;
}) {
  const id = useId();
  const { type, label, hint, options, placeholder } = spec;

  const emit = (raw: string | boolean) => onChange(parseFieldInput(type, raw));

  let control: React.ReactNode;

  if (type === 'boolean') {
    control = (
      <label className="flex cursor-pointer items-center gap-2 py-1 text-sm text-ink">
        <input
          id={id}
          type="checkbox"
          disabled={disabled}
          checked={value === true}
          onChange={(e) => emit(e.target.checked)}
          className="h-4 w-4 accent-[#001E5A]"
        />
        <span>{label}</span>
      </label>
    );
  } else if (type === 'textarea') {
    control = (
      <textarea
        id={id}
        rows={6}
        disabled={disabled}
        placeholder={placeholder}
        value={typeof value === 'string' ? value : ''}
        onChange={(e) => emit(e.target.value)}
        className={clsx(inputClass, 'resize-y font-mono text-[13px] leading-5')}
      />
    );
  } else if (type === 'select') {
    control = (
      <select
        id={id}
        disabled={disabled}
        value={typeof value === 'string' ? value : ''}
        onChange={(e) => emit(e.target.value)}
        className={inputClass}
      >
        <option value="">—</option>
        {(options ?? []).map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    );
  } else if (type === 'string-array') {
    control = (
      <input
        id={id}
        type="text"
        disabled={disabled}
        placeholder={placeholder ?? 'Comma separated'}
        value={Array.isArray(value) ? value.join(', ') : ''}
        onChange={(e) => emit(e.target.value)}
        className={inputClass}
      />
    );
  } else {
    control = (
      <input
        id={id}
        type={type === 'number' ? 'number' : type === 'date' ? 'date' : 'text'}
        step={type === 'number' ? 'any' : undefined}
        disabled={disabled}
        placeholder={placeholder}
        value={
          type === 'date'
            ? toDateInput(value)
            : value === null || value === undefined || typeof value === 'boolean'
              ? ''
              : Array.isArray(value)
                ? value.join(', ')
                : String(value)
        }
        onChange={(e) => emit(e.target.value)}
        className={clsx(inputClass, type === 'number' && 'tabular')}
      />
    );
  }

  return (
    <div className={clsx('flex flex-col gap-1', spec.wide && 'sm:col-span-2')}>
      {type !== 'boolean' && (
        <label
          htmlFor={id}
          className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted"
        >
          {label}
        </label>
      )}
      {control}
      {hint && <p className="text-[11px] leading-4 text-muted">{hint}</p>}
      {error && (
        <p className="rounded bg-danger-surface px-2 py-1 text-[11px] font-medium leading-4 text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
