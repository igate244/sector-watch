import type { Trade } from './db';

export interface Position {
  code: string;
  name: string;
  qty: number;
  /** 平均取得単価（移動平均法） */
  avg: number;
  cost: number;
  /** 売却で確定した損益（手数料・税は含まない） */
  realized: number;
  firstBuy: string;
  lastTrade: string;
  trades: Trade[];
}

/**
 * 取引の記録から、銘柄ごとの保有を計算する。
 * 平均取得単価は移動平均法（買うたびに平均し直し、売っても単価は変えない）。
 * 記録が売りから始まる（取り込んだ期間より前に買っていた）場合は、その売りを無視する。
 */
export function positions(trades: Trade[]): Position[] {
  const byCode = new Map<string, Trade[]>();
  for (const t of trades) {
    const k = t.code || `name:${t.name}`;
    const list = byCode.get(k) ?? [];
    list.push(t);
    byCode.set(k, list);
  }
  const out: Position[] = [];
  for (const [, list] of byCode) {
    list.sort((a, b) => a.date.localeCompare(b.date) || (a.side === 'buy' ? -1 : 1));
    let qty = 0;
    let avg = 0;
    let realized = 0;
    let firstBuy = '';
    for (const t of list) {
      if (t.side === 'buy') {
        if (qty === 0) firstBuy = t.date;
        avg = (avg * qty + t.price * t.qty) / (qty + t.qty);
        qty += t.qty;
      } else {
        const q = Math.min(qty, t.qty);
        realized += (t.price - avg) * q;
        qty -= q;
        if (qty === 0) avg = 0;
      }
    }
    const last = list[list.length - 1];
    out.push({
      code: last.code,
      name: last.name,
      qty,
      avg,
      cost: avg * qty,
      realized,
      firstBuy,
      lastTrade: last.date,
      trades: list,
    });
  }
  return out.sort((a, b) => b.cost - a.cost || b.lastTrade.localeCompare(a.lastTrade));
}
