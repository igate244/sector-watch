import type { Trade } from './db';

/**
 * 売買の成績（端末内で計算。外には送らない）。
 * 売るたびに 1 回の「決済」と数え、平均取得単価（移動平均法。保有の計算と同じ）との差で損益を出す。
 * 手数料・税は記録にないので含まない。記録が売りから始まる銘柄（それより前の買いがない）は数えない。
 */

export interface Exit {
  date: string;
  code: string;
  name: string;
  account: string;
  qty: number;
  buy: number;
  sell: number;
  pl: number;
  ret: number;
  /** 持っていた日数（買った日を株数で平均） */
  days: number;
}

export interface Group {
  label: string;
  n: number;
  wins: number;
  pl: number;
}

export interface TradeStats {
  exits: Exit[];
  n: number;
  wins: number;
  winRate: number;
  pl: number;
  avgWin: number;
  avgLoss: number;
  /** 利益の合計 ÷ 損失の合計（プロフィットファクター） */
  pf: number | null;
  /** 一番大きい勝ちが利益の合計に占める割合 */
  topShare: number | null;
  maxLossStreak: number;
  byAccount: Group[];
  byHold: Group[];
  byYear: Group[];
  /** -10% より深い負け */
  deepLosses: Exit[];
}

const dayNum = (s: string) => Date.parse(`${s}T00:00:00Z`) / 86400000;

