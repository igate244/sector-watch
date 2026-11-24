import type { Latest, PickView, Stock } from './data';

/**
 * 保有銘柄の「このまま持ってて大丈夫か」をアプリの数字だけで判定する（AI は呼ばない）。
 * ✋ 見直し: 取得から −10% より深い（損切りの目安）
 * ⚠ 注意: この銘柄だけの下げ・悪いニュース（要注意の判定）
 * ✓ 大丈夫: 下げは市場・業種につられたもの／上がり始め／目立った悪材料なし
 */
export type HoldLevel = 'ok' | 'warn' | 'review';

export interface HoldCheck {
  level: HoldLevel;
  icon: string;
  label: string;
  reason: string;
  /** 夜の「Gemini の見立て」にこの銘柄が入っていれば、その見解 */
  gemini: PickView | null;
}

export const STOP_LOSS = -0.1;

export function holdCheck(s: Stock, avg: number, d: Latest): HoldCheck {
  const r = avg ? s.last / avg - 1 : 0;
  const pick = d.picks?.items.find((x) => x.code === s.code);
  const gemini = pick?.view ?? null;
  if (r <= STOP_LOSS) {
    return {
      level: 'review',
      icon: '✋',
      label: '見直し',
      reason: `取得から ${(r * 100).toFixed(1)}%。損切りの目安（−10%）を超えています`,
      gemini,
    };
  }
  if (s.signal.label === 'caution') {
    return { level: 'warn', icon: '⚠', label: '注意', reason: s.signal.reason || 'この銘柄だけの理由で下げています', gemini };
  }
  const reason =
    s.signal.label === 'buy'
      ? '下げは市場・業種につられたもの。個別の悪材料は小さい'
      : s.signal.label === 'rise'
        ? '上がり始めの形'
        : '目立った悪材料なし';
  return { level: 'ok', icon: '✓', label: '大丈夫', reason, gemini };
}
