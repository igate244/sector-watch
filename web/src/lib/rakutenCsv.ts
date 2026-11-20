import { newId, tradeKey, type Side, type Trade } from './db';

/**
 * 楽天証券の取引履歴 CSV を読む。2 種類に対応する:
 *  1. 「取引履歴」（国内株式・投信などがまとめて入ったもの）: 取引区分が「株式購入」「株式売却」の行だけ
 *  2. 「国内株式の取引履歴」（tradehistoryJP_*.csv）: 売買区分が「買付」「売付」の現物の行だけ（信用は対象外）
 * 文字コードは Shift_JIS（UTF-8 で保存し直したものも読める）。
 *
 * この CSV は銘柄コード欄が「-」のことが多く、名前しか入っていない。
 * しかも全角・空白入り（「任　天　堂」「ＫＯＡ」）や途中で切れた名前（「サイバーステップホールディ」）がある。
 * そこで JPX の銘柄一覧（codes.json）と、正規化した名前の完全一致 → 前方一致の順で突き合わせる。
 */

export interface ParsedTrade {
  trade: Omit<Trade, 'id' | 'createdAt'>;
  /** コードが特定できなかった（手で直す必要がある） */
  unresolved: boolean;
}

export function normName(s: string): string {
  return s.normalize('NFKC').replace(/\s/g, '').toUpperCase();
}

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (c === '"') q = false;
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === ',') {
      out.push(cur);
      cur = '';
    } else cur += c;
  }
  out.push(cur);
  return out;
}

const num = (s: string) => Number(s.replace(/,/g, ''));
const isoDate = (s: string) => {
  const m = s.match(/(\d{4})\/(\d{1,2})\/(\d{1,2})/);
  return m ? `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}` : '';
};

export function decodeCsv(buf: ArrayBuffer): string {
  // UTF-8 として正しく読めるならそちらを使う（Excel で保存し直した場合など）
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf);
  } catch {
    return new TextDecoder('shift_jis').decode(buf);
  }
}

export function parseRakutenCsv(text: string, codes: [string, string][]): ParsedTrade[] {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) return [];
  const head = splitCsvLine(lines[0]).map((h) => h.trim());
  const col = (name: string) => head.findIndex((h) => h.startsWith(name));
  const iDate = col('約定日');
  const iKind = col('取引区分');
  const iAcct = col('口座区分');
  const iCode = col('銘柄コード');
  const iSide = col('売買区分'); // 国内株式の取引履歴だけにある
  const iCredit = col('信用区分');
  const jp = iSide >= 0;
  const iName = jp ? col('銘柄名') : col('対象証券');
  const iPrice = col('単価');
  const iQty = col('数量');
  if ([iDate, iName, iPrice, iQty].some((i) => i < 0) || (!jp && iKind < 0)) {
    throw new Error('楽天証券の取引履歴 CSV ではないようです（見出しが違います）');
  }

  const exact = new Map<string, string>();
  for (const [code, name] of codes) exact.set(normName(name), code);
  const findCode = (rawCode: string, name: string): string => {
    const c = rawCode.normalize('NFKC').trim().toUpperCase();
    if (/^[0-9][0-9A-Z]{3}$/.test(c)) return c;
    const n = normName(name);
    const hit = exact.get(n);
    if (hit) return hit;
    // 名前が途中で切れている場合: 一覧側がこの名前で始まる銘柄がちょうど 1 つなら採用
    const pre = codes.filter(([, nm]) => normName(nm).startsWith(n));
    return pre.length === 1 ? pre[0][0] : '';
  };

  const out: ParsedTrade[] = [];
  // 同じ日に同じ単価・株数の取引が 2 回あることがある（実例あり）。
  // ファイル内での出現順を key に入れて別物として扱う。同じファイルを再度取り込めば同じ key になる
  const seen = new Map<string, number>();
  for (const line of lines.slice(1)) {
    const c = splitCsvLine(line);
    let side: Side;
    if (jp) {
      // 国内株式の取引履歴: 売買区分で判断。信用取引（信用区分が「-」以外・取引区分に「信用」）は除く
      const s = c[iSide]?.trim();
      const credit = (iCredit >= 0 ? c[iCredit]?.trim() : '-') || '-';
      if (credit !== '-' || (c[iKind] ?? '').includes('信用')) continue;
      if (s === '買付') side = 'buy';
      else if (s === '売付') side = 'sell';
      else continue;
    } else {
      const kind = c[iKind]?.trim();
      if (kind === '株式購入') side = 'buy';
      else if (kind === '株式売却') side = 'sell';
      else continue;
    }
    const name = (c[iName] ?? '').normalize('NFKC').replace(/\s+/g, '').trim();
    const price = num(c[iPrice] ?? '');
    const qty = num(c[iQty] ?? '');
    const date = isoDate(c[iDate] ?? '');
    if (!name || !date || !(price > 0) || !(qty > 0)) continue;
    const code = findCode(iCode >= 0 ? c[iCode] ?? '' : '', name);
    const t = {
      date,
      code,
      name,
      side,
      price,
      qty,
      account: (iAcct >= 0 ? c[iAcct] : '')?.trim() ?? '',
      memo: '',
      source: 'rakuten-csv',
      key: '',
    };
    const base = tradeKey(t);
    const nth = (seen.get(base) ?? 0) + 1;
    seen.set(base, nth);
    t.key = nth === 1 ? base : `${base}#${nth}`;
    out.push({ trade: t, unresolved: !code });
  }
  return out;
}

/** 形式の違う CSV（名前の書き方が違う）で同じ取引を 2 回入れないための照合キー（コードが分かるときだけ） */
export function codeKey(t: Pick<Trade, 'date' | 'code' | 'side' | 'price' | 'qty'>): string | null {
  return t.code ? [t.date, t.code, t.side, t.price, t.qty].join('|') : null;
}

export function toTrade(p: ParsedTrade): Trade {
  return { ...p.trade, id: newId(), createdAt: Date.now() };
}
