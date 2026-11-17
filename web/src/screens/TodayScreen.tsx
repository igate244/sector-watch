import { useState } from 'react';
import type { Nav } from '../App';
import { HORIZONS, type DataState, type Horizon, type Latest, type MarketBlock, type MarketEvent, type Stock } from '../lib/data';
import { HORIZON_LABEL } from '../lib/format';
import { useHeldCodes } from '../lib/useHoldings';
import { Freshness, Loading, StockRow } from '../components/parts';
import { Card, Count, Empty, Pct, Segmented, SettingsButton, TopBar } from '../components/ui';
import LineChart from '../components/LineChart';
import { askGemini, promptForEarnings, promptForEvent } from '../lib/askGemini';

export default function TodayScreen({ state, h, nav }: { state: DataState; h: Horizon; nav: Nav }) {
  const held = useHeldCodes();
  const d = state.data;

  return (
    <>
      <TopBar title="今日" right={<SettingsButton nav={nav} />} />
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
            {d.market_comment && <MarketComment c={d.market_comment} />}
          </Card>

          <div className="summary">
            <button type="button" data-kind="buy" onClick={() => nav.signals('buy')}>
              <span className="k">買い候補</span>
              <span className="v">{count(d.stocks, 'buy')}</span>
            </button>
            <button type="button" data-kind="caution" onClick={() => nav.signals('caution')}>
              <span className="k">要注意</span>
              <span className="v">{count(d.stocks, 'caution')}</span>
            </button>
            <button type="button" data-kind="rise" onClick={() => nav.signals('rise')}>
              <span className="k">初動候補</span>
              <span className="v">{count(d.stocks, 'rise')}</span>
            </button>
          </div>

          <Schedule
            events={d.events ?? []}
            held={held}
            nav={nav}
            sectors={d.sectors.map((x) => x.name)}
            heldNames={d.stocks.filter((x) => held.has(x.code)).map((x) => x.name)}
          />

          <HeldToday stocks={d.stocks.filter((s) => held.has(s.code))} h={h} nav={nav} />

          <Ranking stocks={d.stocks} h={h} held={held} nav={nav} />

        </>
      )}
    </>
  );
}

/** 市場のひとこと（Gemini）。長いので 2 行に畳み、タップで全部 */
function MarketComment({ c }: { c: NonNullable<Latest['market_comment']> }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="comment">
      <button type="button" className="comment-btn" data-open={open} onClick={() => setOpen(!open)}>
        {c.session === 'midday' && <span className="comment-tag">前場</span>}
        {c.text}
      </button>
      {open && <Sources list={c.sources} />}
    </div>
  );
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

/** 保有株。動きの大きい順に 5 つまで、1 行ずつ詰めて */
function HeldToday({ stocks, h, nav }: { stocks: Stock[]; h: Horizon; nav: Nav }) {
  const [all, setAll] = useState(false);
  if (!stocks.length) return null;
  const list = [...stocks].sort((a, b) => Math.abs(b.dec[h]?.r ?? 0) - Math.abs(a.dec[h]?.r ?? 0));
  return (
    <Card title={<>保有株 <Count n={stocks.length} /></>} action={<span className="note" style={{ margin: 0 }}>動きの大きい順</span>}>
      <div className="list">
        {(all ? list : list.slice(0, 5)).map((s) => (
          <StockRow key={s.code} s={s} h={h} showSector compact onOpen={() => nav.open({ kind: 'stock', code: s.code })} />
        ))}
      </div>
      {list.length > 5 && (
        <button type="button" className="link-btn block" onClick={() => setAll(!all)}>
          {all ? '閉じる' : `残り ${list.length - 5} 件を見る`}
        </button>
      )}
    </Card>
  );
}

/** 上昇率（下落率）ランキング。期間は下のバー */
function Ranking({ stocks, h, held, nav }: { stocks: Stock[]; h: Horizon; held: Set<string>; nav: Nav }) {
  const [side, setSide] = useState<'up' | 'down'>('up');
  const [all, setAll] = useState(false);
  const list = stocks
    .filter((s) => s.dec[h])
    .sort((a, b) => (side === 'up' ? b.dec[h]!.r - a.dec[h]!.r : a.dec[h]!.r - b.dec[h]!.r));
  const shown = list.slice(0, all ? 30 : 5);
  return (
    <>
      <div id="sec-rank" />
      <Card
        title={side === 'up' ? '上昇率ランキング' : '下落率ランキング'}
        action={
          <Segmented
            label="上昇か下落か"
            value={side}
            onChange={setSide}
            options={[
              ['up', '上昇'],
              ['down', '下落'],
            ]}
          />
        }
      >
        <p className="note">{HORIZON_LABEL[h]}・{stocks.length} 銘柄中。円は 1 株あたりの値幅</p>
        <div className="list">
          {shown.map((s, i) => (
            <StockRow key={s.code} s={s} h={h} rank={i + 1} showSector held={held.has(s.code)} onOpen={() => nav.open({ kind: 'stock', code: s.code })} />
          ))}
        </div>
        {list.length > 5 && (
          <button type="button" className="link-btn block" onClick={() => setAll(!all)}>
            {all ? '5 位までにする' : '30 位まで見る'}
          </button>
        )}
      </Card>
    </>
  );
}

