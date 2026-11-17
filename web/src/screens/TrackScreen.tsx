import { useState } from 'react';
import type { Nav } from '../App';
import { useTrack, type DataState, type TrackStat } from '../lib/data';
import { pct } from '../lib/format';
import { Freshness, Loading } from '../components/parts';
import { Card, Empty, Segmented, SettingsButton, SignalBadge, TopBar } from '../components/ui';

const ROWS: ['buy' | 'rise' | 'caution' | 'watch', string][] = [
  ['buy', '買い候補'],
  ['rise', '初動候補'],
  ['caution', '要注意'],
  ['watch', '様子見'],
];

/** 成績: 過去の毎日に今の判定をやり直し、判定が出た日から 5・20 日後に日経平均より上がったかを数える */
export default function TrackScreen({ state, nav }: { state: DataState; nav: Nav }) {
  const d = state.data;
  const t = useTrack(d?.asof);
  const [h, setH] = useState<'5' | '20'>('20');
  const [all, setAll] = useState(false);

  return (
    <>
      <TopBar title="成績" right={<SettingsButton nav={nav} />} />
      <Freshness state={state} />
      <Loading state={state} />
      {t === 'error' && (
        <Card>
          <Empty>成績表はまだできていません（次の計算から作られます）</Empty>
        </Card>
      )}
      {t && t !== 'error' && (
        <>
          <div className="chart-win">
            <Segmented
              label="何日後で見るか"
              value={h}
              onChange={setH}
              options={[
                ['5', '5 日後'],
                ['20', '20 日後'],
              ]}
            />
          </div>

          <Card title="判定ごとの成績">
            <p className="note">
              {t.from && `${Number(t.from.slice(5, 7))}/${Number(t.from.slice(8, 10))}`} からの {t.days} 営業日に今の判定をやり直し、判定が
              <strong>新しく出た日</strong>から {h} 日後に<strong>日経平均より上がったか</strong>を数えた。
            </p>
            <Scale rows={ROWS.map(([k, name]) => ({ name, k, s: t.signals[k]?.[h] ?? null }))} base={t.base[h]} />
            <div className="tr-table">
              <div className="tr-row tr-head">
                <span />
                <span>回数</span>
                <span>勝率</span>
                <span>平均</span>
                <span>真ん中</span>
              </div>
              {ROWS.map(([k, name]) => {
                const s = t.signals[k]?.[h];
                return <StatRow key={k} name={name} s={s ?? null} base={t.base[h]} />;
              })}
              <StatRow name="全銘柄（基準）" s={t.base[h]} base={null} isBase />
            </div>
            <p className="note" style={{ marginTop: 8 }}>
              勝率＝日経平均より上がった割合。平均・真ん中＝日経比（銘柄の騰落率 − 日経平均の騰落率）。
              基準より良ければ、その判定に意味がある可能性。回数が少ないうちは偶然の差が大きい。
            </p>
          </Card>

          <Card title="判定のその後（新しい順）" action={t.pending ? <span className="note" style={{ margin: 0 }}>結果待ち {t.pending} 件</span> : undefined}>
            <div className="tr-recent">
              <div className="tr-rrow tr-head">
                <span>日付・銘柄</span>
                <span>5日後</span>
                <span>20日後</span>
              </div>
              {(all ? t.recent : t.recent.slice(0, 12)).map((e) => (
                <button key={e.date + e.code + e.label} type="button" className="tr-rrow" onClick={() => nav.open({ kind: 'stock', code: e.code })}>
                  <span className="tr-name">
                    <span className="num muted">
                      {Number(e.date.slice(5, 7))}/{Number(e.date.slice(8, 10))}
                    </span>{' '}
                    {e.name}
                    <SignalBadge label={e.label} />
                  </span>
                  <Outcome v={e.fwd5} />
                  <Outcome v={e.fwd20} />
                </button>
              ))}
            </div>
            {t.recent.length > 12 && (
              <button type="button" className="link-btn block" onClick={() => setAll(!all)}>
                {all ? '閉じる' : `もっと見る（${t.recent.length} 件）`}
              </button>
            )}
          </Card>

          <p className="note pad">
            ※ ニュース（Gemini）で要注意に変わった分は、過去にさかのぼれないので入っていない。過去の成績は、これからも同じになるとは限らない。
          </p>
        </>
      )}
    </>
  );
}

function StatRow({ name, s, base, isBase }: { name: string; s: TrackStat | null; base: TrackStat | null; isBase?: boolean }) {
  if (!s)
    return (
      <div className="tr-row">
        <span className="tr-nm">{name}</span>
        <span className="muted">0</span>
        <span className="muted">—</span>
        <span className="muted">—</span>
        <span className="muted">—</span>
      </div>
    );
  const better = base ? s.win - base.win : 0;
  return (
    <div className="tr-row" data-base={isBase}>
      <span className="tr-nm">{name}</span>
      <span className="num">{s.n}</span>
      <span className="num">
        {Math.round(s.win * 100)}%
        {!isBase && base && (
          <small className="pct" data-dir={better > 0.02 ? 'up' : better < -0.02 ? 'down' : 'flat'}>
            {better >= 0 ? '+' : '−'}
            {Math.abs(Math.round(better * 100))}
          </small>
        )}
      </span>
      <span className="pct num" data-dir={s.mean > 0 ? 'up' : s.mean < 0 ? 'down' : 'flat'}>
        {pct(s.mean)}
      </span>
      <span className="pct num" data-dir={s.median > 0 ? 'up' : s.median < 0 ? 'down' : 'flat'}>
        {pct(s.median)}
      </span>
    </div>
  );
}

/** 勝率を横並びで比べる帯。50%（五分五分）と基準の位置に目印 */
function Scale({ rows, base }: { rows: { name: string; k: string; s: TrackStat | null }[]; base: TrackStat | null }) {
  return (
    <div className="tr-scale" role="img" aria-label="判定ごとの勝率">
      {rows.map((r) => (
        <div key={r.k} className="tr-srow">
          <span className="tr-snm">{r.name}</span>
          <span className="tr-track">
            <span className="tr-fill" data-k={r.k} style={{ width: `${Math.round((r.s?.win ?? 0) * 100)}%` }} />
            <i className="tr-mid" style={{ left: '50%' }} />
            {base && <i className="tr-base" style={{ left: `${Math.round(base.win * 100)}%` }} />}
          </span>
          <span className="num tr-sv">{r.s ? `${Math.round(r.s.win * 100)}%` : '—'}</span>
        </div>
      ))}
      <div className="tr-legend">
        <span>
          <i className="tr-base-key" />
          基準（全銘柄）{base ? ` ${Math.round(base.win * 100)}%` : ''}
        </span>
        <span>
          <i className="tr-mid-key" />
          五分五分（50%）
        </span>
      </div>
    </div>
  );
}

function Outcome({ v }: { v: number | null }) {
  if (v == null) return <span className="muted small tr-out">結果待ち</span>;
  return (
    <span className="pct num tr-out" data-dir={v > 0 ? 'up' : v < 0 ? 'down' : 'flat'}>
      {v > 0 ? '✓ ' : '✗ '}
      {pct(v)}
    </span>
  );
}

