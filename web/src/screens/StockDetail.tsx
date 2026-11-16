import { useState } from 'react';
import type { Nav } from '../App';
import { HORIZONS, type DataState, type Horizon } from '../lib/data';
import { HORIZON_LABEL, signed, signedYen, yen } from '../lib/format';
import { usePositions } from '../lib/useHoldings';
import LineChart from '../components/LineChart';
import { Card, DecompBars, Empty, HorizonPicker, Pct, Segmented, SignalBadge, TopBar } from '../components/ui';
import { Sources } from './TodayScreen';
import { WINDOWS, type Win } from './SectorDetail';

export default function StockDetail({ state, code, nav }: { state: DataState; code: string; nav: Nav }) {
  const [win, setWin] = useState<Win>('60');
  const [h, setH] = useState<Horizon>('20');
  const positions = usePositions();
  const d = state.data;
  const s = d?.stocks.find((x) => x.code === code);
  const sector = d?.sectors.find((x) => x.name === s?.sector);
  const pos = positions?.find((p) => p.code === code);

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
            <div className="muted small">
              {s.code} · {s.sector}
            </div>
            <div className="big">{s.last.toLocaleString('ja-JP')}円</div>
            <Pct v={s.dec['1']?.r} strong /> <span className="muted small">前日比</span>
          </div>
          <SignalBadge label={s.signal.label} />
        </div>
        {s.signal.reason && <p className="reason">{s.signal.reason}</p>}
        {s.memo && <p className="muted small">メモ: {s.memo}</p>}
      </Card>

      <Card title="比較チャート">
        <Segmented label="チャートの期間" value={win} onChange={setWin} options={WINDOWS} />
        <LineChart
          dates={d.dates}
          days={Number(win)}
          series={[
            { label: shortLabel(s.name), values: s.series, kind: 'main' },
            ...(sector ? [{ label: `${s.sector}平均`, values: sector.series, kind: 'sector' as const }] : []),
            { label: '日経平均', values: d.market.n225.series, kind: 'market' },
          ]}
        />
      </Card>

      <Card title="値動きの内訳" action={<HorizonPicker value={h} onChange={setH} />}>
        <DecompBars d={s.dec[h]} />
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

      <Card title="指標">
        <dl className="stats">
          <dt>
            β<span className="dt-note">日経平均への感応度（直近 1 年）</span>
          </dt>
          <dd>{s.beta}</dd>
          <dt>60 日高値から</dt>
          <dd>
            <Pct v={s.dd60} />
          </dd>
          <dt>
            1 年の値幅の中の位置<span className="dt-note">0%＝1 年の安値、100%＝高値</span>
          </dt>
          <dd>{s.pos1y == null ? '—' : `${Math.round(s.pos1y * 100)}%`}</dd>
          <dt>
            20 日の下げの珍しさ<span className="dt-note">普段の値動きの何倍か。−2 以下はかなり珍しい</span>
          </dt>
          <dd>{s.z20 ?? '—'}</dd>
        </dl>
      </Card>

      <Card title={n?.by === 'gemini' ? 'ニュースの確認（Gemini＋Google 検索）' : 'ニュース'}>
        {!n ? (
          <Empty>下げていない銘柄は確認していません</Empty>
        ) : n.by === 'gemini' ? (
          <>
            <p>
              {n.bad_news === true && <strong className="warn-text">個別の悪材料あり。</strong>}
              {n.bad_news === false && <strong>目立った個別の悪材料なし。</strong>}
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
            <p className="muted small">AI による要約。判断の前に出典を確認すること。</p>
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
