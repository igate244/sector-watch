import { useState } from 'react';
import type { Nav } from '../App';
import { HORIZONS, type DataState, type Horizon, type Latest, type MarketBlock, type Stock } from '../lib/data';
import { HORIZON_LABEL } from '../lib/format';
import { useHeldCodes } from '../lib/useHoldings';
import { Freshness, HeatTable, Loading, StockRow } from '../components/parts';
import { Card, Count, Empty, Pct, TopBar } from '../components/ui';
import LineChart from '../components/LineChart';

const FIRST = 6;

export default function TodayScreen({ state, h, nav }: { state: DataState; h: Horizon; nav: Nav }) {
  const held = useHeldCodes();
  const [allBuy, setAllBuy] = useState(false);
  const d = state.data;

  return (
    <>
      <TopBar title="今日" />
      <Freshness state={state} />
      <Loading state={state} />
      {d && (
        <>
          <Card>
            <div className="market-grid">
              <MarketKpi m={d.market.n225} label="日経平均" h={h} />
              {d.market.topix && <MarketKpi m={d.market.topix} label="TOPIX（1306）" h={h} />}
            </div>
            <MarketChart d={d} h={h} />
            <div className="hz-strip" aria-label="日経平均の期間別騰落率">
              {HORIZONS.map((x) => (
                <div key={x} data-on={x === h}>
                  <span className="k">{HORIZON_LABEL[x]}</span>
                  <Pct v={d.market.n225.ret[x]} />
                </div>
              ))}
            </div>
            {d.market_comment && (
              <div className="comment">
                <p>{d.market_comment.text}</p>
                <Sources list={d.market_comment.sources} />
              </div>
            )}
          </Card>

          <div className="summary">
            <button type="button" data-kind="buy" onClick={() => jump('buy')}>
              <span className="k">買い候補</span>
              <span className="v">{count(d.stocks, 'buy')}</span>
            </button>
            <button type="button" data-kind="caution" onClick={() => jump('caution')}>
              <span className="k">要注意</span>
              <span className="v">{count(d.stocks, 'caution')}</span>
            </button>
            <button type="button" data-kind="rise" onClick={() => jump('rise')}>
              <span className="k">初動候補</span>
              <span className="v">{count(d.stocks, 'rise')}</span>
            </button>
          </div>

          <HeldToday stocks={d.stocks.filter((s) => held.has(s.code))} h={h} nav={nav} />

          <div id="sec-buy" />
          <Card title={<>買い候補 <Count n={count(d.stocks, 'buy')} kind="buy" /></>} action={<span className="note" style={{ margin: 0 }}>20日・珍しい下げ順</span>}>
            <p className="note">下げの大半が日経平均とセクター（業種）につられたもの。</p>
            {(() => {
              const list = sorted(d.stocks, 'buy');
              if (!list.length) return <Empty>今日は買い候補がありません</Empty>;
              return (
                <>
                  <div className="list">
                    {(allBuy ? list : list.slice(0, FIRST)).map((s) => (
                      <StockRow key={s.code} s={s} h="20" showSector held={held.has(s.code)} onOpen={() => nav.open({ kind: 'stock', code: s.code })} />
                    ))}
                  </div>
                  {list.length > FIRST && (
                    <button type="button" className="link-btn block" onClick={() => setAllBuy((v) => !v)}>
                      {allBuy ? '閉じる' : `残り ${list.length - FIRST} 件を見る`}
                    </button>
                  )}
                </>
              );
            })()}
          </Card>

          <div id="sec-rise" />
          <Card title={<>初動候補 <Count n={count(d.stocks, 'rise')} kind="rise" /></>} action={<span className="note" style={{ margin: 0 }}>上がり始めの形</span>}>
            <p className="note">値幅が縮んだもみ合いのあと、60 日高値を抜けた銘柄。だましも多いので、抜けた高値を割ったら撤退が前提。</p>
            {count(d.stocks, 'rise') ? (
              <div className="list">
                {d.stocks
                  .filter((s) => s.signal.label === 'rise')
                  .sort((a, b) => (b.rise?.score ?? 0) - (a.rise?.score ?? 0) || (b.rise?.vol_ratio ?? 0) - (a.rise?.vol_ratio ?? 0))
                  .map((s) => (
                    <StockRow key={s.code} s={s} h="20" showSector held={held.has(s.code)} onOpen={() => nav.open({ kind: 'stock', code: s.code })} />
                  ))}
              </div>
            ) : (
              <Empty>今日は初動候補がありません</Empty>
            )}
          </Card>

          <div id="sec-caution" />
          <Card title={<>要注意 <Count n={count(d.stocks, 'caution')} kind="caution" /></>} action={<span className="note" style={{ margin: 0 }}>個別要因の下げ</span>}>
            {count(d.stocks, 'caution') ? (
              <div className="list">
                {sorted(d.stocks, 'caution').map((s) => (
                  <StockRow key={s.code} s={s} h="20" showSector held={held.has(s.code)} onOpen={() => nav.open({ kind: 'stock', code: s.code })} />
                ))}
              </div>
            ) : (
              <Empty>個別要因で大きく下げている銘柄はありません</Empty>
            )}
          </Card>

          <div id="sec-heat" />
          <Card title="セクターの温度">
            <HeatTable d={d} onOpen={(name) => nav.open({ kind: 'sector', name })} />
          </Card>
        </>
      )}
    </>
  );
}

