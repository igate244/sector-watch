import { createContext, useContext } from 'react';
import type { Dec, Horizon } from './data';

/**
 * アプリ全体で 1 つの「期間」。画面下（タブの上）のバーで切り替え、全画面が同じ期間で表示する。
 * - 値は営業日数（1ヶ月≒20、3ヶ月≒60、6ヶ月≒120、1年≒245）
 * - 内訳（日経・業種・個別）は計算側が 1・5・20・60 日だけなので、6ヶ月・1年は騰落率だけ
 * - チャートの足: 1日＝5分足、5日＝15分足、1ヶ月＝60分足（分足があれば）、3ヶ月〜＝日足
 */
export type Period = '1' | '5' | '20' | '60' | '120' | '245';

export const PERIODS: [Period, string][] = [
  ['1', '1日'],
  ['5', '5日'],
  ['20', '1ヶ月'],
  ['60', '3ヶ月'],
  ['120', '6ヶ月'],
  ['245', '1年'],
];
export const PERIOD_LABEL = Object.fromEntries(PERIODS) as Record<Period, string>;

const KEY = 'sw.period';
export function savedPeriod(): Period {
  try {
    const v = localStorage.getItem(KEY);
    if (v && PERIODS.some(([p]) => p === v)) return v as Period;
    // 前の版の保存値（1/5/20/60）を引き継ぐ
    const old = localStorage.getItem('sw.horizon');
    if (old && PERIODS.some(([p]) => p === old)) return old as Period;
  } catch {
    /* 読めなくても既定値で続ける */
  }
  return '20';
}
export function savePeriod(p: Period) {
  try {
    localStorage.setItem(KEY, p);
  } catch {
    /* 覚えられなくても切り替えはできる */
  }
}

export const PeriodContext = createContext<Period>('20');
export const usePeriod = () => useContext(PeriodContext);

/** 内訳が計算されている期間なら、その Horizon */
export function asHorizon(p: Period): Horizon | null {
  return p === '1' || p === '5' || p === '20' || p === '60' ? p : null;
}

/** 期間の始めからの騰落率（series の最後 ÷ 期間の始め − 1） */
export function winRet(series: (number | null)[], days: number): number | null {
  const n = series.length;
  const v = series.slice(Math.max(0, n - 1 - days));
  const a = v.find((x) => x != null);
  const b = [...v].reverse().find((x) => x != null);
  return a == null || b == null || v.length < 2 ? null : b / a - 1;
}

/** 内訳（6ヶ月・1年は null） */
export function decOf(x: { dec: Record<Horizon, Dec | null> }, p: Period): Dec | null {
  const h = asHorizon(p);
  return h ? x.dec[h] : null;
}

/** 騰落率。内訳があればその合計、なければ series から計算 */
export function retOf(x: { dec: Record<Horizon, Dec | null>; series: (number | null)[] }, p: Period): number | null {
  const d = decOf(x, p);
  return d ? d.r : winRet(x.series, Number(p));
}

/** 日足のチャートで見せる日数（1 日だけだと線にならないので最低 5 日） */
export const chartDays = (p: Period) => Math.max(5, Number(p));
