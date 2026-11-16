import { useCallback, useEffect, useState } from 'react';

/* ------------------------------------------------------------------ 型（pipeline/run.py の出力と対応） */

export type Horizon = '1' | '5' | '20' | '60';
export const HORIZONS: Horizon[] = ['1', '5', '20', '60'];

export interface Dec {
  r: number;
  m: number;
  s: number;
  i?: number;
}

export type SignalLabel = 'buy' | 'caution' | 'watch' | 'none';

export interface Source {
  title: string;
  url: string;
  date?: string;
}

export interface News {
  by: 'gemini' | 'rss';
  asof?: string;
  bad_news: boolean | null;
  summary: string;
  factors: string[];
  sources: Source[];
}

export interface Stock {
  code: string;
  name: string;
  sector: string;
  memo: string;
  last: number;
  asof: string;
  dec: Record<Horizon, Dec | null>;
  beta: number;
  dd60: number | null;
  pos1y: number | null;
  z20: number | null;
  signal: { label: SignalLabel; reason: string };
  news?: News | null;
  series: (number | null)[];
}

export interface Sector {
  name: string;
  beta: number;
  dec: Record<Horizon, Dec | null>;
  codes: string[];
  series: (number | null)[];
}

export interface MarketBlock {
  name: string;
  last: number | null;
  ret: Record<Horizon, number | null>;
  series: (number | null)[];
}

export interface Latest {
  generated_at: string;
  asof: string;
  dates: string[];
  market: { n225: MarketBlock; topix: MarketBlock | null };
  sectors: Sector[];
  stocks: Stock[];
  market_comment: { asof: string; text: string; sources: Source[] } | null;
  watchlist: { source: 'sheet' | 'fallback'; edit_url: string | null; notes: string[] };
  run: { workflow_url: string | null; gemini_calls: number; gemini_errors: string[]; elapsed_sec: number };
}

/* ------------------------------------------------------------------ 読み込み */

const url = (name: string) => `${import.meta.env.BASE_URL}data/${name}`;

export interface DataState {
  data: Latest | null;
  error: string | null;
  loading: boolean;
  /** ネットに繋がらず、前回キャッシュした結果を出している */
  offline: boolean;
  reload: () => void;
}

export function useLatest(): DataState {
  const [data, setData] = useState<Latest | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [offline, setOffline] = useState(!navigator.onLine);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(url('latest.json'), { cache: 'no-cache' });
      if (!res.ok) throw new Error(`計算結果を読めませんでした（${res.status}）`);
      setData((await res.json()) as Latest);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setOffline(!navigator.onLine);
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    // 画面に戻ってきたとき、前回の取得から 10 分以上たっていれば取り直す
    let last = Date.now();
    const onVis = () => {
      if (document.visibilityState === 'visible' && Date.now() - last > 10 * 60_000) {
        last = Date.now();
        void load();
      }
    };
    const onNet = () => setOffline(!navigator.onLine);
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('online', onNet);
    window.addEventListener('offline', onNet);
    return () => {
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('online', onNet);
      window.removeEventListener('offline', onNet);
    };
  }, [load]);

  return { data, error, loading, offline, reload: () => void load() };
}

let codesCache: Promise<[string, string][]> | null = null;

/** 銘柄コードと名前の対応（JPX の上場銘柄一覧）。CSV 取り込みと手入力の補完に使う */
export function loadCodes(): Promise<[string, string][]> {
  codesCache ??= fetch(url('codes.json'))
    .then((r) => (r.ok ? (r.json() as Promise<[string, string][]>) : []))
    .catch(() => []);
  return codesCache;
}

/* ------------------------------------------------------------------ 補助 */

export function stockByCode(d: Latest): Map<string, Stock> {
  return new Map(d.stocks.map((s) => [s.code, s]));
}

/** 期間 h の騰落率を、系列の末尾から計算する（チャートの表示範囲用） */
export function windowStart(len: number, days: number): number {
  return Math.max(0, len - 1 - days);
}
