import { useRef, useState } from 'react';
import type { Nav } from '../App';
import { loadCodes, stockByCode, type DataState, type Latest, type Stock } from '../lib/data';
import { db } from '../lib/db';
import { dir, signedYen, yen } from '../lib/format';
import { decodeCsv, parseRakutenCsv, toTrade, type ParsedTrade } from '../lib/rakutenCsv';
import { usePositions } from '../lib/useHoldings';
import { Card, Chg, Count, Empty, Pct, Segmented, SettingsButton, SignalBadge, TopBar } from '../components/ui';
import LineChart from '../components/LineChart';
import type { Position } from '../lib/holdings';
import { WINDOWS, type Win } from './SectorDetail';
import { savedWin, saveWin, shortName } from './SectorsScreen';

export default function HoldingsScreen({ state, nav }: { state: DataState; nav: Nav }) {
  const positions = usePositions();
  const [showClosed, setShowClosed] = useState(false);
  const [win, setWin] = useState<Win>(savedWin);
  const changeWin = (v: Win) => {
    setWin(v);
    saveWin(v);
  };
  const d = state.data;
  const by = d ? stockByCode(d) : new Map();

  const open = (positions ?? []).filter((p) => p.qty > 0);
  const closed = (positions ?? []).filter((p) => p.qty === 0);
  let value = 0;
  let cost = 0;
  let unpriced = 0;
  for (const p of open) {
    const s = by.get(p.code);
    if (s) {
      value += s.last * p.qty;
      cost += p.cost;
    } else unpriced++;
  }
  const realized = (positions ?? []).reduce((a, p) => a + p.realized, 0);

  // 株価のある保有。今日の損益は「終値 − 前日の終値」× 株数
  const priced: HoldRow[] = open.flatMap((p) => {
    const s = by.get(p.code);
    if (!s) return [];
    const r1 = s.dec['1']?.r ?? 0;
    const val = s.last * p.qty;
    return [{ p, s, val, pnl: val - p.cost, pnlR: p.cost ? val / p.cost - 1 : null, day: val - val / (1 + r1), dayR: s.dec['1']?.r ?? null }];
  });
  const dayPnl = priced.reduce((a, r) => a + r.day, 0);
  const [sort, setSort] = useState<'value' | 'pnl' | 'day'>('value');
  const [opened, setOpened] = useState<string | null>(null);
  const sortedPriced = [...priced].sort((a, b) =>
    sort === 'value' ? b.val - a.val : sort === 'pnl' ? (b.pnlR ?? 0) - (a.pnlR ?? 0) : (b.dayR ?? 0) - (a.dayR ?? 0),
  );

  return (
    <>
      <TopBar
        title="保有"
        right={
          <span className="topbar-right">
            <button type="button" className="link-btn" onClick={() => nav.open({ kind: 'trades', code: '', name: '', addNew: true })}>
              ＋ 記録
            </button>
            <SettingsButton nav={nav} />
          </span>
        }
      />
      <Card>
        <div className="hold-summary">
          <div>
            <div className="k">評価額</div>
            <div className="v num">¥{yen(value)}</div>
          </div>
          <div>
            <div className="k">評価損益</div>
            <div className="v num">
              <span className="pct" data-dir={dir(cost ? value / cost - 1 : 0)}>
                {signedYen(value - cost)}
              </span>
            </div>
            <Pct v={cost ? value / cost - 1 : null} />
          </div>
          <div>
            <div className="k">今日の損益</div>
            <div className="v num">
              <span className="pct" data-dir={dir(dayPnl)}>
                {signedYen(dayPnl)}
              </span>
            </div>
            <Pct v={value - dayPnl ? dayPnl / (value - dayPnl) : null} />
          </div>
        </div>
        <p className="note" style={{ margin: '8px 0 0' }}>
          確定損益（記録した期間） {signedYen(realized)} 円・手数料と税は含まない
          {unpriced > 0 && <>。銘柄リストにない {unpriced} 銘柄は株価がないので評価額に入っていません</>}
        </p>
      </Card>

      {priced.length > 0 && <Allocation rows={priced} />}

      {!positions ? null : !open.length ? (
        <Card title={<>保有中 <Count n={0} /></>}>
          <Empty>記録がありません。右上の「＋ 記録」か、下の CSV 取り込みから入れてください</Empty>
        </Card>
      ) : (
        <Card
          title={<>保有中 <Count n={open.length} /></>}
          action={
            <Segmented
              label="並び順"
              value={sort}
              onChange={setSort}
              options={[
                ['value', '金額'],
                ['pnl', '損益'],
                ['day', '前日比'],
              ]}
            />
          }
        >
          <div className="htable-head" aria-hidden>
            <span>銘柄・株数・平均取得</span>
            <span>前日比</span>
            <span>損益</span>
          </div>
          <div className="list">
            {sortedPriced.map((r) => (
              <HoldingRow key={r.p.code} r={r} total={value} d={d!} nav={nav} open={opened === r.p.code} onToggle={() => setOpened(opened === r.p.code ? null : r.p.code)} win={win} onWin={changeWin} />
            ))}
            {open
              .filter((p) => !by.get(p.code))
              .map((p) => (
                <NoPriceRow key={p.code || p.name} p={p} nav={nav} />
              ))}
          </div>
        </Card>
      )}

      <CsvImport />

      {closed.length > 0 && (
        <Card
          title={`売却済み ${closed.length}`}
          action={
            <button type="button" className="link-btn" onClick={() => setShowClosed((v) => !v)}>
              {showClosed ? '閉じる' : '開く'}
            </button>
          }
        >
          {showClosed && (
            <div className="list">
              {closed.map((p) => (
                <button key={p.code || p.name} type="button" className="row" onClick={() => nav.open({ kind: 'trades', code: p.code, name: p.name })}>
                  <span className="row-main">
                    <span className="row-title">{by.get(p.code)?.name ?? p.name}</span>
                    <span className="row-sub muted small">
                      {p.code} · 最後の取引 {p.lastTrade}
                    </span>
                  </span>
                  <span className="row-side">
                    <strong className="pct" data-dir={p.realized >= 0 ? 'up' : 'down'}>
                      {signedYen(p.realized)}
                    </strong>
                  </span>
                </button>
              ))}
            </div>
          )}
        </Card>
      )}
    </>
  );
}

