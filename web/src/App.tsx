import { useCallback, useEffect, useState } from 'react';
import { useLatest, type Horizon } from './lib/data';
import { autoBackup } from './lib/drive';
import { HorizonPicker } from './components/ui';
import TodayScreen from './screens/TodayScreen';
import SectorsScreen from './screens/SectorsScreen';
import SectorDetail from './screens/SectorDetail';
import StockDetail from './screens/StockDetail';
import HoldingsScreen from './screens/HoldingsScreen';
import SettingsScreen from './screens/SettingsScreen';
import TradesSheet from './screens/TradesSheet';

type Tab = 'today' | 'sectors' | 'holdings' | 'settings';

/** タブの上に重ねる画面。端末の戻るボタンで 1 段ずつ閉じる */
export type Overlay =
  | { kind: 'sector'; name: string }
  | { kind: 'stock'; code: string }
  | { kind: 'trades'; code: string; name: string; addNew?: boolean };

export interface Nav {
  open: (o: Overlay) => void;
  back: () => void;
}

const MARK = 'sector-watch-overlay';
const H_KEY = 'sw.horizon';

const TABS: [Tab, string, string][] = [
  ['today', '今日', '◉'],
  ['sectors', 'セクター', '▦'],
  ['holdings', '保有', '¥'],
  ['settings', '設定', '⚙'],
];

export default function App() {
  const state = useLatest();
  const [tab, setTab] = useState<Tab>('today');
  const [stack, setStack] = useState<Overlay[]>([]);
  const [h, setH] = useState<Horizon>(() => (localStorage.getItem(H_KEY) as Horizon) || '20');

  useEffect(() => {
    void autoBackup();
  }, []);

  useEffect(() => {
    const onPop = () => setStack((s) => s.slice(0, -1));
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const open = useCallback((o: Overlay) => {
    setStack((s) => [...s, o]);
    window.history.pushState({ [MARK]: true }, '');
  }, []);

  const back = useCallback(() => {
    const st = window.history.state as Record<string, unknown> | null;
    if (st && st[MARK]) window.history.back();
    else setStack((s) => s.slice(0, -1));
  }, []);

  const nav: Nav = { open, back };

  const changeTab = (t: Tab) => {
    // 重ねた画面を閉じてからタブを切り替える（履歴も積んだ分だけ戻す）
    if (stack.length) {
      const n = stack.length;
      setStack([]);
      window.history.go(-n);
    }
    setTab(t);
    window.scrollTo(0, 0);
  };

  const changeH = (v: Horizon) => {
    setH(v);
    localStorage.setItem(H_KEY, v);
  };

  const top = stack[stack.length - 1];
  const showHorizon = !top ? tab === 'today' || tab === 'sectors' : top.kind === 'sector';

  let body;
  if (top?.kind === 'sector') body = <SectorDetail state={state} name={top.name} h={h} nav={nav} />;
  else if (top?.kind === 'stock') body = <StockDetail state={state} code={top.code} nav={nav} />;
  else if (top?.kind === 'trades')
    body = <TradesSheet code={top.code} name={top.name} addNew={top.addNew} state={state} nav={nav} />;
  else if (tab === 'today') body = <TodayScreen state={state} h={h} nav={nav} />;
  else if (tab === 'sectors') body = <SectorsScreen state={state} h={h} nav={nav} />;
  else if (tab === 'holdings') body = <HoldingsScreen state={state} nav={nav} />;
  else body = <SettingsScreen state={state} />;

  return (
    <div className="app">
      <main className="content" key={top ? `${top.kind}:${'code' in top ? top.code : top.name}` : tab}>
        {body}
      </main>
      {showHorizon && (
        <div className="horizon-bar">
          <span className="muted small">期間</span>
          <HorizonPicker value={h} onChange={changeH} />
        </div>
      )}
      <nav className="bottom-nav" aria-label="画面の切り替え">
        {TABS.map(([t, label, icon]) => (
          <button
            key={t}
            type="button"
            aria-current={!top && tab === t ? 'page' : undefined}
            className={tab === t ? 'active' : ''}
            onClick={() => changeTab(t)}
          >
            <span aria-hidden className="nav-icon">
              {icon}
            </span>
            {label}
          </button>
        ))}
      </nav>
    </div>
  );
}
