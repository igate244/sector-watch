import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import type { Nav } from '../App';
import { askGemini, copyNow, toast } from '../lib/askGemini';
import { db } from '../lib/db';
import { type Latest, stockByCode } from '../lib/data';
import { dir, signedYen } from '../lib/format';
import { positions } from '../lib/holdings';
import { type Exit, type Group, promptForReview, tradeStats } from '../lib/tradeStats';
import { Card, Pct } from './ui';

const SIG: Record<string, string> = { buy: '買い候補', caution: '要注意', rise: '初動候補', watch: '様子見' };

function GroupTable({ title, gs }: { title: string; gs: Group[] }) {
  if (!gs.length) return null;
  return (
    <table className="ts-table">
      <caption>{title}</caption>
      <thead>
        <tr>
          <th />
          <th>回数</th>
          <th>勝率</th>
          <th>損益</th>
        </tr>
      </thead>
      <tbody>
        {gs.map((g) => (
          <tr key={g.label}>
            <th scope="row">{g.label}</th>
            <td className="num">{g.n}</td>
            <td className="num">{Math.round((g.wins / g.n) * 100)}%</td>
            <td className="num">
              <span className="pct" data-dir={dir(g.pl)}>
                {signedYen(g.pl)}
              </span>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** 売買の成績（勝率・損益・口座別・保有期間別）と、AI に分析してもらうボタン */
export function TradeStatsCard({ d, nav }: { d: Latest | null; nav: Nav }) {
  const trades = useLiveQuery(() => db.trades.toArray(), []);
  const [open, setOpen] = useState(false);
  if (!trades) return null;
  const s = tradeStats(trades);
  if (!s) return null;
  const by = d ? stockByCode(d) : new Map();

  const buildPrompt = () => {
    const held = positions(trades)
      .filter((p) => p.qty > 0)
      .map((p) => {
        const st = by.get(p.code);
        return {
          name: p.name,
          code: p.code,
          qty: p.qty,
          avg: p.avg,
          last: st?.last ?? null,
          firstBuy: p.firstBuy,
          signal: st && st.signal.label !== 'none' ? SIG[st.signal.label] : undefined,
          sector: st?.sector,
        };
      });
    return promptForReview(s, held, d?.asof ?? new Date().toISOString().slice(0, 10));
  };
  const best = [...s.exits].sort((a, b) => b.pl - a.pl).slice(0, 3);
  const worst = [...s.exits].sort((a, b) => a.pl - b.pl).slice(0, 3);

  return (
    <Card title="売買の成績">
      <div className="ts-kpi">
        <div>
          <div className="k">勝率</div>
          <div className="v num">{Math.round(s.winRate * 100)}%</div>
          <div className="sub num">
            {s.wins}勝{s.n - s.wins}敗
          </div>
        </div>
        <div>
          <div className="k">確定損益</div>
          <div className="v num">
            <span className="pct" data-dir={dir(s.pl)}>
              {signedYen(s.pl)}
            </span>
          </div>
          <div className="sub">円</div>
        </div>
        <div>
          <div className="k">利益÷損失</div>
          <div className="v num">{s.pf ? s.pf.toFixed(2) : '—'}</div>
          <div className="sub">1 超で勝ち越し</div>
        </div>
      </div>
      <div className="ts-avg num">
        平均の勝ち <span className="pct" data-dir="up">{signedYen(s.avgWin)}</span>・平均の負け{' '}
        <span className="pct" data-dir="down">{signedYen(s.avgLoss)}</span>・最大連敗 {s.maxLossStreak}
      </div>

      <div className="ts-ask">
        <button type="button" className="btn ask-pro" onClick={() => askGemini(buildPrompt())}>
          ✦ AI に成績を分析してもらう（Gemini）
        </button>
        <button
          type="button"
          className="link-btn"
          onClick={() => toast(copyNow(buildPrompt()) ? '質問をコピーしました。好きな AI に貼り付けてください' : 'コピーできませんでした')}
        >
          コピーだけ
        </button>
      </div>
      <p className="note">押したときだけ、成績と保有を質問文にしてコピーします（アプリから外には送りません）。</p>

      <button type="button" className="link-btn block" onClick={() => setOpen(!open)}>
        {open ? '閉じる' : '内訳を見る（口座・保有期間・年・大きな勝ち負け）'}
      </button>
      {open && (
        <div className="ts-detail">
          <GroupTable title="口座別" gs={s.byAccount} />
          <GroupTable title="持っていた期間別" gs={s.byHold} />
          <GroupTable title="年別" gs={s.byYear} />
          {s.topShare != null && s.topShare > 0.3 && (
            <p className="small warn-text">一番大きい勝ち 1 回で、利益全体の {Math.round(s.topShare * 100)}% を占めています。</p>
          )}
          <ExitList title="大きな勝ち" xs={best} nav={nav} />
          <ExitList title="大きな負け" xs={worst} nav={nav} />
          {s.deepLosses.length > 0 && (
            <p className="small muted">−10% より深い負けが {s.deepLosses.length} 回（{s.deepLosses.map((e) => e.name).join('、')}）。</p>
          )}
          <p className="note">平均取得単価は移動平均法。手数料・税は含みません。売るたびに 1 回と数えます。</p>
        </div>
      )}
    </Card>
  );
}

function ExitList({ title, xs, nav }: { title: string; xs: Exit[]; nav: Nav }) {
  return (
    <div className="ts-exits">
      <div className="ts-exits-t">{title}</div>
      {xs.map((e, i) => (
        <button key={i} type="button" className="ts-exit" onClick={() => e.code && nav.open({ kind: 'stock', code: e.code })}>
          <span className="ts-exit-n">
            {e.name}
            <span className="muted num"> {e.date.slice(2).replace(/-/g, '/')}・{e.days}日</span>
          </span>
          <span className="num">
            <Pct v={e.ret} />{' '}
            <span className="pct" data-dir={dir(e.pl)}>
              {signedYen(e.pl)}
            </span>
          </span>
        </button>
      ))}
    </div>
  );
}