interface HoldRow {
  p: Position;
  s: Stock;
  val: number;
  pnl: number;
  pnlR: number | null;
  day: number;
  dayR: number | null;
}

/** 1 行で数字を全部。タップでチャートと詳細を開く */
function HoldingRow({
  r,
  total,
  d,
  nav,
  open,
  onToggle,
  win,
  onWin,
}: {
  r: HoldRow;
  total: number;
  d: Latest;
  nav: Nav;
  open: boolean;
  onToggle: () => void;
  win: Win;
  onWin: (w: Win) => void;
}) {
  const { p, s } = r;
  const sector = d.sectors.find((x) => x.name === s.sector);
  return (
    <div className="hrow" data-open={open}>
      <button type="button" className="hrow-main" onClick={onToggle} aria-expanded={open}>
        <span className="hrow-name">
          <span className="row-title">{s.name}</span>
          <span className="row-sub">
            <span className="num">{p.qty.toLocaleString('ja-JP')}株</span>
            <span className="num">¥{yen(p.avg, 0)}→{s.last.toLocaleString('ja-JP')}</span>
            <span className="num">{total ? Math.round((r.val / total) * 100) : 0}%</span>
          </span>
        </span>
        <span className="hrow-day">
          <Pct v={r.dayR} />
          <span className="num small" data-dir={dir(r.day)}>
            {signedYen(Math.round(r.day))}
          </span>
        </span>
        <span className="hrow-pnl">
          <span className="yen num" data-dir={dir(r.pnl)}>
            {signedYen(Math.round(r.pnl))}
          </span>
          <Chg v={r.pnlR} />
        </span>
      </button>
      {open && (
        <div className="hrow-detail">
          <div className="row-sub" style={{ marginBottom: 4 }}>
            <span className="num">{s.code}</span>
            <span>{s.sector}</span>
            <span className="num">評価額 ¥{yen(r.val)}</span>
            <SignalBadge label={s.signal.label} />
          </div>
          <Segmented label="チャートの期間" value={win} onChange={onWin} options={WINDOWS} />
          <LineChart unit="¥"
            dates={d.dates}
            days={Number(win)}
            height={160}
            refLine={{ price: p.avg, label: '取得' }}
            series={[
              { label: shortName(s.name), values: s.series, kind: 'main' },
              ...(sector ? [{ label: `${s.sector}平均`, values: sector.series, kind: 'sector' as const }] : []),
              { label: '日経平均', values: d.market.n225.series, kind: 'market' },
            ]}
          />
          <div className="btn-row">
            <button type="button" className="btn" onClick={() => nav.open({ kind: 'stock', code: p.code })}>
              銘柄の詳細
            </button>
            <button type="button" className="btn" onClick={() => nav.open({ kind: 'trades', code: p.code, name: s.name })}>
              取引の記録
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/* 配分の円グラフ。色は検証済みの 6 色（隣どうしが色覚の違いでも見分けられる）＋「その他」は灰色 */
const SLICE = ['var(--c1)', 'var(--c2)', 'var(--c3)', 'var(--c4)', 'var(--c5)', 'var(--c6)'];

function Allocation({ rows }: { rows: HoldRow[] }) {
  const [by, setBy] = useState<'stock' | 'sector'>('stock');
  const [hi, setHi] = useState<number | null>(null);
  const total = rows.reduce((a, r) => a + r.val, 0);
  const groups = new Map<string, number>();
  for (const r of rows) {
    const k = by === 'stock' ? r.s.name : r.s.sector;
    groups.set(k, (groups.get(k) ?? 0) + r.val);
  }
  let parts = [...groups.entries()].map(([name, v]) => ({ name, v })).sort((a, b) => b.v - a.v);
  if (parts.length > 6) {
    const rest = parts.slice(5).reduce((a, x) => a + x.v, 0);
    parts = [...parts.slice(0, 5), { name: `その他 ${groups.size - 5}`, v: rest }];
  }
  const R = 70;
  const r0 = 46;
  let acc = 0;
  const arcs = parts.map((x, i) => {
    const a0 = (acc / total) * Math.PI * 2;
    acc += x.v;
    const a1 = (acc / total) * Math.PI * 2;
    return { ...x, a0, a1, color: x.name.startsWith('その他') ? 'var(--muted)' : SLICE[i] };
  });
  const pt = (a: number, rad: number) => [80 + rad * Math.sin(a), 80 - rad * Math.cos(a)];
  const path = (a0: number, a1: number) => {
    if (a1 - a0 >= Math.PI * 2 - 1e-6) a1 = a0 + Math.PI * 2 - 1e-4;
    const big = a1 - a0 > Math.PI ? 1 : 0;
    const [x0, y0] = pt(a0, R);
    const [x1, y1] = pt(a1, R);
    const [x2, y2] = pt(a1, r0);
    const [x3, y3] = pt(a0, r0);
    return `M${x0},${y0}A${R},${R} 0 ${big} 1 ${x1},${y1}L${x2},${y2}A${r0},${r0} 0 ${big} 0 ${x3},${y3}Z`;
  };
  const sel = hi != null ? arcs[hi] : null;
  return (
    <Card
      title="配分"
      action={
        <Segmented
          label="配分の分け方"
          value={by}
          onChange={(v) => {
            setBy(v);
            setHi(null);
          }}
          options={[
            ['stock', '銘柄'],
            ['sector', 'セクター'],
          ]}
        />
      }
    >
      <div className="alloc">
        <svg viewBox="0 0 160 160" className="donut" role="img" aria-label={`${by === 'stock' ? '銘柄' : 'セクター'}ごとの評価額の配分`}>
          {arcs.map((x, i) => (
            <path
              key={x.name}
              d={path(x.a0, x.a1)}
              fill={x.color}
              className="slice"
              data-dim={hi != null && hi !== i}
              onClick={() => setHi(hi === i ? null : i)}
            />
          ))}
          <text x="80" y="76" className="donut-k" textAnchor="middle">
            {sel ? sel.name.slice(0, 8) : '評価額'}
          </text>
          <text x="80" y="94" className="donut-v" textAnchor="middle">
            {sel ? `${Math.round((sel.v / total) * 100)}%` : `¥${Math.round(total / 10000).toLocaleString('ja-JP')}万`}
          </text>
        </svg>
        <ul className="alloc-list">
          {arcs.map((x, i) => (
            <li key={x.name} data-dim={hi != null && hi !== i} onClick={() => setHi(hi === i ? null : i)}>
              <i style={{ background: x.color }} aria-hidden />
              <span className="nm">{x.name}</span>
              <span className="num pc">{((x.v / total) * 100).toFixed(1)}%</span>
            </li>
          ))}
        </ul>
      </div>
    </Card>
  );
}

function NoPriceRow({ p, nav }: { p: Position; nav: Nav }) {
  return (
    <>
      <button type="button" className="row" onClick={() => nav.open({ kind: 'trades', code: p.code, name: p.name })}>
        <span className="row-main">
          <span className="row-title">{p.name}</span>
          <span className="row-sub">
            <span className="num">{p.code || 'コード不明'}</span>
            <span className="num">{p.qty.toLocaleString('ja-JP')}株</span>
            <span className="num">平均 ¥{yen(p.avg, 0)}</span>
          </span>
        </span>
        <span className="row-side muted small">株価なし</span>
      </button>
    </>
  );
}

function CsvImport() {
  const input = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<{ rows: ParsedTrade[]; dup: number } | null>(null);
  const [msg, setMsg] = useState('');

  const onFile = async (f: File | undefined) => {
    if (!f) return;
    setMsg('');
    try {
      const rows = parseRakutenCsv(decodeCsv(await f.arrayBuffer()), await loadCodes());
      const have = new Set((await db.trades.toArray()).map((t) => t.key));
      const fresh = rows.filter((r) => !have.has(r.trade.key));
      setPreview({ rows: fresh, dup: rows.length - fresh.length });
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      if (input.current) input.current.value = '';
    }
  };

  const save = async () => {
    if (!preview) return;
    try {
      await db.trades.bulkAdd(preview.rows.map(toTrade));
      setMsg(`${preview.rows.length} 件を取り込みました`);
    } catch (e) {
      setMsg(`取り込みに失敗しました: ${e instanceof Error ? e.message : String(e)}`);
    }
    setPreview(null);
  };

  return (
    <Card title="楽天証券の取引履歴を取り込む">
      <p className="muted small">
        楽天証券のアプリ／サイトの「取引履歴」から CSV をダウンロードして選ぶ。国内株式の購入・売却だけを取り込み、
        投信・配当・入出金は無視する。同じ取引は 2 回入らない。
      </p>
      <input ref={input} type="file" accept=".csv,text/csv" hidden onChange={(e) => void onFile(e.target.files?.[0])} />
      <button type="button" className="btn" onClick={() => input.current?.click()}>
        CSV を選ぶ
      </button>
      {msg && <p className="small">{msg}</p>}
      {preview && (
        <div className="preview">
          <p className="small">
            新しい取引 {preview.rows.length} 件{preview.dup > 0 && `（取り込み済みの ${preview.dup} 件は除外）`}
          </p>
          {preview.rows.some((r) => r.unresolved) && (
            <p className="warn-text small">
              銘柄コードが分からないものがあります（{preview.rows.filter((r) => r.unresolved).map((r) => r.trade.name).join('、')}）。
              取り込んだあと、取引の記録画面で直せます。
            </p>
          )}
          <ul className="preview-list small">
            {preview.rows.slice(0, 8).map((r) => (
              <li key={r.trade.key}>
                {r.trade.date} {r.trade.side === 'buy' ? '買' : '売'} {r.trade.name}（{r.trade.code || '?'}）{yen(r.trade.price, 1)}円 × {r.trade.qty}
              </li>
            ))}
            {preview.rows.length > 8 && <li>…ほか {preview.rows.length - 8} 件</li>}
          </ul>
          <div className="btn-row">
            <button type="button" className="btn primary" onClick={() => void save()} disabled={!preview.rows.length}>
              取り込む
            </button>
            <button type="button" className="btn" onClick={() => setPreview(null)}>
              やめる
            </button>
          </div>
        </div>
      )}
    </Card>
  );
}
