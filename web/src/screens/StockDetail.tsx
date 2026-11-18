import type { Nav } from '../App';
import { HORIZONS, useStockIntraday, type DataState } from '../lib/data';
import { HORIZON_LABEL, signed, signedYen, yen } from '../lib/format';
import { usePositions } from '../lib/useHoldings';
import LineChart from '../components/LineChart';
import { askGemini, promptForEarnings, promptForStock } from '../lib/askGemini';
import { Card, Chg, DecompBars, Empty, Pct, SignalBadge, sinceText, TopBar } from '../components/ui';
import { Sources } from './TodayScreen';
import { chartDays, decOf, PERIOD_LABEL, usePeriod } from '../lib/period';

const STEP: Record<string, string> = { '5m': '5分足', '15m': '15分足', '60m': '60分足' };

export default function StockDetail({ state, code, nav }: { state: DataState; code: string; nav: Nav }) {
  const p = usePeriod();
  const positions = usePositions();
  const d = state.data;
  const s = d?.stocks.find((x) => x.code === code);
  const sector = d?.sectors.find((x) => x.name === s?.sector);
  const pos = positions?.find((p) => p.code === code);
  const intra = useStockIntraday(code, d?.asof);

  if (!d || !s) {
    return (
      <>
        <TopBar title={code} onBack={nav.back} />
        <Empty>この銘柄は銘柄リストにありません</Empty>
      </>
    );
  }

  const n = s.news;
  const value = pos && pos.qty > 0 ? s.last * pos.qty : 0;
  const pnl = pos && pos.qty > 0 ? value - pos.cost : 0;

  return (
    <>
      <TopBar title={s.name} onBack={nav.back} />
      <Card>
        <div className="stock-head">
          <div>
            <div className="meta">
              <span className="num">{s.code}</span>
              <span>{s.sector}</span>
            </div>
            <div className="price-line">
              <span className="big">¥{s.last.toLocaleString('ja-JP')}</span>
              <Chg v={s.dec['1']?.r} />
            </div>
            <div className="note" style={{ margin: 0 }}>
              前日比 · {s.asof.slice(5).replace('-', '/')} 終値
            </div>
            {s.earnings?.next && (
              <div className="note" style={{ margin: 0 }}>
                次の決算: <strong className="num">{Number(s.earnings.next.slice(5, 7))}/{Number(s.earnings.next.slice(8, 10))}</strong>
                {s.earnings.next_est ? '（目安・前回の約 3 ヶ月後）' : s.earnings.kind ? `（${s.earnings.kind}）` : '（予定）'}{' '}
                <button
                  type="button"
                  className="ask-btn"
                  onClick={() =>
                    askGemini(
                      promptForEarnings(
                        s.earnings!.next!,
                        [{ name: s.name, code: s.code }],
                        d.sectors.map((x) => x.name),
                        [],
                      ),
                    )
                  }
                >
                  ✦ 聞く
                </button>
              </div>
            )}
          </div>
          <span className="sig-since">
            <SignalBadge label={s.signal.label} />
            {sinceText(s.signal) && <span className="muted num">{sinceText(s.signal)}</span>}
          </span>
        </div>
        <div className="kpi-grid">
          <div>
            <div className="k">20日 騰落</div>
            <div className="v">
              <Pct v={s.dec['20']?.r} />
            </div>
            <div className="h">うち個別 {signed(s.dec['20']?.i ?? null)}</div>
          </div>
          <div>
            <div className="k">60日高値から</div>
            <div className="v">
              <Pct v={s.dd60} />
            </div>
          </div>
          <div>
            <div className="k">1年レンジ位置</div>
            <div className="v">{s.pos1y == null ? '—' : `${Math.round(s.pos1y * 100)}%`}</div>
            {s.pos1y != null && (
              <div className="range" aria-hidden>
                <i style={{ left: `${Math.max(0, Math.min(100, s.pos1y * 100))}%` }} />
              </div>
            )}
          </div>
          <div>
            <div className="k">β · 下げの珍しさ</div>
            <div className="v">
              {s.beta} · {s.z20 ?? '—'}
            </div>
            <div className="h">珍しさ −2 以下＝かなり珍しい</div>
          </div>
        </div>
        {s.signal.reason && <p className="reason">{s.signal.reason}</p>}
        {s.memo && <p className="muted small">メモ: {s.memo}</p>}
        <button
          type="button"
          className="ask-pro"
          onClick={() => {
            const sec = d.sectors.find((x) => x.name === s.sector);
            const n20 = d.market.n225.ret['20'];
            askGemini(
              promptForStock(s, {
                sectorRel20: sec?.dec['20'] && n20 != null ? sec.dec['20'].r - n20 : null,
                n225r20: n20,
                held: pos && pos.qty > 0 ? { qty: pos.qty, avg: pos.avg } : null,
              }),
            );
          }}
        >
          ✦ いま買って大丈夫？ プロの目で Gemini に聞く
        </button>
        <p className="note" style={{ margin: '4px 0 0' }}>
          最新のニュース・決算・割安さ・チャートを調べてから、根拠つきで答えるよう頼む質問をコピーして Gemini を開きます
        </p>
      </Card>

      <Card title={`比較チャート（${PERIOD_LABEL[p]}）`}>
        {(p === '1' || p === '5' || p === '20') && intra?.h[p] ? (
          (() => {
            const b = intra.h[p]!;
            const lastDay = b.t[b.t.length - 1].slice(0, 10);
            const md = (x: string) => `${Number(x.slice(5, 7))}/${Number(x.slice(8, 10))}`;
            const hm = (x: string) => (x.slice(0, 10) === lastDay ? x.slice(11, 16) : '前日');
            return (
              <>
                <LineChart unit="¥"
                  dates={b.t}
                  days={b.t.length - 1}
                  fmtX={p === '1' ? hm : md}
                  fmtRead={(x) => `${md(x)} ${x.slice(11, 16)}`}
                  series={[
                    { label: shortLabel(s.name), values: b.stock, kind: 'main' },
                    ...(b.sector ? [{ label: `${s.sector}平均`, values: b.sector, kind: 'sector' as const }] : []),
                    ...(b.n225 ? [{ label: '日経平均', values: b.n225, kind: 'market' as const }] : []),
                  ]}
                />
                <p className="note" style={{ margin: '2px 0 0' }}>
                  {STEP[b.interval] ?? b.interval}・前の日の終値を 0%
                </p>
              </>
            );
          })()
        ) : (
          <LineChart unit="¥"
            dates={d.dates}
            days={chartDays(p)}
            series={[
              { label: shortLabel(s.name), values: s.series, kind: 'main' },
              ...(sector ? [{ label: `${s.sector}平均`, values: sector.series, kind: 'sector' as const }] : []),
              { label: '日経平均', values: d.market.n225.series, kind: 'market' },
            ]}
          />
        )}
      </Card>

      <Card title={`値動きの内訳（${PERIOD_LABEL[p]}）`}>
        {decOf(s, p) ? <DecompBars d={decOf(s, p)} /> : <p className="note">内訳は 3ヶ月 までです。下の表で期間ごとに見られます</p>}
        <table className="mini-table">
          <thead>
            <tr>
              <th />
              {HORIZONS.map((x) => (
                <th key={x}>{HORIZON_LABEL[x]}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {(['r', 'm', 's', 'i'] as const).map((k) => (
              <tr key={k}>
                <th scope="row">{{ r: '騰落率', m: '日経', s: 'セクター', i: '個別' }[k]}</th>
                {HORIZONS.map((x) => (
                  <td key={x}>{k === 'r' ? <Pct v={s.dec[x]?.r} /> : signed(s.dec[x]?.[k] ?? null)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <Card title={n?.by === 'gemini' ? (n.kind === 'rise' ? '上昇の材料（Gemini＋Google 検索）' : 'ニュースの確認（Gemini＋Google 検索）') : 'ニュース'}>
        {!n ? (
          <Empty>下げていない・初動でもない銘柄は確認していません</Empty>
        ) : n.by === 'gemini' ? (
          <>
            <p>
              {n.bad_news === true && <strong className="warn-text">個別の悪材料あり。</strong>}
              {n.bad_news === false && <strong>目立った個別の悪材料なし。</strong>}
              {n.good_news === true && <strong className="pct" data-dir="up">好材料あり。</strong>}
              {n.good_news === false && <strong>はっきりした好材料は見つからず。</strong>}
              {n.summary}
            </p>
            {n.factors.length > 0 && (
              <ul className="factors">
                {n.factors.map((f) => (
                  <li key={f}>{f}</li>
                ))}
              </ul>
            )}
            <Sources list={n.sources} />
            {n.searched === false || !n.sources.length ? (
              <p className="warn-text small">
                出典がありません。検索せずに AI の知識だけで答えた可能性があるので、鵜呑みにしないこと。
              </p>
            ) : (
              <p className="muted small">AI による要約。判断の前に出典を確認すること。</p>
            )}
          </>
        ) : (
          <>
            <p className="muted small">Google ニュースの見出し（直近 2 週間）。AI の判定はしていない。</p>
            <Sources list={n.sources} />
          </>
        )}
      </Card>

      <Card
        title="自分の保有"
        action={
          <button type="button" className="link-btn" onClick={() => nav.open({ kind: 'trades', code: s.code, name: s.name, addNew: true })}>
            ＋ 記録
          </button>
        }
      >
        {pos && pos.qty > 0 ? (
          <dl className="stats">
            <dt>株数</dt>
            <dd>{pos.qty.toLocaleString('ja-JP')} 株</dd>
            <dt>平均取得単価</dt>
            <dd>{yen(pos.avg, 1)} 円</dd>
            <dt>評価損益</dt>
            <dd>
              <span className="pct" data-dir={pnl >= 0 ? 'up' : 'down'}>
                {signedYen(pnl)} 円
              </span>{' '}
              <Pct v={pos.avg ? s.last / pos.avg - 1 : null} />
            </dd>
          </dl>
        ) : (
          <p className="muted small">{pos ? 'いまは持っていません。' : '記録はありません。'}</p>
        )}
        {pos && (
          <button type="button" className="link-btn" onClick={() => nav.open({ kind: 'trades', code: s.code, name: s.name })}>
            取引の記録を見る（{pos.trades.length} 件）
          </button>
        )}
      </Card>

      <p className="pad small">
        <a href={`https://finance.yahoo.co.jp/quote/${s.code}.T`} target="_blank" rel="noreferrer">
          Yahoo!ファイナンスで見る
        </a>
      </p>
    </>
  );
}

function shortLabel(name: string) {
  return name.length > 6 ? name.slice(0, 6) : name;
}
