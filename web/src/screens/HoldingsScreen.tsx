import { useRef, useState } from 'react';
import type { Nav } from '../App';
import { loadCodes, stockByCode, type DataState } from '../lib/data';
import { db } from '../lib/db';
import { signedYen, yen } from '../lib/format';
import { decodeCsv, parseRakutenCsv, toTrade, type ParsedTrade } from '../lib/rakutenCsv';
import { usePositions } from '../lib/useHoldings';
import { Card, Empty, Pct, SignalBadge, TopBar } from '../components/ui';

export default function HoldingsScreen({ state, nav }: { state: DataState; nav: Nav }) {
  const positions = usePositions();
  const [showClosed, setShowClosed] = useState(false);
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
              <span className="pct" data-dir={value - cost >= 0 ? 'up' : 'down'}>
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

      <Card title={`保有中 ${open.length}`}>
        {!positions ? null : !open.length ? (
          <Empty>記録がありません。右上の「＋ 記録」か、下の CSV 取り込みから入れてください</Empty>
        ) : (
          <div className="list">
            {open.map((p) => {
              const s = by.get(p.code);
              const pnl = s ? s.last * p.qty - p.cost : null;
              return (
                <button
                  key={p.code || p.name}
                  type="button"
                  className="row"
                  onClick={() => (s ? nav.open({ kind: 'stock', code: p.code }) : nav.open({ kind: 'trades', code: p.code, name: p.name }))}
                >
                  <span className="row-main">
                    <span className="row-title">{s?.name ?? p.name}</span>
                    <span className="row-sub muted small">
                      {p.code || 'コード不明'} · {p.qty.toLocaleString('ja-JP')}株 · 平均 {yen(p.avg, 0)}円
                      {s && ` → ${s.last.toLocaleString('ja-JP')}円`}
                    </span>
                  </span>
                  <span className="row-side">
                    {pnl != null ? (
                      <>
                        <strong className="pct" data-dir={pnl >= 0 ? 'up' : 'down'}>
                          {signedYen(pnl)}
                        </strong>
                        <Pct v={s!.last / p.avg - 1} />
                      </>
                    ) : (
                      <span className="muted small">株価なし</span>
                    )}
                    {s && <SignalBadge label={s.signal.label} />}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </Card>

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