function jump(id: string) {
  document.getElementById(`sec-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function MarketKpi({ m, label, h }: { m: MarketBlock; label: string; h: Horizon }) {
  return (
    <div className="kpi">
      <div className="kpi-label">
        <span>{label}</span>
        <span>{HORIZON_LABEL[h]}</span>
      </div>
      <div className="kpi-val">{m.last?.toLocaleString('ja-JP', { maximumFractionDigits: 2 })}</div>
      <Pct v={m.ret[h]} />
    </div>
  );
}

const STEP: Record<string, string> = { '5m': '5分足', '15m': '15分足', '60m': '60分足' };

/** 日経平均と TOPIX を 1 枚に重ねる。1・5・20 日は分足、60 日は日足。期間の始め（前の日の終値）を 0% にそろえる */
function MarketChart({ d, h }: { d: Latest; h: Horizon }) {
  const intra = h === '60' ? undefined : d.market.intraday?.[h];
  if (intra && intra.n225) {
    const series = [
      { label: '日経平均', values: intra.n225, kind: 'main' as const },
      ...(intra.topix ? [{ label: 'TOPIX', values: intra.topix, kind: 'sector' as const }] : []),
    ];
    const lastDay = intra.t[intra.t.length - 1].slice(0, 10);
    const hm = (s: string) => (s.slice(0, 10) === lastDay ? s.slice(11, 16) : '前日');
    const md = (s: string) => `${Number(s.slice(5, 7))}/${Number(s.slice(8, 10))}`;
    return (
      <>
        <LineChart
          dates={intra.t}
          days={intra.t.length - 1}
          height={160}
          series={series}
          fmtX={h === '1' ? hm : md}
          fmtRead={(s) => `${md(s)} ${s.slice(11, 16)}`}
        />
        <p className="note" style={{ margin: '2px 0 0' }}>
          {STEP[intra.interval] ?? intra.interval}・前の日の終値を 0%
        </p>
      </>
    );
  }
  // 分足がないとき（古いデータ・取得失敗）は日足
  return (
    <LineChart
      dates={d.dates}
      days={h === '1' ? 5 : Number(h)}
      height={160}
      series={[
        { label: '日経平均', values: d.market.n225.series, kind: 'main' },
        ...(d.market.topix ? [{ label: 'TOPIX', values: d.market.topix.series, kind: 'sector' as const }] : []),
      ]}
    />
  );
}

function HeldToday({ stocks, h, nav }: { stocks: Stock[]; h: Horizon; nav: Nav }) {
  if (!stocks.length) return null;
  return (
    <Card title={<>保有株 <Count n={stocks.length} /></>}>
      <div className="list">
        {stocks.map((s) => (
          <StockRow key={s.code} s={s} h={h} showSector onOpen={() => nav.open({ kind: 'stock', code: s.code })} />
        ))}
      </div>
    </Card>
  );
}

function count(list: Stock[], label: Stock['signal']['label']) {
  return list.filter((s) => s.signal.label === label).length;
}

function sorted(list: Stock[], label: Stock['signal']['label']) {
  return list.filter((s) => s.signal.label === label).sort((a, b) => (a.z20 ?? 0) - (b.z20 ?? 0));
}

export function Sources({ list }: { list: { title: string; url: string; date?: string }[] }) {
  if (!list.length) return null;
  return (
    <ul className="sources">
      {list.map((s, i) => (
        <li key={i}>
          <a href={s.url} target="_blank" rel="noreferrer">
            {s.title || s.url}
          </a>
          {s.date && <span className="muted small"> {s.date.slice(5).replace('-', '/')}</span>}
        </li>
      ))}
    </ul>
  );
}
