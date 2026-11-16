import { useState } from 'react';
import type { Nav } from '../App';
import { stockByCode, type DataState, type Horizon } from '../lib/data';
import { dir, HORIZON_LABEL, signed } from '../lib/format';
import LineChart from '../components/LineChart';
import { Freshness, Loading } from '../components/parts';
import { Chg, Segmented, TopBar } from '../components/ui';
import { WINDOWS, type Win } from './SectorDetail';

/** チャートの期間はセクター一覧と詳細で共通。次に開いたときも覚えておく */
export const WIN_KEY = 'sw.chartWin';
export function savedWin(): Win {
  try {
    const v = localStorage.getItem(WIN_KEY) as Win | null;
    if (v && WINDOWS.some(([w]) => w === v)) return v;
  } catch {
    /* 読めなくても既定値で続ける */
  }
  return '60';
}
export function saveWin(v: Win) {
  try {
    localStorage.setItem(WIN_KEY, v);
  } catch {
    /* 保存できなくても表示は変わる */
  }
}

export default function SectorsScreen({ state, h, nav }: { state: DataState; h: Horizon; nav: Nav }) {
  const [win, setWin] = useState<Win>(savedWin);
  const d = state.data;
  const changeWin = (v: Win) => {
    setWin(v);
    saveWin(v);
  };

  return (
    <>
      <TopBar title="セクター" />
      <Freshness state={state} />
      <Loading state={state} />
      {d && (
        <>
          <div className="chart-win">
            <span className="hz-label">チャート</span>
            <Segmented label="チャートの期間" value={win} onChange={changeWin} options={WINDOWS} />
          </div>
          <p className="note pad">
            並びと騰落率は{HORIZON_LABEL[h]}（下の期間で切替）。チャートは期間の始めを 0% にそろえたセクター平均と日経平均（破線）。
          </p>
          {(() => {
            const byCode = stockByCode(d);
            const n225 = d.market.n225.ret[h];
            return [...d.sectors]
              .sort((a, b) => (a.dec[h]?.r ?? 0) - (b.dec[h]?.r ?? 0))
              .map((s) => {
                const dec = s.dec[h];
                const rel = dec && n225 != null ? dec.r - n225 : null;
                const w = rel == null ? 0 : Math.min(50, (Math.abs(rel) / 0.15) * 50);
                const openIt = () => nav.open({ kind: 'sector', name: s.name });
                return (
                  <section key={s.name} className="card sector-card">
                    <button type="button" className="sector-open" onClick={openIt}>
                      <div className="sector-head">
                        <div>
                          <h3>{s.name}</h3>
                          <div className="sector-sub">
                            日経比 <span className="num">{signed(rel)}</span> · 日経分{' '}
                            <span className="num">{signed(dec?.m)}</span> · 業種固有{' '}
                            <span className="num">{signed(dec?.s)}</span>
                          </div>
                        </div>
                        <Chg v={dec?.r} />
                      </div>
                      <div className="rel-bar" aria-hidden>
                        <span
                          data-dir={dir(rel)}
                          style={{ width: `${w}%`, [rel != null && rel >= 0 ? 'left' : 'right']: '50%' }}
                        />
                      </div>
                    </button>

                    <LineChart
                      dates={d.dates}
                      days={Number(win)}
                      height={150}
                      series={[
                        { label: `${s.name}平均`, values: s.series, kind: 'sector' },
                        { label: '日経平均', values: d.market.n225.series, kind: 'market' },
                      ]}
                    />

                    <button type="button" className="sector-open" onClick={openIt}>
                      <div className="chips">
                        {[...s.codes]
                          .sort((a, b) => (byCode.get(a)?.dec[h]?.r ?? 0) - (byCode.get(b)?.dec[h]?.r ?? 0))
                          .map((c) => {
                            const st = byCode.get(c);
                            if (!st) return null;
                            const r = st.dec[h]?.r;
                            return (
                              <span key={c} className="chip" data-dir={dir(r)}>
                                <span className="nm">
                                  {st.signal.label === 'buy' && (
                                    <span className="sig sig-buy" aria-label="買い候補">
                                      ◎
                                    </span>
                                  )}
                                  {st.signal.label === 'rise' && (
                                    <span className="sig sig-rise" aria-label="初動候補">
                                      ↗
                                    </span>
                                  )}
                                  {st.signal.label === 'caution' && (
                                    <span className="sig sig-caution" aria-label="要注意">
                                      ⚠
                                    </span>
                                  )}
                                  {shortName(st.name)}
                                </span>
                                <strong>{signed(r)}</strong>
                              </span>
                            );
                          })}
                      </div>
                    </button>
                  </section>
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
