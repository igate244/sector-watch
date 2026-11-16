import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useState } from 'react';
import type { Nav } from '../App';
import { loadCodes, type DataState } from '../lib/data';
import { db, newId, type Side, type Trade } from '../lib/db';
import { yen } from '../lib/format';
import { Card, Empty, TopBar } from '../components/ui';

/** 1 銘柄の取引の一覧と、記録の追加・修正・削除 */
export default function TradesSheet({
  code,
  name,
  addNew,
  state,
  nav,
}: {
  code: string;
  name: string;
  addNew?: boolean;
  state: DataState;
  nav: Nav;
}) {
  const trades = useLiveQuery(
    () => (code || name ? db.trades.filter((t) => (code ? t.code === code : t.name === name)).sortBy('date') : Promise.resolve([] as Trade[])),
    [code, name],
  );
  const [editing, setEditing] = useState<Trade | 'new' | null>(addNew ? 'new' : null);

  return (
    <>
      <TopBar title={name || '取引の記録'} onBack={nav.back} />
      {editing && (
        <TradeForm
          initial={editing === 'new' ? undefined : editing}
          code={code}
          name={name}
          state={state}
          onDone={() => (addNew && editing === 'new' && !trades?.length ? nav.back() : setEditing(null))}
        />
      )}
      {(code || name) && (
        <Card
          title={`取引 ${trades?.length ?? 0} 件`}
          action={
            !editing && (
              <button type="button" className="link-btn" onClick={() => setEditing('new')}>
                ＋ 追加
              </button>
            )
          }
        >
          {!trades?.length ? (
            <Empty>記録はありません</Empty>
          ) : (
            <div className="list">
              {[...trades].reverse().map((t) => (
                <button key={t.id} type="button" className="row" onClick={() => setEditing(t)}>
                  <span className="row-main">
                    <span className="row-title">
                      {t.side === 'buy' ? '買い' : '売り'} {t.qty.toLocaleString('ja-JP')}株 × {yen(t.price, 1)}円
                    </span>
                    <span className="row-sub muted small">
                      {t.date} · {t.account || '口座未設定'}
                      {t.memo && ` · ${t.memo}`}
                    </span>
                  </span>
                  <span className="row-side small muted">{t.code || 'コード不明'}</span>
                </button>
              ))}
            </div>
          )}
        </Card>
      )}
    </>
  );
}

const ACCOUNTS = ['NISA成長投資枠', '特定', '一般'];

function TradeForm({
  initial,
  code,
  name,
  state,
  onDone,
}: {
  initial?: Trade;
  code: string;
  name: string;
  state: DataState;
  onDone: () => void;
}) {
  const today = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
  const [f, setF] = useState({
    date: initial?.date ?? today,
    code: initial?.code ?? code,
    name: initial?.name ?? name,
    side: (initial?.side ?? 'buy') as Side,
    price: initial ? String(initial.price) : '',
    qty: initial ? String(initial.qty) : '100',
    account: initial?.account ?? '特定',
    memo: initial?.memo ?? '',
  });
  const [codes, setCodes] = useState<[string, string][]>([]);
  const [err, setErr] = useState('');

  useEffect(() => {
    void loadCodes().then(setCodes);
  }, []);

  // コードを入れたら名前を補う（銘柄リスト → JPX 一覧の順）
  const setCode = (v: string) => {
    const c = v.normalize('NFKC').toUpperCase().trim();
    const hit = state.data?.stocks.find((s) => s.code === c)?.name ?? codes.find(([k]) => k === c)?.[1];
    setF((x) => ({ ...x, code: c, name: hit ?? x.name }));
  };

  const save = async () => {
    const price = Number(f.price.replace(/,/g, ''));
    const qty = Number(f.qty.replace(/,/g, ''));
    if (!/^[0-9][0-9A-Z]{3}$/.test(f.code)) return setErr('銘柄コードは 4 桁で入れてください');
    if (!f.name) return setErr('銘柄名を入れてください');
    if (!(price > 0) || !(qty > 0)) return setErr('単価と株数を入れてください');
    const base = { date: f.date, code: f.code, name: f.name, side: f.side, price, qty, account: f.account, memo: f.memo };
    try {
      // key は取り込み時の重複判定用。直したときは元の key を保つ（同じ CSV を再度取り込んでも二重にならない）
      if (initial) await db.trades.update(initial.id, base);
      else {
        const id = newId();
        await db.trades.add({ ...base, key: `manual|${id}`, id, source: 'manual', createdAt: Date.now() });
      }
      onDone();
    } catch (e) {
      setErr(`保存できませんでした: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const remove = async () => {
    if (initial && window.confirm('この取引を消しますか？')) {
      await db.trades.delete(initial.id);
      onDone();
    }
  };

  return (
    <Card title={initial ? '取引を直す' : '取引を記録'}>
      <div className="form">
        <div className="seg-row">
          {(['buy', 'sell'] as Side[]).map((s) => (
            <label key={s} className={`seg ${f.side === s ? 'on' : ''}`}>
              <input type="radio" name="side" checked={f.side === s} onChange={() => setF({ ...f, side: s })} />
              {s === 'buy' ? '買い' : '売り'}
            </label>
          ))}
        </div>
        <label>
          約定日
          <input type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} />
        </label>
        <label>
          銘柄コード
          <input inputMode="text" autoCapitalize="characters" value={f.code} onChange={(e) => setCode(e.target.value)} placeholder="例: 6506" />
        </label>
        <label>
          銘柄名
          <input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
        </label>
        <div className="two">
          <label>
            単価（円）
            <input inputMode="decimal" value={f.price} onChange={(e) => setF({ ...f, price: e.target.value })} />
          </label>
          <label>
            株数
            <input inputMode="numeric" value={f.qty} onChange={(e) => setF({ ...f, qty: e.target.value })} />
          </label>
        </div>
        <label>
          口座
          <select value={f.account} onChange={(e) => setF({ ...f, account: e.target.value })}>
            {ACCOUNTS.map((a) => (
              <option key={a}>{a}</option>
            ))}
          </select>
        </label>
        <label>
          メモ
          <input value={f.memo} onChange={(e) => setF({ ...f, memo: e.target.value })} placeholder="買った理由など" />
        </label>
        {err && <p className="warn-text small">{err}</p>}
        <div className="btn-row">
          <button type="button" className="btn primary" onClick={() => void save()}>
            保存
          </button>
          <button type="button" className="btn" onClick={onDone}>
            やめる
          </button>
          {initial && (
            <button type="button" className="btn danger" onClick={() => void remove()}>
              削除
            </button>
          )}
        </div>
      </div>
    </Card>
  );
}
