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

/** Extra checks a field has to pass before the drawer will let a save through. */
export type FieldRule = 'positive-number' | 'email' | 'date';

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
  /** Groups the field under a heading in the drawer. */
  section?: string;
  rule?: FieldRule;
}

/** A loose but honest email shape — one @, a dot in the domain, no spaces. */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/**
 * Returns a message when the value is wrong, null when it is fine. Empty is
 * always allowed: clearing a field is a legitimate edit, and the rules here are
 * about nonsense values, not required ones.
 */
export function validateField(spec: FieldSpec, value: FieldValue): string | null {
  const empty =
    value === null ||
    value === undefined ||
    (typeof value === 'string' && value.trim() === '') ||
    (Array.isArray(value) && value.length === 0);

  if (spec.type === 'number' && !empty && typeof value !== 'number') {
    return `${spec.label} must be a number.`;
  }
  if (empty) return null;

  switch (spec.rule) {
    case 'positive-number': {
      const n = typeof value === 'number' ? value : Number(value);
      if (!Number.isFinite(n)) return `${spec.label} must be a number.`;
      if (n <= 0) return `${spec.label} must be greater than zero.`;
      return null;
    }
    case 'email':
      return typeof value === 'string' && EMAIL_RE.test(value.trim())
        ? null
        : 'That does not look like an email address.';
    case 'date': {
      const text = String(value).slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return 'Use a real date.';
      const parsed = new Date(`${text}T00:00:00Z`);
      if (Number.isNaN(parsed.getTime())) return 'Use a real date.';
      // Rejects 2025-02-31, which Date would otherwise roll into March.
      if (parsed.toISOString().slice(0, 10) !== text) return 'That date does not exist.';
      return null;
    }
    default:
      return null;
  }
}

const inputClass =
  'w-full rounded border border-hairline-strong bg-white px-2.5 py-1.5 text-sm font-medium text-ink ' +
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
  changed,
}: {
  spec: FieldSpec;
  value: FieldValue;
  onChange: (next: FieldValue) => void;
  disabled?: boolean;
  error?: string | null;
  /** Draws the Goldenrod dot that marks an edited-but-unsaved field. */
  changed?: boolean;
}) {
  const id = useId();
  const { type, label, hint, options, placeholder } = spec;

  const emit = (raw: string | boolean) => onChange(parseFieldInput(type, raw));

  const invalid = Boolean(error);
  const box = clsx(inputClass, invalid && 'border-danger bg-danger-surface/40');

  let control: React.ReactNode;

  if (type === 'boolean') {
    control = (
      <label className="flex cursor-pointer items-center gap-2 py-1 text-sm font-medium text-ink">
        <input
          id={id}
          type="checkbox"
          disabled={disabled}
          checked={value === true}
          onChange={(e) => emit(e.target.checked)}
          className="h-4 w-4 accent-[#001E5A]"
        />
        <span className="flex items-center gap-1.5">
          {label}
          {changed && <ChangedDot />}
        </span>
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
        className={clsx(box, 'resize-y font-mono text-[13px] leading-5')}
      />
    );
  } else if (type === 'select') {
    control = (
      <select
        id={id}
        disabled={disabled}
        value={typeof value === 'string' ? value : ''}
        onChange={(e) => emit(e.target.value)}
        className={box}
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
        className={box}
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
        className={clsx(box, type === 'number' && 'tabular text-right')}
      />
    );
  }

  return (
    <div className={clsx('flex flex-col gap-1', spec.wide && 'sm:col-span-2')}>
      {type !== 'boolean' && (
        <label
          htmlFor={id}
          className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted"
        >
          {label}
          {changed && <ChangedDot />}
        </label>
      )}
      {control}
      {hint && <p className="text-[11px] font-medium leading-4 text-muted">{hint}</p>}
      {error && (
        <p className="rounded bg-danger-surface px-2 py-1 text-sm font-medium leading-4 text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

/** The one mark that says "you changed this and have not saved it yet". */
function ChangedDot() {
  return (
    <span
      aria-label="Changed"
      title="Changed — not saved yet"
      className="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-goldenrod"
    />
  );
}
