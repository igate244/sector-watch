import type { DataState, Horizon, Latest, Stock } from '../lib/data';
import { HORIZONS } from '../lib/data';
import { businessDaysSince, dateJa, HORIZON_LABEL, signed, timeJa } from '../lib/format';
import { Chg, DecompInline, Pct, SignalBadge } from './ui';

/** データの鮮度。古い値を最新と見間違えないよう、常に画面の上に出す */
export function Freshness({ state }: { state: DataState }) {
  const d = state.data;
  if (!d) return null;
  const late = businessDaysSince(d.asof);
  const st = state.offline ? 'offline' : late >= 2 ? 'late' : 'ok';
  return (
    <div className="freshness" role="status" data-state={st}>
      <i className="dot-status" aria-hidden />
      <span>
        <span className="num">{dateJa(d.asof)}</span> 終値
      </span>
      <span className="muted">· {timeJa(d.generated_at)} 計算</span>
      {state.offline && <span className="warn-text">· オフライン（前回の結果）</span>}
      {!state.offline && late >= 2 && <span className="warn-text">· 更新が止まっているかも</span>}
      <button type="button" className="link-btn" onClick={state.reload} disabled={state.loading}>
        {state.loading ? '読込中…' : '再読込'}
      </button>
    </div>
  );
}

export function Loading({ state }: { state: DataState }) {
  if (state.data) return null;
  if (state.error)
    return (
      <div className="card">
        <p>{state.error}</p>
        <p className="muted small">
          初回の計算がまだ終わっていないか、ネットに繋がっていません。
        </p>
        <button type="button" className="btn" onClick={state.reload}>
          もう一度読む
        </button>
      </div>
    );
  return <p className="empty">読み込み中…</p>;
}

export function StockRow({
  s,
  h,
  onOpen,
  showSector,
  held,
}: {
  s: Stock;
  h: Horizon;
  onOpen: () => void;
  showSector?: boolean;
  held?: boolean;
}) {
  const d = s.dec[h];
  return (
    <button type="button" className="row" onClick={onOpen}>
      <span className="row-main">
        <span className="row-title">
          {s.name}
          {held && <span className="held-tag">保有</span>}
        </span>
        <span className="row-sub">
          <span className="num">{s.code}</span>
          {showSector && <span>{s.sector}</span>}
          <span className="num">¥{s.last.toLocaleString('ja-JP')}</span>
          <SignalBadge label={s.signal.label} />
        </span>
        {s.signal.label === 'rise' && s.rise ? (
          <span className="hits">
            {s.rise.hits.map((x, i) => (
              <span key={x} className={i < 2 ? 'hit-main' : ''}>
                {x}
              </span>
            ))}
          </span>
        ) : (
          h !== '1' && <DecompInline d={d} />
        )}
      </span>
      <span className="row-side">
        <Chg v={d?.r} />
      </span>
    </button>
  );
}

/**
 * セクターの温度表。1 行目は日経平均そのもの、2 行目以降は「日経平均との差」。
 * 色は向きと大きさ（赤＝日経より強い、青＝日経より弱い）。数字も必ず出す。
 */
export function HeatTable({ d, onOpen }: { d: Latest; onOpen: (name: string) => void }) {
  const n = d.market.n225.ret;
  const rows = d.sectors
    .map((s) => ({ s, rel: Object.fromEntries(HORIZONS.map((h) => [h, s.dec[h] && n[h] != null ? s.dec[h]!.r - n[h]! : null])) }))
    .sort((a, b) => (a.rel['20'] ?? 0) - (b.rel['20'] ?? 0));
  const cell = (v: number | null, key: string) => {
    const a = v == null ? 0 : Math.min(1, Math.abs(v) / 0.12);
    return (
      <td
        key={key}
        className="heat"
        data-dir={v == null ? 'flat' : v > 0 ? 'up' : 'down'}
        data-strong={a > 0.7}
        style={{ ['--a' as string]: `${Math.round(a * 85)}%` }}
      >
        {signed(v)}
      </td>
    );
  };
  return (
    <div className="table-wrap">
      <table className="heat-table">
        <thead>
          <tr>
            <th scope="col">セクター</th>
            {HORIZONS.map((h) => (
              <th scope="col" key={h}>
                {HORIZON_LABEL[h]}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          <tr className="heat-market">
            <th scope="row">日経平均</th>
            {HORIZONS.map((h) => (
              <td key={h}>
                <Pct v={n[h]} />
              </td>
            ))}
          </tr>
          {rows.map(({ s, rel }) => (
            <tr key={s.name} onClick={() => onOpen(s.name)} className="clickable">
              <th scope="row">{s.name}</th>
              {HORIZONS.map((h) => cell(rel[h], h))}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="note" style={{ marginTop: 6 }}>2 行目からは日経平均との差。20 日の弱い順。タップで開く。</p>
    </div>
  );
}