const WD = ['日', '月', '火', '水', '木', '金', '土'];

/** これからの予定（大きなイベント・SQ・決算）。2 週間ぶん、「もっと見る」で先まで */
function AskButton({ onAsk }: { onAsk: () => void }) {
  return (
    <button type="button" className="ask-btn" onClick={onAsk} aria-label="Gemini に聞く（質問をコピーして開く）">
      ✦ 聞く
    </button>
  );
}

function Schedule({
  events,
  held,
  nav,
  sectors,
  heldNames,
}: {
  events: MarketEvent[];
  held: Set<string>;
  nav: Nav;
  sectors: string[];
  heldNames: string[];
}) {
  const [more, setMore] = useState(false);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const daysTo = (iso: string) => Math.round((new Date(iso + 'T00:00:00').getTime() - today.getTime()) / 86400000);
  const upcoming = events.filter((e) => daysTo(e.date) >= 0);
  const limit = more ? 120 : 7;
  const shown = upcoming.filter((e) => daysTo(e.date) <= limit);
  // 畳んでいるときは、直近の 3 日分（＋7 日以内の重要な予定）だけ
  const days = [...new Set(shown.map((e) => e.date))];
  const keepDays = more ? new Set(days) : new Set([...days.slice(0, 3), ...shown.filter((e) => e.level === '大').map((e) => e.date)]);
  const byDate = new Map<string, MarketEvent[]>();
  for (const e of shown) if (keepDays.has(e.date)) byDate.set(e.date, [...(byDate.get(e.date) ?? []), e]);
  const nextBig = upcoming.find((e) => e.level === '大');
  return (
    <>
      <div id="sec-schedule" />
      <Card title={<>予定 <Count n={shown.length} /></>} action={<span className="note" style={{ margin: 0 }}>{more ? '4 ヶ月先まで' : '1 週間'}</span>}>
        {!shown.length ? (
          <Empty>
            1 週間以内の予定はありません
            {nextBig && `。次の大きな予定は ${Number(nextBig.date.slice(5, 7))}/${Number(nextBig.date.slice(8, 10))} ${nextBig.title}`}
          </Empty>
        ) : (
          <div className="sched">
            {[...byDate.entries()].map(([date, list]) => {
              const dt = new Date(date + 'T00:00:00');
              const n = daysTo(date);
              const earn = list.filter((e) => e.kind === 'earnings');
              const heldEarn = earn.filter((e) => e.code && held.has(e.code));
              const otherEarn = earn.filter((e) => !(e.code && held.has(e.code)));
              return (
                <div className="sched-day" key={date}>
                  <div className="sched-date">
                    <span className="num">
                      {dt.getMonth() + 1}/{dt.getDate()}
                    </span>
                    <span className="wd">({WD[dt.getDay()]})</span>
                    <span className="in">{n === 0 ? '今日' : n === 1 ? '明日' : `${n}日後`}</span>
                  </div>
                  <div className="sched-items">
                    {list
                      .filter((e) => e.kind !== 'earnings')
                      .map((e, i) => (
                        <div key={i} className="sched-item" data-level={e.level}>
                          <span className="lvl">{e.level === '大' ? '重要' : e.kind === 'sq' ? 'SQ' : '予定'}</span>
                          <span className="ttl">
                            <span className="rg">{e.region === '米国' ? '米' : '日'}</span>
                            {e.title}
                            {e.time && <span className="tm"> {e.time}</span>}
                            {e.memo && <span className="memo">{e.memo}</span>}
                          </span>
                          <AskButton onAsk={() => askGemini(promptForEvent(e, sectors, heldNames))} />
                        </div>
                      ))}
                    {[...heldEarn, ...otherEarn].length > 0 && (
                      <div className="sched-item" data-level="決算">
                        <span className="lvl">決算</span>
                        <span className="ttl earn-list">
                          {[...heldEarn, ...otherEarn].slice(0, more ? 99 : 6).map((e) => (
                            <button key={e.code} type="button" className="earn-chip" data-held={!!(e.code && held.has(e.code))} onClick={() => e.code && nav.open({ kind: 'stock', code: e.code })}>
                              {e.title.replace(/ 決算$/, '')}
                              {e.code && held.has(e.code) && <span className="held-tag">保有</span>}
                            </button>
                          ))}
                          {!more && earn.length > 6 && <span className="muted small">ほか {earn.length - 6} 社</span>}
                        </span>
                        <AskButton
                          onAsk={() =>
                            askGemini(
                              promptForEarnings(
                                date,
                                [...heldEarn, ...otherEarn].slice(0, 8).map((x) => ({ name: x.title.replace(/ 決算$/, ''), code: x.code })),
                                sectors,
                                heldNames,
                              ),
                            )
                          }
                        />
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
        <button type="button" className="link-btn block" onClick={() => setMore(!more)}>
          {more ? '1 週間にする' : '先の予定も見る'}
        </button>
      </Card>
    </>
  );
}

function count(list: Stock[], label: Stock['signal']['label']) {
  return list.filter((s) => s.signal.label === label).length;
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
