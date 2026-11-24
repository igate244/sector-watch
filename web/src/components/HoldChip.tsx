import type { HoldCheck } from '../lib/holdCheck';

/** 保有の「このまま持ってて大丈夫か」の小さな印（色だけに頼らず記号と文字つき） */
export function HoldChip({ c }: { c: HoldCheck }) {
  return (
    <span className={`hold-chip hold-${c.level}`} title={c.reason}>
      <span aria-hidden>{c.icon}</span> {c.label}
    </span>
  );
}
