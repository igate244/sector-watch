import { useState } from 'react';
import type { Nav } from '../App';
import type { DataState, Horizon, Stock } from '../lib/data';
import { HORIZON_LABEL } from '../lib/format';
import { useHeldCodes } from '../lib/useHoldings';
import { Freshness, HeatTable, Loading, StockRow } from '../components/parts';
import { Card, Empty, Pct, TopBar } from '../components/ui';

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
          <Card title="市場">
            <div className="market-grid">
              <div>
                <div className="muted small">日経平均</div>
                <div className="big">{d.market.n225.last?.toLocaleString('ja-JP')}</div>
                <Pct v={d.market.n225.ret[h]} strong /> <span className="muted small">{HORIZON_LABEL[h]}</span>
              </div>
              {d.market.topix && (
                <div>
                  <div className="muted small">TOPIX（1306 ETF）</div>
                  <div className="big">{d.market.topix.last?.toLocaleString('ja-JP')}</div>
                  <Pct v={d.market.topix.ret[h]} strong /> <span className="muted small">{HORIZON_LABEL[h]}</span>
                </div>
              )}
            </div>
            {d.market_comment && (
              <div className="comment">
                <p>{d.market_comment.text}</p>
                <Sources list={d.market_comment.sources} />
              </div>
            )}
          </Card>

          <HeldToday stocks={d.stocks.filter((s) => held.has(s.code))} h={h} nav={nav} />

          <Card title={`買い候補 ${count(d.stocks, 'buy')}`}>
            <p className="muted small">20 日の下げの大半が、日経平均とセクターにつられたもの。珍しい下げの順。</p>
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

          <Card title={`要注意（個別要因） ${count(d.stocks, 'caution')}`}>
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

          <Card title="セクターの温度">
            <HeatTable d={d} onOpen={(name) => nav.open({ kind: 'sector', name })} />
          </Card>
        </>
      )}
    </>
  );
}

function HeldToday({ stocks, h, nav }: { stocks: Stock[]; h: Horizon; nav: Nav }) {
  if (!stocks.length) return null;
  return (
    <Card title="保有株">
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
