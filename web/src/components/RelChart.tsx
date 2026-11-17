/**
 * 日経平均との差の小さなチャート（セクター一覧の 1 行用）。mode='abs' ではそのものの騰落率（日経平均は灰色の破線で添える）。
 * 「セクターの騰落率 − 日経平均の騰落率」を期間の始めから追い、
 * 0 より上（日経より強い）は赤、下（弱い）は青で塗る。軸は 0 の線 1 本だけ。
 */
export default function RelChart({
  values,
  market,
  days,
  width = 120,
  height = 40,
  mode = 'rel',
}: {
  values: (number | null)[];
  market: (number | null)[];
  days: number;
  width?: number;
  height?: number;
  mode?: 'rel' | 'abs';
}) {
  const n = Math.min(values.length, market.length);
  const start = Math.max(0, n - 1 - days);
  const base = values.slice(start).find((v) => v != null);
  const mbase = market.slice(start).find((v) => v != null);
  if (base == null || mbase == null) return <svg width={width} height={height} />;
  const rel: (number | null)[] = [];
  for (let i = start; i < n; i++) {
    const v = values[i];
    const m = market[i];
    rel.push(v == null || m == null ? null : mode === 'abs' ? v / base - 1 : v / base - m / mbase);
  }
  const mk = mode === 'abs' ? market.slice(start, n).map((m) => (m == null ? null : m / mbase - 1)) : [];
  const xs = [...rel, ...mk].filter((v): v is number => v != null);
  const lim = Math.max(0.02, ...xs.map(Math.abs)) * 1.1;
  const x = (i: number) => (i / Math.max(1, rel.length - 1)) * width;
  const y = (v: number) => height / 2 - (v / lim) * (height / 2 - 2);
  let line = '';
  let first = -1;
  let last = -1;
  rel.forEach((v, i) => {
    if (v == null) return;
    line += `${first < 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(v).toFixed(1)}`;
    if (first < 0) first = i;
    last = i;
  });
  const area = `${line}L${x(last).toFixed(1)},${y(0)}L${x(first).toFixed(1)},${y(0)}Z`;
  const id = `rc${Math.random().toString(36).slice(2, 8)}`;
  const end = rel[last] ?? 0;
  return (
    <svg className="relchart" width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden>
      <defs>
        <clipPath id={`${id}u`}>
          <rect x="0" y="0" width={width} height={y(0)} />
        </clipPath>
        <clipPath id={`${id}d`}>
          <rect x="0" y={y(0)} width={width} height={height - y(0)} />
        </clipPath>
      </defs>
      <path d={area} className="rel-up" clipPath={`url(#${id}u)`} />
      <path d={area} className="rel-down" clipPath={`url(#${id}d)`} />
      <line x1="0" x2={width} y1={y(0)} y2={y(0)} className="rel-zero" />
      {mode === 'abs' && (
        <path
          className="rel-market"
          d={mk.reduce((acc, v, i) => (v == null ? acc : `${acc}${acc ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`), '')}
        />
      )}
      <path d={line} className="rel-line" data-dir={end > 0 ? 'up' : end < 0 ? 'down' : 'flat'} />
    </svg>
  );
}
