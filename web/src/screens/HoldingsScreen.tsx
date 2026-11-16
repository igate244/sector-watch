import { useRef, useState } from 'react';
import type { Nav } from '../App';
import { loadCodes, stockByCode, type DataState } from '../lib/data';
import { db } from '../lib/db';
import { dir, signedYen, yen } from '../lib/format';
import { decodeCsv, parseRakutenCsv, toTrade, type ParsedTrade } from '../lib/rakutenCsv';
import { usePositions } from '../lib/useHoldings';
import { Card, Chg, Count, Empty, Pct, Segmented, SignalBadge, TopBar } from '../components/ui';
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

  return (
    <>
      <TopBar
        title="保有"
        right={
          <button type="button" className="link-btn" onClick={() => nav.open({ kind: 'trades', code: '', name: '', addNew: true })}>
            ＋ 記録
          </button>
        }
      />
      <Card>
        <div className="market-grid">
          <div>
            <div className="muted small">評価額</div>
            <div className="big">{yen(value)}円</div>
          </div>
          <div>
            <div className="muted small">評価損益</div>
            <div className="big">
              <span className="pct" data-dir={dir(cost ? value / cost - 1 : 0)}>
                {signedYen(value - cost)}
              </span>
            </div>
            <Pct v={cost ? value / cost - 1 : null} />
          </div>
        </div>
        <p className="muted small">
          記録した期間の確定損益 {signedYen(realized)} 円（手数料・税は含まない）
          {unpriced > 0 && <><br />銘柄リストにない {unpriced} 銘柄は株価がないため評価額に入っていません</>}
        </p>
      </Card>

      {d && open.some((p) => by.get(p.code)) && (
        <div className="chart-win">
          <span className="hz-label">チャート</span>
          <Segmented label="チャートの期間" value={win} onChange={changeWin} options={WINDOWS} />
        </div>
      )}

      {!positions ? null : !open.length ? (
        <Card title={<>保有中 <Count n={0} /></>}>
          <Empty>記録がありません。右上の「＋ 記録」か、下の CSV 取り込みから入れてください</Empty>
        </Card>
      ) : (
        <>
          <p className="note pad">
            チャートは期間の始めを 0% にそろえた銘柄（黒）・セクター平均（橙）・日経平均（破線）。緑の点線が平均取得単価。
          </p>
          {open.map((p) => {
            const s = by.get(p.code);
            if (!s || !d) return <NoPriceRow key={p.code || p.name} p={p} nav={nav} />;
            const pnl = s.last * p.qty - p.cost;
            const r = p.avg ? s.last / p.avg - 1 : null;
            const sector = d.sectors.find((x) => x.name === s.sector);
            const openIt = () => nav.open({ kind: 'stock', code: p.code });
            return (
              <section key={p.code} className="card hold-card">
                <button type="button" className="sector-open" onClick={openIt}>
                  <div className="sector-head">
                    <div style={{ minWidth: 0 }}>
                      <h3 className="row-title">{s.name}</h3>
                      <div className="row-sub">
                        <span className="num">{s.code}</span>
                        <span>{s.sector}</span>
                        <SignalBadge label={s.signal.label} />
                      </div>
                    </div>
                    <div className="hold-pnl">
                      <span className="yen" data-dir={dir(r)}>
                        {signedYen(pnl)}円
                      </span>
                      <Chg v={r} />
                    </div>
                  </div>
                  <div className="hold-meta">
                    <div>
                      <div className="k">株数</div>
                      <div className="v">{p.qty.toLocaleString('ja-JP')}</div>
                    </div>
                    <div>
                      <div className="k">平均取得</div>
                      <div className="v">¥{yen(p.avg, 0)}</div>
                    </div>
                    <div>
                      <div className="k">現在値・前日比</div>
                      <div className="v">
                        ¥{s.last.toLocaleString('ja-JP')} <Pct v={s.dec['1']?.r} />
                      </div>
                    </div>
                  </div>
                </button>
                <LineChart
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
              </section>
            );
          })}
        </>
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

function NoPriceRow({ p, nav }: { p: Position; nav: Nav }) {
  return (
    <section className="card">
      <button type="button" className="row" style={{ border: 0, padding: 0 }} onClick={() => nav.open({ kind: 'trades', code: p.code, name: p.name })}>
        <span className="row-main">
          <span className="row-title">{p.name}</span>
          <span className="row-sub">
            <span className="num">{p.code || 'コード不明'}</span>
            <span className="num">{p.qty.toLocaleString('ja-JP')}株</span>
            <span className="num">平均 ¥{yen(p.avg, 0)}</span>
          </span>
        </span>
        <span className="row-side muted small">株価なし（銘柄リスト外）</span>
      </button>
    </section>
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
