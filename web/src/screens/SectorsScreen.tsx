import type { Nav } from '../App';
import { stockByCode, type DataState, type Horizon } from '../lib/data';
import { dir, HORIZON_LABEL, signed } from '../lib/format';
import { Freshness, Loading } from '../components/parts';
import { Pct, TopBar } from '../components/ui';

export default function SectorsScreen({ state, h, nav }: { state: DataState; h: Horizon; nav: Nav }) {
  const d = state.data;
  return (
    <>
      <TopBar title="セクター" />
      <Freshness state={state} />
      <Loading state={state} />
      {d && (
        <>
          <p className="muted small pad">{HORIZON_LABEL[h]}の騰落率が低い順。セクターの値は構成銘柄の平均。</p>
          {(() => {
            const byCode = stockByCode(d);
            const n225 = d.market.n225.ret[h];
            return [...d.sectors]
              .sort((a, b) => (a.dec[h]?.r ?? 0) - (b.dec[h]?.r ?? 0))
              .map((s) => {
                const dec = s.dec[h];
                return (
                  <button key={s.name} type="button" className="card sector-card" onClick={() => nav.open({ kind: 'sector', name: s.name })}>
                    <div className="sector-head">
                      <h2>{s.name}</h2>
                      <Pct v={dec?.r} strong />
                    </div>
                    <div className="muted small">
                      日経との差 {dec && n225 != null ? signed(dec.r - n225) : '—'} ／ 内訳 日経 {signed(dec?.m)}・セクター固有 {signed(dec?.s)}
                    </div>
                    <div className="chips">
                      {s.codes.map((c) => {
                        const st = byCode.get(c);
                        if (!st) return null;
                        const r = st.dec[h]?.r;
                        return (
                          <span key={c} className="chip" data-dir={dir(r)}>
                            {st.signal.label === 'buy' && <span aria-label="買い候補">◎</span>}
                            {st.signal.label === 'caution' && <span aria-label="要注意">⚠</span>}
                            {shortName(st.name)} <strong>{signed(r)}</strong>
                          </span>
                        );
                      })}
                    </div>
                  </button>
                );
              });
          })()}
        </>
      )}
    </>
  );
}

export function shortName(name: string): string {
  const n = name
    .replace(/フィナンシャル・?グループ$/, '')
    .replace(/ホールディングス$/, 'HD')
    .replace(/グループ$/, 'G')
    .replace(/株式会社/g, '');
  return n.length > 8 ? n.slice(0, 7) + '…' : n;
}
