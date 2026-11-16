import { useState } from 'react';
import type { Nav } from '../App';
import { stockByCode, type DataState, type Horizon } from '../lib/data';
import { HORIZON_LABEL } from '../lib/format';
import { useHeldCodes } from '../lib/useHoldings';
import LineChart from '../components/LineChart';
import { StockRow } from '../components/parts';
import { Card, DecompBars, Empty, Segmented, TopBar } from '../components/ui';
import { savedWin, saveWin } from './SectorsScreen';

export type Win = '20' | '60' | '120' | '249';
export const WINDOWS: [Win, string][] = [
  ['20', '1ヶ月'],
  ['60', '3ヶ月'],
  ['120', '6ヶ月'],
  ['249', '1年'],
];

export default function SectorDetail({ state, name, h, nav }: { state: DataState; name: string; h: Horizon; nav: Nav }) {
  const [win, setWinState] = useState<Win>(savedWin);
  const setWin = (v: Win) => {
    setWinState(v);
    saveWin(v);
  };
  const held = useHeldCodes();
  const d = state.data;
  const s = d?.sectors.find((x) => x.name === name);

  return (
    <>
      <TopBar title={name} onBack={nav.back} />
      {!d || !s ? (
        <Empty>このセクターは見つかりません（銘柄リストから外れた可能性があります）</Empty>
      ) : (
        <>
          <Card title="セクター平均と日経平均">
            <Segmented label="チャートの期間" value={win} onChange={setWin} options={WINDOWS} />
            <LineChart
              dates={d.dates}
              days={Number(win)}
              series={[
                { label: `${name}平均`, values: s.series, kind: 'sector' },
                { label: '日経平均', values: d.market.n225.series, kind: 'market' },
              ]}
            />
          </Card>

          <Card title={`${HORIZON_LABEL[h]}の内訳`}>
            <DecompBars d={s.dec[h]} />
            <p className="muted small">
              日経平均の分 ＝ セクターの感応度 β（{s.beta}）× 日経平均の騰落率。残りがセクター固有の動き。
            </p>
          </Card>

          <Card title={`構成銘柄（${HORIZON_LABEL[h]}）`}>
            <div className="list">
              {(() => {
                const by = stockByCode(d);
                return s.codes
                  .map((c) => by.get(c))
                  .filter((x): x is NonNullable<typeof x> => Boolean(x))
                  .sort((a, b) => (a.dec[h]?.r ?? 0) - (b.dec[h]?.r ?? 0))
                  .map((st) => (
                    <StockRow key={st.code} s={st} h={h} held={held.has(st.code)} onOpen={() => nav.open({ kind: 'stock', code: st.code })} />
                  ));
              })()}
            </div>
            <p className="muted small">銘柄ごとのセクター要因は「その銘柄を除いた残りの中央値」で計算している。</p>
          </Card>
        </>
      )}
    </>
  );
}
