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

export type SignalLabel = 'buy' | 'caution' | 'rise' | 'watch' | 'none';

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
  /** Gemini が実際に Google 検索したか（古い結果には無い） */
  searched?: boolean;
  /** drop＝下げの悪材料を確認、rise＝上昇の好材料を確認（古い結果には無い＝drop） */
  kind?: 'drop' | 'rise';
  /** 初動候補の確認で「好材料あり」なら true */
  good_news?: boolean | null;
}

/** 初動候補の条件（pipeline/analysis.py の rise_check） */
export interface Rise {
  score: number;
  hits: string[];
  near_high: number | null;
  ext50: number | null;
  vol_ratio: number | null;
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
  signal: {
    label: SignalLabel;
    reason: string;
    /** 今の判定が始まった日（YYYY-MM-DD）と何日目か。capped はさかのぼれる限界（約半年）より前から */
    since?: string;
    days?: number;
    capped?: boolean;
  };
  rise?: Rise | null;
  /** 決算。next_est が true なら「前回＋約 3 ヶ月」の目安 */
  earnings?: { last?: string; next?: string; next_est?: boolean; kind?: string } | null;
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

/** 市場カードの分足。期間 '1' '5' '20' → 5 分足・15 分足・60 分足。先頭は前の日の最後の値 */
export interface Intraday {
  interval: string;
  t: string[];
  n225: (number | null)[] | null;
  topix: (number | null)[] | null;
}

/** 相場の予定（config/events.csv・SQ・決算発表予定日） */
export interface MarketEvent {
  date: string;
  time: string;
  region: string;
  /** 大 / 中 / 決算 */
  level: string;
  title: string;
  memo: string;
  kind: 'macro' | 'sq' | 'earnings';
  code?: string;
}

export interface Latest {
  generated_at: string;
  asof: string;
  dates: string[];
  market: { n225: MarketBlock; topix: MarketBlock | null; intraday?: Partial<Record<Horizon, Intraday>> };
  events?: MarketEvent[];
  sectors: Sector[];
  stocks: Stock[];
  market_comment: { asof: string; session?: 'midday' | 'close'; text: string; sources: Source[] } | null;
  /** midday＝昼の回（前場の途中経過）、close＝終値。古いデータには無い（＝終値） */
  session?: 'midday' | 'close';
  watchlist: { source: 'repo' | 'sheet' | 'fallback'; edit_url: string | null; notes: string[] };
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

/* ------------------------------------------------------------------ 銘柄ごとの分足（詳細を開いたときだけ読む） */

export interface StockIntradayBlock {
  interval: string;
  t: string[];
  stock: (number | null)[];
  /** セクター平均（前の日の終値＝100） */
  sector: (number | null)[] | null;
  n225: (number | null)[] | null;
}
export interface StockIntraday {
  asof: string;
  h: Partial<Record<Horizon, StockIntradayBlock>>;
}

export function useStockIntraday(code: string, asof: string | undefined): StockIntraday | null {
  const [v, setV] = useState<StockIntraday | null>(null);
  useEffect(() => {
    let alive = true;
    setV(null);
    if (!asof) return;
    fetch(url(`intraday/${code}.json?asof=${asof}`))
      .then((r) => (r.ok ? (r.json() as Promise<StockIntraday>) : null))
      .then((j) => alive && setV(j))
      .catch(() => alive && setV(null));
    return () => {
      alive = false;
    };
  }, [code, asof]);
  return v;
}

/* ------------------------------------------------------------------ 判定の成績表（成績タブを開いたときだけ読む） */

export interface TrackStat {
  n: number;
  mean: number;
  median: number;
  win: number;
}
export interface Track {
  asof: string;
  from: string | null;
  days: number;
  horizons: number[];
  base: Record<string, TrackStat | null>;
  signals: Record<'buy' | 'rise' | 'caution' | 'watch', Record<string, TrackStat | null>>;
  pending?: number;
  recent: { date: string; code: string; name: string; sector: string; label: SignalLabel; fwd5: number | null; fwd20: number | null }[];
}

export function useTrack(asof: string | undefined): Track | null | 'error' {
  const [v, setV] = useState<Track | null | 'error'>(null);
  useEffect(() => {
    let alive = true;
    if (!asof) return;
    fetch(url(`track.json?asof=${asof}`))
      .then((r) => (r.ok ? (r.json() as Promise<Track>) : Promise.reject()))
      .then((j) => alive && setV(j))
      .catch(() => alive && setV('error'));
    return () => {
      alive = false;
    };
  }, [asof]);
  return v;
}
