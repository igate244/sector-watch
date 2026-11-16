import { useEffect, useMemo, useRef, useState } from 'react';
import { dateJa, signed } from '../lib/format';

/**
 * 期間の始めを 0% にそろえた比較チャート（最大 3 本: 銘柄・セクター・日経平均）。
 * - 軸は 1 本だけ（すべて「期間の始めからの騰落率」）
 * - 触れた位置の値は、指で隠れないようチャートの上の固定欄に出す
 * - 凡例を必ず出し、線の右端にも名前を付ける（色だけで見分けさせない）
 */

export type SeriesKind = 'main' | 'sector' | 'market';

export interface ChartSeries {
  label: string;
  values: (number | null)[];
  kind: SeriesKind;
}

interface Props {
  dates: string[];
  series: ChartSeries[];
  /** 表示する営業日数 */
  days: number;
  height?: number;
  /** 横の参照線（例: 平均取得単価）。main の線と同じ基準で 0% からの位置に直して描く */
  refLine?: { price: number; label: string };
}

const PAD = { top: 8, right: 64, bottom: 22, left: 40 };

function useWidth<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
  const ref = useRef<T>(null);
  const [w, setW] = useState(320);
  useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(240, e.contentRect.width)));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

function niceStep(span: number): number {
  const raw = span / 4;
  const p = 10 ** Math.floor(Math.log10(raw));
  return [1, 2, 2.5, 5, 10].map((m) => m * p).find((s) => s >= raw) ?? raw;
}

export default function LineChart({ dates, series, days, height = 220, refLine }: Props) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);

  const n = dates.length;
  const start = Math.max(0, n - 1 - days);
  const view = dates.slice(start);

  // 期間の始めを 0 にした騰落率に直す
  const lines = useMemo(
    () =>
      series.map((s) => {
        const vals = s.values.slice(start);
        const base = vals.find((v) => v != null) ?? null;
        return { ...s, pts: vals.map((v) => (v == null || base == null ? null : v / base - 1)) };
      }),
    [series, start],
  );

  // 参照線は main の期間の始めの値で割って、ほかの線と同じ目盛りにそろえる
  const mainBase = (() => {
    const m = series.find((x) => x.kind === 'main');
    return m ? (m.values.slice(start).find((v) => v != null) ?? null) : null;
  })();
  const refV = refLine && mainBase ? refLine.price / mainBase - 1 : null;

  const all = [...lines.flatMap((l) => l.pts.filter((v): v is number => v != null)), ...(refV != null ? [refV] : [])];
  let lo = Math.min(0, ...all);
  let hi = Math.max(0, ...all);
  if (hi - lo < 0.02) {
    hi += 0.01;
    lo -= 0.01;
  }
  const step = niceStep(hi - lo);
  lo = Math.floor(lo / step) * step;
  hi = Math.ceil(hi / step) * step;

  const iw = width - PAD.left - PAD.right;
  const ih = height - PAD.top - PAD.bottom;
  const x = (i: number) => PAD.left + (view.length <= 1 ? 0 : (i / (view.length - 1)) * iw);
  const y = (v: number) => PAD.top + (1 - (v - lo) / (hi - lo)) * ih;

  const ticks: number[] = [];
  for (let v = lo; v <= hi + step / 2; v += step) ticks.push(Number(v.toFixed(6)));

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

  const at = hover ?? view.length - 1;
  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - r.left;
    const i = Math.round(((px - PAD.left) / iw) * (view.length - 1));
    setHover(Math.max(0, Math.min(view.length - 1, i)));
  };

  // 線の右端ラベルが重ならないよう、縦位置をずらす
  const ends = lines
    .map((l) => {
      let i = l.pts.length - 1;
      while (i >= 0 && l.pts[i] == null) i--;
      return { l, v: i >= 0 ? (l.pts[i] as number) : null };
    })
    .filter((e) => e.v != null)
    .sort((a, b) => (b.v as number) - (a.v as number));
  let prevY = -Infinity;
  const endLabels = ends.map((e) => {
    let yy = y(e.v as number);
    if (yy - prevY < 14) yy = prevY + 14;
    prevY = yy;
    return { ...e, yy };
  });

  const xLabels = [0, Math.floor((view.length - 1) / 2), view.length - 1];

  return (
    <div className="chart" ref={ref}>
      <div className="chart-readout" aria-live="polite">
        <span className="chart-date">{view[at] ? dateJa(view[at]) : ''}</span>
        {lines.map((l) => (
          <span key={l.label} className="chart-val">
            <i className={`key key-${l.kind}`} aria-hidden />
            <span className="muted">{l.label}</span> <strong>{signed(l.pts[at])}</strong>
          </span>
        ))}
      </div>
      <svg
        width={width}
        height={height}
        role="img"
        aria-label={`${lines.map((l) => l.label).join('・')}の比較チャート`}
        onPointerMove={onMove}
        onPointerDown={onMove}
        onPointerLeave={() => setHover(null)}
        style={{ touchAction: 'pan-y' }}
      >
        {ticks.map((t) => (
          <g key={t}>
            <line x1={PAD.left} x2={PAD.left + iw} y1={y(t)} y2={y(t)} className={t === 0 ? 'axis-zero' : 'grid'} />
            <text x={PAD.left - 6} y={y(t) + 4} className="tick" textAnchor="end">
              {Math.round(t * 100)}%
            </text>
          </g>
        ))}
        {xLabels.map((i, k) => (
          <text
            key={i + '-' + k}
            x={x(i)}
            y={height - 6}
            className="tick"
            textAnchor={k === 0 ? 'start' : k === 2 ? 'end' : 'middle'}
          >
            {view[i] ? `${Number(view[i].slice(5, 7))}/${Number(view[i].slice(8, 10))}` : ''}
          </text>
        ))}
        {refV != null && (
          <g>
            <line x1={PAD.left} x2={PAD.left + iw} y1={y(refV)} y2={y(refV)} className="ref-line" />
            <text x={PAD.left + 2} y={y(refV) - 3} className="ref-label">
              {refLine!.label}
            </text>
          </g>
        )}
        {/* 描く順: 日経（下）→ セクター → 銘柄（上） */}
        {[...lines]
          .sort((a, b) => ORDER[a.kind] - ORDER[b.kind])
          .map((l) => (
            <path key={l.label} d={path(l.pts)} className={`line line-${l.kind}`} />
          ))}
        {endLabels.map((e) => (
          <text key={e.l.label} x={PAD.left + iw + 6} y={e.yy + 4} className="end-label">
            {e.l.label.length > 6 ? e.l.label.slice(0, 6) + '…' : e.l.label}
          </text>
        ))}
        {hover != null && (
          <g>
            <line x1={x(at)} x2={x(at)} y1={PAD.top} y2={PAD.top + ih} className="crosshair" />
            {lines.map((l) =>
              l.pts[at] == null ? null : (
                <circle key={l.label} cx={x(at)} cy={y(l.pts[at] as number)} r={4} className={`dot dot-${l.kind}`} />
              ),
            )}
          </g>
        )}
      </svg>
    </div>
  );
}

const ORDER: Record<SeriesKind, number> = { market: 0, sector: 1, main: 2 };
