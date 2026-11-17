import { useState } from 'react';
import type { Nav } from '../App';
import { stockByCode, type DataState, type Latest, type Sector, type Stock } from '../lib/data';
import { dir, pct, signed } from '../lib/format';
import { useHeldCodes } from '../lib/useHoldings';
import MultiChart from '../components/MultiChart';
import RelChart from '../components/RelChart';
import { Freshness, HeatTable, Loading } from '../components/parts';
import { Card, Chg, Segmented, SettingsButton, SignalBadge, TopBar } from '../components/ui';
import { chartDays, PERIOD_LABEL, usePeriod, winRet, type Period } from '../lib/period';

/**
 * セクター: 1 行に「名前・日経比の小さなチャート・騰落率」を詰める。
 * 行を押すと、構成銘柄 10 本を 1 枚に重ねた大きなチャートと銘柄一覧が開く（選ぶと互いに強調）。
 */
export default function SectorsScreen({ state, nav }: { state: DataState; nav: Nav }) {
  const p = usePeriod();
  const [heat, setHeat] = useState(false);
  // 日経比（相対）か、株価そのものの動き（絶対）か。覚えておく
  const [mode, setModeState] = useState<'rel' | 'abs'>(() => (localStorage.getItem('sw.secMode') === 'abs' ? 'abs' : 'rel'));
  const setMode = (v: 'rel' | 'abs') => {
    setModeState(v);
    try {
      localStorage.setItem('sw.secMode', v);
    } catch {
      /* 覚えられなくても切り替えはできる */
    }
  };
  const [opened, setOpened] = useState<string | null>(null);
  const d = state.data;
  const days = Number(p);

  const m = d ? winRet(d.market.n225.series, days) : null;
  const rows = d
    ? d.sectors
        .map((s) => {
          const r = winRet(s.series, days);
          return { s, r, rel: r == null || m == null ? null : r - m };
        })
        .sort((a, b) => (mode === 'rel' ? (b.rel ?? -9) - (a.rel ?? -9) : (b.r ?? -9) - (a.r ?? -9)))
    : [];

  return (
    <>
      <TopBar title="セクター" right={<SettingsButton nav={nav} />} />
      <Freshness state={state} />
      <Loading state={state} />
      {d && (
        <>
          <Card>
            <div className="sec-switch">
              <Segmented
                label="チャートの見かた"
                value={mode}
                onChange={setMode}
                options={[
                  ['rel', '日経比'],
                  ['abs', '株価'],
                ]}
              />
              <span className="sec-n225">
                日経平均{' '}
                <span className="pct num" data-dir={dir(m)}>
                  {pct(m)}
                </span>{' '}
                <span className="muted">{PERIOD_LABEL[p]}</span>
              </span>
            </div>
            <div className="sec-head" aria-hidden>
              <span>{mode === 'rel' ? '日経平均より強い順' : '上がった順'}</span>
              <span>{mode === 'rel' ? '日経比の推移' : '株価の推移（破線＝日経）'}</span>
              <span>騰落率</span>
            </div>
            <p className="note" style={{ margin: '0 0 4px' }}>
              {mode === 'rel' ? '赤＝日経より強い、青＝弱い' : '赤＝期間の始めより上、青＝下。セクターは構成銘柄の平均'}
            </p>
            <div className="list">
              {rows.map(({ s, r, rel }) => (
                <SectorRow
                  key={s.name}
                  s={s}
                  r={r}
                  rel={rel}
                  d={d}
                  p={p}
                  mode={mode}
                  open={opened === s.name}
                  onToggle={() => setOpened(opened === s.name ? null : s.name)}
                  nav={nav}
                />
              ))}
            </div>
          </Card>

          <Card
            title="セクターの温度"
            action={
              <button type="button" className="link-btn" onClick={() => setHeat(!heat)}>
                {heat ? '閉じる' : '開く'}
              </button>
            }
          >
            {heat ? (
              <HeatTable d={d} onOpen={(name) => nav.open({ kind: 'sector', name })} />
            ) : (
              <p className="note" style={{ margin: 0 }}>
                全セクターの 1・5・20・60 日を色の濃さで一覧（日経平均との差）
              </p>
            )}
          </Card>
        </>
      )}
    </>
  );
}

function SectorRow({
  s,
  r,
  rel,
  d,
  p,
  mode,
  open,
  onToggle,
  nav,
}: {
  s: Sector;
  r: number | null;
  rel: number | null;
  d: Latest;
  p: Period;
  mode: 'rel' | 'abs';
  open: boolean;
  onToggle: () => void;
  nav: Nav;
}) {
  return (
    <div className="srow" data-open={open}>
      <button type="button" className="srow-main" onClick={onToggle} aria-expanded={open}>
        <span className="srow-name">
          <span className="row-title">{s.name}</span>
          <span className="srow-rel">
            日経比{' '}
            <b className="num" data-dir={dir(rel)}>
              {signed(rel)}
            </b>
          </span>
        </span>
        <RelChart values={s.series} market={d.market.n225.series} days={chartDays(p)} mode={mode} />
        <Chg v={r} />
      </button>
      {open && <SectorPanel s={s} d={d} p={p} nav={nav} />}
    </div>
  );
}

/** 開いたとき: 構成銘柄を 1 枚に重ねたチャートと、銘柄の一覧。どちらから選んでも同じ銘柄が強調される */
function SectorPanel({ s, d, p, nav }: { s: Sector; d: Latest; p: Period; nav: Nav }) {
  const days = Number(p);
  const [sel, setSel] = useState<string | null>(null);
  const held = useHeldCodes();
  const by = stockByCode(d);
  const members = s.codes.map((c) => by.get(c)).filter((x): x is Stock => !!x);
  const list = members.map((st) => ({ st, r: winRet(st.series, days) })).sort((a, b) => (b.r ?? -9) - (a.r ?? -9));
  return (
    <div className="srow-panel">
      <MultiChart
        dates={d.dates}
        days={chartDays(p)}
        lines={members.map((st) => ({ key: st.code, label: shortName(st.name), values: st.series }))}
        sector={s.series}
        market={d.market.n225.series}
        selected={sel}
        onSelect={setSel}
      />
      <div className="mlist">
        {list.map(({ st, r }) => (
          <div key={st.code} className="mitem" data-sel={sel === st.code} data-dim={sel != null && sel !== st.code}>
            <button type="button" className="mitem-pick" onClick={() => setSel(sel === st.code ? null : st.code)}>
              <span className="mitem-name">
                {shortName(st.name)}
                {held.has(st.code) && <span className="held-tag">保有</span>}
              </span>
              <SignalBadge label={st.signal.label} />
              <span className="pct num" data-dir={dir(r)}>
                {pct(r)}
              </span>
            </button>
            <button type="button" className="mitem-go" onClick={() => nav.open({ kind: 'stock', code: st.code })} aria-label={`${st.name}の詳細`}>
              ›
            </button>
          </div>
        ))}
      </div>
      <button type="button" className="link-btn block" onClick={() => nav.open({ kind: 'sector', name: s.name })}>
        {s.name}の内訳を詳しく見る
      </button>
    </div>
  );
}

export function shortName(name: string): string {
  const n = name
    .replace(/フィナンシャル・?グループ$/, '')
    .replace(/ホールディングス$/, 'HD')
    .replace(/グループ$/, 'G')
    .replace(/株式会社/g, '');
  return n.length > 8 ? n.slice(0, 7) + '…' : n;
}
