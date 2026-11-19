import { useState } from 'react';
import type { Nav } from '../App';
import type { Latest as Data, PickItem, PickView } from '../lib/data';
import { Card } from './ui';

const VIEW_CLASS: Record<PickView, string> = { 買い: 'badge-buy', 様子見: 'badge-watch', 見送り: 'badge-caution' };
const md = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;
const modelName = (m: string) => (m.includes('hydrogen') ? 'Hydrogen' : m.replace(/^gemini-/, ''));

function ViewTag({ v }: { v: PickView | null }) {
  if (!v) return <span className="badge badge-watch">不明</span>;
  return <span className={`badge ${VIEW_CLASS[v]}`}>{v}</span>;
}

function Conf({ n }: { n: number | null }) {
  if (!n) return null;
  return (
    <span className="pk-conf" aria-label={`自信 5 段階の ${n}`}>
      自信 {'●'.repeat(n)}
      <span className="pk-conf-off">{'●'.repeat(5 - n)}</span>
    </span>
  );
}

/** 買い候補の上位 10 を Gemini に 1 つずつ調べさせた見解と、その中のお勧め上位 3 */
export function PicksCard({ d, nav }: { d: Data; nav: Nav }) {
  const [open, setOpen] = useState(false);
  const pk = d.picks;
  if (!pk) {
    return (
      <Card title="Gemini の見立て">
        <p className="muted small">平日の夜（19:13）の計算で、買い候補の上位 10 銘柄（珍しい下げの順）を Gemini が 1 つずつ調べ、お勧めの上位 3 銘柄を選びます。</p>
      </Card>
    );
  }
  const by = new Map(pk.items.map((it) => [it.code, it]));
  const stale = pk.asof !== d.asof;
  return (
    <Card
      title="Gemini の見立て"
      action={
        <span className={`pk-when num${stale ? ' warn-text' : ''}`}>
          {md(pk.asof)} 夜・{modelName(pk.model)}
        </span>
      }
    >
      {stale && <p className="small warn-text">今日の分はまだです（夜 19:13 に更新）。{md(pk.asof)} 時点の見立てを表示中。</p>}
      {pk.top3.length ? (
        <ol className="pk-top">
          {pk.top3.map((t, i) => {
            const it = by.get(t.code);
            return (
              <li key={t.code}>
                <button type="button" className="pk-top-row" onClick={() => nav.open({ kind: 'stock', code: t.code })}>
                  <span className="pk-rank num">{i + 1}</span>
                  <span className="pk-main">
                    <span className="pk-name">
                      {it?.name ?? t.code}
                      <span className="muted num"> {t.code}</span>
                    </span>
                    <span className="pk-reason">{t.reason}</span>
                  </span>
                  <span className="pk-side">
                    <ViewTag v={it?.view ?? null} />
                    <span className="pk-go" aria-hidden>
                      ›
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
      ) : (
        <p className="muted small">お勧めできる銘柄は選ばれませんでした。</p>
      )}
      {pk.overall && <p className="pk-overall small">{pk.overall}</p>}

      <button type="button" className="link-btn block" onClick={() => setOpen(!open)}>
        {open ? '閉じる' : `${pk.items.length} 銘柄の見解をすべて見る`}
      </button>
      {open && (
        <div className="pk-all">
          {pk.items.map((it) => (
            <PickDetail key={it.code} it={it} onOpen={() => nav.open({ kind: 'stock', code: it.code })} />
          ))}
        </div>
      )}
      <p className="pk-note">AI（Gemini）が Google 検索をもとに書いた見解です。判断材料であって投資助言ではありません。</p>
    </Card>
  );
}

function PickDetail({ it, onOpen }: { it: PickItem; onOpen: () => void }) {
  return (
    <div className="pk-item">
      <button type="button" className="pk-item-head" onClick={onOpen}>
        <span className="pk-name">
          {it.name}
          <span className="muted num"> {it.code}</span>
        </span>
        <ViewTag v={it.view} />
      </button>
      <Conf n={it.conf} />
      <p className="pk-sum">{it.summary}</p>
      {!!it.reasons.length && (
        <ul className="pk-list">
          {it.reasons.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      )}
      {!!it.risks.length && (
        <ul className="pk-list pk-risk">
          {it.risks.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      )}
      {!!it.sources.length && (
        <p className="pk-src">
          {it.sources.map((s, i) => (
            <a key={i} href={s.url} target="_blank" rel="noreferrer">
              {s.title || '出典'}
            </a>
          ))}
        </p>
      )}
    </div>
  );
}
