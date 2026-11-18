import type { ReactNode } from 'react';
import type { Dec, SignalLabel } from '../lib/data';
import { PERIODS, type Period } from '../lib/period';
import { dir, pct, signed, SIGNAL_LABEL } from '../lib/format';

/** 騰落率。上昇は赤、下落は青。▲▼ も必ず付ける */
export function Pct({ v, digits = 1, strong }: { v: number | null | undefined; digits?: number; strong?: boolean }) {
  const Tag = strong ? 'strong' : 'span';
  return (
    <Tag className="pct" data-dir={dir(v)}>
      {pct(v, digits)}
    </Tag>
  );
}

const ICON: Record<SignalLabel, string> = { buy: '◎', caution: '⚠', rise: '↗', watch: '…', none: '' };

export function SignalBadge({ label, days, capped }: { label: SignalLabel; days?: number; capped?: boolean }) {
  if (label === 'none') return null;
  return (
    <span className={`badge badge-${label}`}>
      <span aria-hidden>{ICON[label]}</span> {SIGNAL_LABEL[label]}
      {days === 1 ? (
        <span className="badge-new">新</span>
      ) : days ? (
        <span className="badge-days num">{capped ? '長期' : `${days}日目`}</span>
      ) : null}
    </span>
  );
}

/** 判定がいつから続いているか（詳細画面用） */
export function sinceText(s: { since?: string; days?: number; capped?: boolean }): string | null {
  if (!s.since || !s.days) return null;
  const md = `${Number(s.since.slice(5, 7))}/${Number(s.since.slice(8, 10))}`;
  if (s.days === 1) return '今日から';
  return s.capped ? `${md} より前から続いている` : `${md} から（${s.days} 営業日目）`;
}

/**
 * 要因分解の棒。0 を中心に、日経・セクター・個別の 3 本と合計を並べる。
 * 3 本を足すと合計になる。棒の色は向き（赤＝押し上げ、青＝押し下げ）。
 */
export function DecompBars({ d, scale }: { d: Dec | null; scale?: number }) {
  if (!d) return <p className="muted small">データが足りません</p>;
  const rows: [string, number, string][] = [
    ['日経平均', d.m, 'm'],
    ['セクター', d.s, 's'],
    ...(d.i !== undefined ? ([['個別', d.i, 'i']] as [string, number, string][]) : []),
  ];
  const max = scale ?? Math.max(0.02, Math.abs(d.r), ...rows.map(([, v]) => Math.abs(v)));
  return (
    <div className="decomp" role="table" aria-label="騰落率の内訳">
      {rows.map(([label, v, k]) => (
        <div className="decomp-row" role="row" key={label}>
          <span className="decomp-label" role="cell">
            <i className={`fdot fdot-${k}`} aria-hidden />
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

/** 内訳を 1 行で。リストの中で使う。● の色はチャートの線と同じ（灰＝日経、橙＝セクター、黒＝個別） */
export function DecompInline({ d }: { d: Dec | null }) {
  if (!d) return null;
  return (
    <span className="factor-line" aria-label="騰落率の内訳">
      <span>
        <i className="fdot fdot-m" aria-hidden />
        日経<b>{signed(d.m)}</b>
      </span>
      <span>
        <i className="fdot fdot-s" aria-hidden />
        業種<b>{signed(d.s)}</b>
      </span>
      {d.i !== undefined && (
        <span className="f-i">
          <i className="fdot fdot-i" aria-hidden />
          個別<b>{signed(d.i)}</b>
        </span>
      )}
    </span>
  );
}

/** 騰落率の塗りタグ。一覧の右端用 */
export function Chg({ v, digits = 1 }: { v: number | null | undefined; digits?: number }) {
  return (
    <span className="chg" data-dir={dir(v)}>
      {pct(v, digits)}
    </span>
  );
}

/** 見出しの横の件数 */
export function Count({ n, kind }: { n: number; kind?: string }) {
  return (
    <span className="count" data-kind={kind}>
      {n}
    </span>
  );
}

/** 小さな推移の線。最後の値と最初の値で色を決める */
export function Sparkline({ values, days = 60 }: { values: (number | null)[]; days?: number }) {
  const xs = values.slice(-days - 1);
  const pts = xs.map((v, i) => [i, v] as const).filter((p): p is readonly [number, number] => p[1] != null);
  if (pts.length < 2) return null;
  const W = 120;
  const H = 34;
  const ys = pts.map((p) => p[1]);
  const lo = Math.min(...ys);
  const hi = Math.max(...ys);
  const sx = (i: number) => (i / (xs.length - 1)) * W;
  const sy = (v: number) => (hi === lo ? H / 2 : 2 + (1 - (v - lo) / (hi - lo)) * (H - 4));
  const line = pts.map(([i, v], k) => `${k ? 'L' : 'M'}${sx(i).toFixed(1)},${sy(v).toFixed(1)}`).join('');
  const area = `${line}L${sx(pts[pts.length - 1][0]).toFixed(1)},${H}L${sx(pts[0][0]).toFixed(1)},${H}Z`;
  const first = pts[0][1];
  return (
    <svg className="spark" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" data-dir={dir(pts[pts.length - 1][1] / first - 1)} aria-hidden>
      <line x1="0" x2={W} y1={sy(first)} y2={sy(first)} vectorEffect="non-scaling-stroke" />
      <path className="a" d={area} />
      <path className="l" d={line} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

const ICONS: Record<string, ReactNode> = {
  today: <path d="M3 17l5-5 4 4 8-8M15 8h5v5" />,
  sectors: (
    <>
      <rect x="3.5" y="3.5" width="7" height="7" rx="1.5" />
      <rect x="13.5" y="3.5" width="7" height="7" rx="1.5" />
      <rect x="3.5" y="13.5" width="7" height="7" rx="1.5" />
      <rect x="13.5" y="13.5" width="7" height="7" rx="1.5" />
    </>
  ),
  holdings: (
    <>
      <rect x="3" y="6" width="18" height="13" rx="2" />
      <path d="M3 10h18M16 14.5h2" />
    </>
  ),
  settings: (
    <>
      <path d="M4 7h10M18 7h2M4 17h4M12 17h8" />
      <circle cx="16" cy="7" r="2" />
      <circle cx="10" cy="17" r="2" />
    </>
  ),
  back: <path d="M15 5l-7 7 7 7" />,
  track: <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />,
  signals: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <circle cx="12" cy="12" r="4.5" />
      <circle cx="12" cy="12" r="0.8" fill="currentColor" />
    </>
  ),
  gear: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
    </>
  ),
};

export function Icon({ name }: { name: keyof typeof ICONS | string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {ICONS[name]}
    </svg>
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

/** 画面下の期間のバー（アプリ全体で 1 つ） */
export function PeriodPicker({ value, onChange }: { value: Period; onChange: (p: Period) => void }) {
  return <Segmented label="期間" value={value} onChange={onChange} options={PERIODS} />;
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
    <header className={onBack ? 'topbar sub' : 'topbar'}>
      {onBack ? (
        <button type="button" className="icon-btn" onClick={onBack} aria-label="戻る">
          <Icon name="back" />
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

/** 右上の歯車。設定を重ねて開く */
export function SettingsButton({ nav }: { nav: { open: (o: { kind: 'settings' }) => void } }) {
  return (
    <button type="button" className="icon-btn" onClick={() => nav.open({ kind: 'settings' })} aria-label="設定">
      <Icon name="gear" />
    </button>
  );
}
