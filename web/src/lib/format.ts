import type { Horizon, SignalLabel } from './data';

export const HORIZON_LABEL: Record<Horizon, string> = { '1': '1日', '5': '5日', '20': '20日', '60': '60日' };

export const SIGNAL_LABEL: Record<SignalLabel, string> = {
  buy: '買い候補',
  caution: '要注意',
  watch: '様子見',
  none: '',
};

/** 騰落率。符号と ▲▼ を必ず付ける（色だけで上下を伝えない） */
export function pct(x: number | null | undefined, digits = 1): string {
  if (x == null || Number.isNaN(x)) return '—';
  const v = x * 100;
  if (Math.abs(v) < 0.05 && digits <= 1) return '±0.0%';
  return `${v > 0 ? '▲' : '▼'}${Math.abs(v).toFixed(digits)}%`;
}

/** 符号つき（▲▼なし）。要因分解の細かい数字に使う */
export function signed(x: number | null | undefined, digits = 1): string {
  if (x == null || Number.isNaN(x)) return '—';
  const v = x * 100;
  return `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(digits)}%`;
}

/** 上昇・下落の向き。CSS の data-dir に使う */
export function dir(x: number | null | undefined): 'up' | 'down' | 'flat' {
  if (x == null || Math.abs(x) < 0.0005) return 'flat';
  return x > 0 ? 'up' : 'down';
}

export function yen(x: number | null | undefined, digits = 0): string {
  if (x == null || Number.isNaN(x)) return '—';
  return x.toLocaleString('ja-JP', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export function signedYen(x: number): string {
  return `${x >= 0 ? '+' : '−'}${Math.abs(Math.round(x)).toLocaleString('ja-JP')}`;
}

const WD = ['日', '月', '火', '水', '木', '金', '土'];

export function dateJa(iso: string): string {
  const d = new Date(`${iso.slice(0, 10)}T00:00:00+09:00`);
  return `${d.getMonth() + 1}/${d.getDate()}(${WD[d.getDay()]})`;
}

export function timeJa(iso: string): string {
  const m = iso.match(/T(\d{2}):(\d{2})/);
  return m ? `${m[1]}:${m[2]}` : '';
}

/** 終値の日付が今日から何営業日前か（土日だけ考慮。祝日は考えない） */
export function businessDaysSince(iso: string, now = new Date()): number {
  const d = new Date(`${iso}T15:30:00+09:00`);
  let n = 0;
  const cur = new Date(d);
  while (cur < now) {
    cur.setDate(cur.getDate() + 1);
    if (cur > now) break;
    const wd = cur.getDay();
    if (wd !== 0 && wd !== 6) n++;
  }
  return n;
}
