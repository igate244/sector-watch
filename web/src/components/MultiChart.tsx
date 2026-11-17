import { useEffect, useRef, useState } from 'react';
import { dateJa, signed } from '../lib/format';

/**
 * セクターの構成銘柄をまとめて見る大きなチャート。期間の始めを 0% にそろえる。
 * - 銘柄は細い灰色の線。選んだ 1 銘柄だけ太く黒（色が付くのは 選んだ銘柄・セクター平均・日経平均 の 3 本まで）
 * - 線に触れると一番近い銘柄が選ばれる（onSelect）。下の銘柄一覧から選んでも強調される
 * - 触れた日付の値はチャートの上の欄に出す
 */
export interface MultiLine {
  key: string;
  label: string;
  values: (number | null)[];
}

const PAD = { top: 8, right: 8, bottom: 22, left: 40 };

export default function MultiChart({
  dates,
  days,
  lines,
  sector,
  market,
  selected,
  onSelect,
  height = 230,
}: {
  dates: string[];
  days: number;
  lines: MultiLine[];
  sector: (number | null)[];
  market: (number | null)[];
  selected: string | null;
  onSelect: (key: string | null) => void;
  height?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(340);
  const [hover, setHover] = useState<number | null>(null);
  useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(240, e.contentRect.width)));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);

  const n = dates.length;
  const start = Math.max(0, n - 1 - days);
  const view = dates.slice(start);
  const norm = (vals: (number | null)[]) => {
    const v = vals.slice(start);
    const b = v.find((x) => x != null);
    return v.map((x) => (x == null || b == null ? null : x / b - 1));
  };
  const L = lines.map((l) => ({ ...l, pts: norm(l.values) }));
  const S = norm(sector);
  const M = norm(market);
  const all = [...L.flatMap((l) => l.pts), ...S, ...M].filter((v): v is number => v != null);
  let lo = Math.min(0, ...all);
  let hi = Math.max(0, ...all);
  const padv = (hi - lo) * 0.06 || 0.01;
  lo -= padv;
  hi += padv;
  const iw = w - PAD.left - PAD.right;
  const ih = height - PAD.top - PAD.bottom;
  const x = (i: number) => PAD.left + (i / Math.max(1, view.length - 1)) * iw;
  const y = (v: number) => PAD.top + (1 - (v - lo) / (hi - lo)) * ih;
  const path = (pts: (number | null)[]) => {
    let d = '';
    let pen = false;
    pts.forEach((v, i) => {
      if (v == null) {
        pen = false;
        return;
      }
      d += `${pen ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`;
      pen = true;
    });
    return d;
  };
  const raw = (hi - lo) / 4;
  const p10 = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * p10).find((s) => s >= raw) ?? raw;
  const ticks: number[] = [];
  for (let t = Math.ceil(lo / step) * step; t <= hi; t += step) ticks.push(t);

  const idxAt = (clientX: number) => {
    const r = ref.current!.getBoundingClientRect();
    const px = clientX - r.left;
    return Math.max(0, Math.min(view.length - 1, Math.round(((px - PAD.left) / iw) * (view.length - 1))));
  };
  // 触れた点に一番近い銘柄の線を選ぶ
  const pick = (clientX: number, clientY: number) => {
    const r = ref.current!.getBoundingClientRect();
    const i = idxAt(clientX);
    const py = clientY - r.top;
    let best: string | null = null;
    let bd = 18; // 18px より遠ければ選ばない
    for (const l of L) {
      const v = l.pts[i];
      if (v == null) continue;
      const dd = Math.abs(y(v) - py);
      if (dd < bd) {
        bd = dd;
        best = l.key;
      }
    }
    return best;
  };

  const at = hover ?? view.length - 1;
  const sel = L.find((l) => l.key === selected);
  const ordered = sel ? [...L.filter((l) => l.key !== selected), sel] : L;

  return (
    <div className="chart multichart" ref={ref}>
      <div className="chart-readout" aria-live="polite">
        <span className="chart-date">{view[at] ? dateJa(view[at]) : ''}</span>
        {sel && (
          <span className="chart-val">
            <span className="key key-main" />
            {sel.label} <strong>{signed(sel.pts[at])}</strong>
          </span>
        )}
        <span className="chart-val">
          <span className="key key-sector" />
          平均 <strong>{signed(S[at])}</strong>
        </span>
        <span className="chart-val">
          <span className="key key-market" />
          日経 <strong>{signed(M[at])}</strong>
        </span>
      </div>
      <svg
        width={w}
        height={height}
        role="img"
        aria-label="構成銘柄の比較チャート。線に触れると銘柄を選べます"
        onPointerDown={(e) => {
          setHover(idxAt(e.clientX));
          const k = pick(e.clientX, e.clientY);
          if (k) onSelect(k === selected ? null : k);
        }}
        onPointerMove={(e) => e.buttons && setHover(idxAt(e.clientX))}
        onPointerLeave={() => setHover(null)}
        style={{ touchAction: 'pan-y' }}
      >
        {ticks.map((t) => (
          <g key={t}>
            <line x1={PAD.left} x2={w - PAD.right} y1={y(t)} y2={y(t)} className={Math.abs(t) < 1e-9 ? 'axis-zero' : 'grid'} />
            <text x={PAD.left - 6} y={y(t) + 3} textAnchor="end" className="tick">
              {Math.round(t * 100)}%
            </text>
          </g>
        ))}
        {[0, Math.floor((view.length - 1) / 2), view.length - 1].map((i) => (
          <text key={i} x={x(i)} y={height - 6} textAnchor={i === 0 ? 'start' : i === view.length - 1 ? 'end' : 'middle'} className="tick">
            {view[i] ? `${Number(view[i].slice(5, 7))}/${Number(view[i].slice(8, 10))}` : ''}
          </text>
        ))}
        <path d={path(M)} className="line line-market" />
        {ordered.map((l) => (
          <path key={l.key} d={path(l.pts)} className={l.key === selected ? 'line ml-sel' : 'line ml-other'} data-dim={selected != null && l.key !== selected} />
        ))}
        <path d={path(S)} className="line line-sector" />
        {hover != null && <line x1={x(at)} x2={x(at)} y1={PAD.top} y2={PAD.top + ih} className="crosshair" />}
      </svg>
      <div className="mc-legend">
        <span>
          <span className="key key-main" />
          選んだ銘柄
        </span>
        <span>
          <span className="key key-other" />
          ほかの銘柄
        </span>
        <span>
          <span className="key key-sector" />
          セクター平均
        </span>
        <span>
          <span className="key key-market" />
          日経平均
        </span>
      </div>
    </div>
  );
}
