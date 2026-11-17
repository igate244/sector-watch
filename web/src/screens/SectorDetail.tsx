import type { Nav } from '../App';
import { stockByCode, type DataState } from '../lib/data';
import { chartDays, decOf, PERIOD_LABEL, retOf, usePeriod } from '../lib/period';
import { useHeldCodes } from '../lib/useHoldings';
import LineChart from '../components/LineChart';
import { StockRow } from '../components/parts';
import { Card, DecompBars, Empty, TopBar } from '../components/ui';

export default function SectorDetail({ state, name, nav }: { state: DataState; name: string; nav: Nav }) {
  const p = usePeriod();
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
            <LineChart
              dates={d.dates}
              days={chartDays(p)}
              series={[
                { label: `${name}平均`, values: s.series, kind: 'sector' },
                { label: '日経平均', values: d.market.n225.series, kind: 'market' },
              ]}
            />
          </Card>

          <Card title={`${PERIOD_LABEL[p]}の内訳`}>
            {decOf(s, p) ? <DecompBars d={decOf(s, p)} /> : <Empty>内訳は 3ヶ月 までです（6ヶ月・1年は騰落率だけ）</Empty>}
            <p className="muted small">
              日経平均の分 ＝ セクターの感応度 β（{s.beta}）× 日経平均の騰落率。残りがセクター固有の動き。
            </p>
          </Card>

          <Card title={`構成銘柄（${PERIOD_LABEL[p]}）`}>
            <div className="list">
              {(() => {
                const by = stockByCode(d);
                return s.codes
                  .map((c) => by.get(c))
                  .filter((x): x is NonNullable<typeof x> => Boolean(x))
                  .sort((a, b) => (retOf(a, p) ?? 0) - (retOf(b, p) ?? 0))
                  .map((st) => (
                    <StockRow key={st.code} s={st} held={held.has(st.code)} onOpen={() => nav.open({ kind: 'stock', code: st.code })} />
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
