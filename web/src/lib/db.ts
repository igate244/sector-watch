import Dexie, { type Table } from 'dexie';

/**
 * 端末内のデータ（保有株の記録）。外には送らない。
 * スキーマを変えるときは version(n) を書き換えず、新しい version を追記する。
 */

export type Side = 'buy' | 'sell';

export interface Trade {
  id: string;
  /** 約定日 YYYY-MM-DD */
  date: string;
  code: string;
  name: string;
  side: Side;
  /** 1 株あたりの約定単価（円） */
  price: number;
  qty: number;
  /** NISA成長投資枠 / 特定 / 一般 など。記録用で計算には使わない */
  account: string;
  memo: string;
  /** 'manual' | 'rakuten-csv' */
  source: string;
  /** 取り込みの重複判定用。日付・名前・売買・単価・株数 */
  key: string;
  createdAt: number;
}

class SectorWatchDB extends Dexie {
  trades!: Table<Trade, string>;

  constructor() {
    super('sector-watch');
    this.version(1).stores({
      trades: 'id, date, code, &key',
    });
  }
}

export const db = new SectorWatchDB();

export function tradeKey(t: Pick<Trade, 'date' | 'name' | 'side' | 'price' | 'qty'>): string {
  return [t.date, t.name.replace(/\s/g, ''), t.side, t.price, t.qty].join('|');
}

export function newId(): string {
  return crypto.randomUUID();
}

/* ------------------------------------------------------------------ 書き出し・読み込み */

export interface Backup {
  app: 'sector-watch';
  version: 1;
  exportedAt: string;
  trades: Trade[];
}

export async function exportAll(): Promise<Backup> {
  return { app: 'sector-watch', version: 1, exportedAt: new Date().toISOString(), trades: await db.trades.toArray() };
}

/** 復元。mode='merge' は足りないものだけ足す。'replace' は全部入れ替える */
export async function importAll(data: unknown, mode: 'merge' | 'replace'): Promise<number> {
  const b = data as Partial<Backup>;
  if (b?.app !== 'sector-watch' || !Array.isArray(b.trades)) throw new Error('このアプリのバックアップではありません');
  const trades = b.trades;
  return db.transaction('rw', db.trades, async () => {
    if (mode === 'replace') {
      await db.trades.clear();
      await db.trades.bulkAdd(trades);
      return trades.length;
    }
    const have = new Set((await db.trades.toArray()).map((t) => t.key));
    const add = trades.filter((t) => !have.has(t.key));
    await db.trades.bulkAdd(add);
    return add.length;
  });
}