export function exitsOf(trades: Trade[]): Exit[] {
  const byCode = new Map<string, Trade[]>();
  for (const t of trades) {
    const k = t.code || `name:${t.name}`;
    byCode.set(k, [...(byCode.get(k) ?? []), t]);
  }
  const out: Exit[] = [];
  for (const [, list] of byCode) {
    list.sort((a, b) => a.date.localeCompare(b.date) || (a.side === 'buy' ? -1 : 1));
    let qty = 0;
    let avg = 0;
    let avgDay = 0;
    for (const t of list) {
      if (t.side === 'buy') {
        avg = (avg * qty + t.price * t.qty) / (qty + t.qty);
        avgDay = (avgDay * qty + dayNum(t.date) * t.qty) / (qty + t.qty);
        qty += t.qty;
      } else {
        const q = Math.min(qty, t.qty);
        if (q <= 0) continue;
        out.push({
          date: t.date,
          code: t.code,
          name: t.name,
          account: t.account || list.find((x) => x.side === 'buy')?.account || '',
          qty: q,
          buy: avg,
          sell: t.price,
          pl: (t.price - avg) * q,
          ret: avg ? t.price / avg - 1 : 0,
          days: Math.max(0, Math.round(dayNum(t.date) - avgDay)),
        });
        qty -= q;
        if (qty === 0) {
          avg = 0;
          avgDay = 0;
        }
      }
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

function group(exits: Exit[], keyOf: (e: Exit) => string, order?: string[]): Group[] {
  const m = new Map<string, Group>();
  for (const e of exits) {
    const k = keyOf(e);
    const g = m.get(k) ?? { label: k, n: 0, wins: 0, pl: 0 };
    g.n++;
    if (e.pl > 0) g.wins++;
    g.pl += e.pl;
    m.set(k, g);
  }
  const gs = [...m.values()];
  return order ? order.flatMap((k) => (m.has(k) ? [m.get(k)!] : [])) : gs.sort((a, b) => a.label.localeCompare(b.label));
}

export const HOLD_BUCKETS = ['1週間以内', '1ヶ月以内', '半年以内', '半年超'];
const holdBucket = (d: number) => (d <= 7 ? HOLD_BUCKETS[0] : d <= 31 ? HOLD_BUCKETS[1] : d <= 183 ? HOLD_BUCKETS[2] : HOLD_BUCKETS[3]);
const acctLabel = (a: string) => (a.includes('NISA') ? 'NISA' : a ? a.replace(/口座$/, '') : '不明');

export function tradeStats(trades: Trade[]): TradeStats | null {
  const exits = exitsOf(trades);
  if (!exits.length) return null;
  const wins = exits.filter((e) => e.pl > 0);
  const losses = exits.filter((e) => e.pl <= 0);
  const sumW = wins.reduce((a, e) => a + e.pl, 0);
  const sumL = losses.reduce((a, e) => a + e.pl, 0);
  let streak = 0;
  let maxLossStreak = 0;
  for (const e of exits) {
    streak = e.pl <= 0 ? streak + 1 : 0;
    maxLossStreak = Math.max(maxLossStreak, streak);
  }
  return {
    exits,
    n: exits.length,
    wins: wins.length,
    winRate: wins.length / exits.length,
    pl: sumW + sumL,
    avgWin: wins.length ? sumW / wins.length : 0,
    avgLoss: losses.length ? sumL / losses.length : 0,
    pf: sumL < 0 ? sumW / -sumL : null,
    topShare: sumW > 0 ? Math.max(...wins.map((e) => e.pl)) / sumW : null,
    maxLossStreak,
    byAccount: group(exits, (e) => acctLabel(e.account)),
    byHold: group(exits, (e) => holdBucket(e.days), HOLD_BUCKETS),
    byYear: group(exits, (e) => `${e.date.slice(0, 4)}年`),
    deepLosses: exits.filter((e) => e.ret < -0.1).sort((a, b) => a.ret - b.ret),
  };
}

export interface HeldForPrompt {
  name: string;
  code: string;
  qty: number;
  avg: number;
  last: number | null;
  firstBuy: string;
  signal?: string;
  sector?: string;
}

const fmtY = (x: number) => `${x >= 0 ? '+' : '−'}${Math.round(Math.abs(x)).toLocaleString('ja-JP')}円`;
const fmtP = (x: number) => `${x >= 0 ? '+' : '−'}${(Math.abs(x) * 100).toFixed(1)}%`;

/** 自分の売買の成績と保有を AI に分析してもらう質問文。ボタンを押したときだけ作ってコピーする（外へは送らない） */
export function promptForReview(s: TradeStats, held: HeldForPrompt[], today: string): string {
  const g = (gs: Group[]) => gs.map((x) => `${x.label} ${x.n}回（${x.wins}勝）${fmtY(x.pl)}`).join('／');
  const lines = s.exits.map(
    (e) =>
      `${e.date} ${e.name}（${e.code || '?'}・${acctLabel(e.account)}） ${e.qty}株 取得${Math.round(e.buy).toLocaleString('ja-JP')}→売却${e.sell.toLocaleString('ja-JP')} ${fmtP(e.ret)} ${fmtY(e.pl)} 保有${e.days}日`,
  );
  const hl = held.map((h) => {
    const r = h.last ? h.last / h.avg - 1 : null;
    return `${h.name}（${h.code}${h.sector ? `・${h.sector}` : ''}） ${h.qty}株 取得${Math.round(h.avg).toLocaleString('ja-JP')}円 ${
      h.last ? `現在${h.last.toLocaleString('ja-JP')}円 ${fmtP(r!)}` : '現在値なし'
    } ${h.firstBuy}から保有${h.signal ? `・アプリの判定「${h.signal}」` : ''}`;
  });
  return [
    `あなたは日本株の個人投資家を指導してきたプロのトレーダー兼コーチです。${today} 時点の私の売買の記録を見て、成績を分析してください。`,
    '',
    '# 答え方',
    '- 最初に結論を 3 行で（私の売買の一番の強み・一番の弱み・明日から変えるべきこと 1 つ）',
    '- 次に、勝ちパターンと負けパターン（保有期間・口座・銘柄の種類・売り方の癖）を、下の数字を根拠に具体的に',
    '- 損切り・利確・資金配分について、私がそのまま使えるルールを 3〜5 個（数字入りで）',
    '- 今の保有銘柄それぞれについて、持ち続ける・減らす・損切りの目安を、最新のニュースや決算を検索して確かめたうえで一言ずつ',
    '- 投資助言ではなく判断材料として、率直に。耳の痛いことも遠慮なく',
    '',
    '# 成績のまとめ（平均取得単価は移動平均法・手数料と税は含まない）',
    `- 決済 ${s.n} 回、${s.wins} 勝 ${s.n - s.wins} 敗（勝率 ${(s.winRate * 100).toFixed(0)}%）、確定損益 ${fmtY(s.pl)}`,
    `- 平均の勝ち ${fmtY(s.avgWin)}、平均の負け ${fmtY(s.avgLoss)}、利益÷損失 ${s.pf ? s.pf.toFixed(2) : '—'}`,
    `- 一番大きい勝ちが利益全体に占める割合 ${s.topShare != null ? `${(s.topShare * 100).toFixed(0)}%` : '—'}、最大の連敗 ${s.maxLossStreak} 回`,
    `- 口座別: ${g(s.byAccount)}`,
    `- 保有期間別: ${g(s.byHold)}`,
    `- 年別: ${g(s.byYear)}`,
    '',
    '# 決済の一覧（古い順）',
    ...lines,
    '',
    '# いま保有している銘柄',
    ...(hl.length ? hl : ['なし']),
  ].join('\n');
}
