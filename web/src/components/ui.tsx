import type { ReactNode } from 'react';
import type { Dec, Horizon, SignalLabel } from '../lib/data';
import { dir, HORIZON_LABEL, pct, signed, SIGNAL_LABEL } from '../lib/format';

/** 騰落率。上昇は赤、下落は青。▲▼ も必ず付ける */
export function Pct({ v, digits = 1, strong }: { v: number | null | undefined; digits?: number; strong?: boolean }) {
  const Tag = strong ? 'strong' : 'span';
  return (
    <Tag className="pct" data-dir={dir(v)}>
      {pct(v, digits)}
    </Tag>
  );
}

const ICON: Record<SignalLabel, string> = { buy: '◎', caution: '⚠', watch: '…', none: '' };

export function SignalBadge({ label }: { label: SignalLabel }) {
  if (label === 'none') return null;
  return (
    <span className={`badge badge-${label}`}>
      <span aria-hidden>{ICON[label]}</span> {SIGNAL_LABEL[label]}
    </span>
  );
}

/**
 * 要因分解の棒。0 を中心に、日経・セクター・個別の 3 本と合計を並べる。
 * 3 本を足すと合計になる。棒の色は向き（赤＝押し上げ、青＝押し下げ）。
 */
export function DecompBars({ d, scale }: { d: Dec | null; scale?: number }) {
  if (!d) return <p className="muted small">データが足りません</p>;
  const rows: [string, number][] = [
    ['日経平均', d.m],
    ['セクター', d.s],
    ...(d.i !== undefined ? ([['個別', d.i]] as [string, number][]) : []),
  ];
  const max = scale ?? Math.max(0.02, Math.abs(d.r), ...rows.map(([, v]) => Math.abs(v)));
  return (
    <div className="decomp" role="table" aria-label="騰落率の内訳">
      {rows.map(([label, v]) => (
        <div className="decomp-row" role="row" key={label}>
          <span className="decomp-label" role="cell">
            {label}
          </span>
          <span className="decomp-track" role="cell" aria-hidden>
            <span
              className="decomp-bar"
              data-dir={dir(v)}
              style={{
                width: `${Math.min(50, (Math.abs(v) / max) * 50)}%`,
                [v >= 0 ? 'left' : 'right']: '50%',
              }}
            />
          </span>
          <span className="decomp-val" role="cell">
            {signed(v)}
          </span>
        </div>
      ))}
      <div className="decomp-row decomp-total" role="row">
        <span className="decomp-label" role="cell">
          合計
        </span>
        <span className="decomp-track" role="cell" aria-hidden>
          <span
            className="decomp-bar"
            data-dir={dir(d.r)}
            style={{ width: `${Math.min(50, (Math.abs(d.r) / max) * 50)}%`, [d.r >= 0 ? 'left' : 'right']: '50%' }}
          />
        </span>
        <span className="decomp-val" role="cell">
          <Pct v={d.r} strong />
        </span>
      </div>
    </div>
  );
}

/** 内訳を 1 行で。リストの中で使う */
export function DecompInline({ d }: { d: Dec | null }) {
  if (!d) return null;
  return (
    <span className="decomp-inline small">
      日経 {signed(d.m)} / セクター {signed(d.s)}
      {d.i !== undefined && <> / 個別 <strong>{signed(d.i)}</strong></>}
    </span>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: [T, string][];
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div className="segmented" role="radiogroup" aria-label={label}>
      {options.map(([v, text]) => (
        <button key={v} type="button" role="radio" aria-checked={v === value} onClick={() => onChange(v)}>
          {text}
        </button>
      ))}
    </div>
  );
}

export function HorizonPicker({ value, onChange }: { value: Horizon; onChange: (h: Horizon) => void }) {
  return (
    <Segmented
      label="期間"
      value={value}
      onChange={onChange}
      options={(['1', '5', '20', '60'] as Horizon[]).map((h) => [h, HORIZON_LABEL[h]])}
    />
  );
}

export function Card({ title, children, action }: { title?: ReactNode; children: ReactNode; action?: ReactNode }) {
  return (
    <section className="card">
      {(title || action) && (
        <header className="card-head">
          {title && <h2>{title}</h2>}
          {action}
        </header>
      )}
      {children}
    </section>
  );
}

export function TopBar({ title, onBack, right }: { title: ReactNode; onBack?: () => void; right?: ReactNode }) {
  return (
    <header className="topbar">
      {onBack ? (
        <button type="button" className="icon-btn" onClick={onBack} aria-label="戻る">
          ‹
        </button>
      ) : (
        <span className="icon-spacer" />
      )}
      <h1>{title}</h1>
      {right ?? <span className="icon-spacer" />}
    </header>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="empty">{children}</p>;
}
