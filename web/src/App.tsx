import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useLatest, type Horizon } from './lib/data';
import { autoBackup } from './lib/drive';
import { HorizonPicker, Icon } from './components/ui';
import TodayScreen from './screens/TodayScreen';
import SectorsScreen from './screens/SectorsScreen';
import SectorDetail from './screens/SectorDetail';
import StockDetail from './screens/StockDetail';
import HoldingsScreen from './screens/HoldingsScreen';
import SettingsScreen from './screens/SettingsScreen';
import SignalsScreen from './screens/SignalsScreen';
import TradesSheet from './screens/TradesSheet';

type Tab = 'today' | 'signals' | 'sectors' | 'holdings';
export type SigKind = 'buy' | 'rise' | 'caution';

/** タブの上に重ねる画面。端末の戻るボタンで 1 段ずつ閉じる */
export type Overlay =
  | { kind: 'sector'; name: string }
  | { kind: 'stock'; code: string }
  | { kind: 'trades'; code: string; name: string; addNew?: boolean }
  | { kind: 'settings' };

export interface Nav {
  open: (o: Overlay) => void;
  back: () => void;
  /** 候補タブを、指定の種類で開く（今日の件数タイルから） */
  signals: (k: SigKind) => void;
}

const MARK = 'sector-watch-overlay';
const H_KEY = 'sw.horizon';

const TABS: [Tab, string][] = [
  ['today', '今日'],
  ['signals', '候補'],
  ['sectors', 'セクター'],
  ['holdings', '保有'],
];

/**
 * 指定の位置へスクロールする。スマホで慣性スクロール中にタップすると、
 * 1 回の scrollTo が慣性に負けて途中で止まるので、数回かけ直す（その間に指で動かしたらやめる）。
 */
function scrollToY(y: number) {
  const set = () => {
    window.scrollTo({ top: y, left: 0, behavior: 'instant' as ScrollBehavior });
    const el = document.scrollingElement;
    if (el) el.scrollTop = y;
  };
  let touched = false;
  const stop = () => (touched = true);
  window.addEventListener('touchstart', stop, { once: true, passive: true });
  window.addEventListener('wheel', stop, { once: true, passive: true });
  set();
  requestAnimationFrame(() => !touched && set());
  for (const ms of [60, 150, 300, 500]) setTimeout(() => !touched && set(), ms);
  setTimeout(() => {
    window.removeEventListener('touchstart', stop);
    window.removeEventListener('wheel', stop);
  }, 600);
}

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

  // 重ねた画面は一番上から開き、戻ったら元の位置に戻す
  const scrolls = useRef<number[]>([]);
  useEffect(() => {
    // ブラウザの自動のスクロール復元は切る（戻るボタンのとき位置がずれる）
    if ('scrollRestoration' in window.history) window.history.scrollRestoration = 'manual';
  }, []);
  const prevDepth = useRef(0);
  useLayoutEffect(() => {
    const depth = stack.length;
    if (depth > prevDepth.current) scrollToY(0);
    else if (depth < prevDepth.current) {
      let y = 0;
      while (scrolls.current.length > depth) y = scrolls.current.pop() ?? 0;
      scrollToY(y);
    }
    prevDepth.current = depth;
  }, [stack.length]);

  const open = useCallback((o: Overlay) => {
    scrolls.current.push(window.scrollY);
    setStack((s) => [...s, o]);
    window.history.pushState({ [MARK]: true }, '');
  }, []);

  const back = useCallback(() => {
    const st = window.history.state as Record<string, unknown> | null;
    if (st && st[MARK]) window.history.back();
    else setStack((s) => s.slice(0, -1));
  }, []);

  const [sig, setSig] = useState<SigKind>(() => {
    const v = localStorage.getItem('sw.sig');
    return v === 'rise' || v === 'caution' ? v : 'buy';
  });
  const changeSig = (k: SigKind) => {
    setSig(k);
    try {
      localStorage.setItem('sw.sig', k);
    } catch {
      /* 覚えられなくても切り替えはできる */
    }
  };

  const changeTab = (t: Tab) => {
    // 重ねた画面を閉じてからタブを切り替える（履歴も積んだ分だけ戻す）
    if (stack.length) {
      const n = stack.length;
      scrolls.current = [];
      setStack([]);
      window.history.go(-n);
    }
    setTab(t);
    scrollToY(0);
  };

  const nav: Nav = {
    open,
    back,
    signals: (k) => {
      changeSig(k);
      changeTab('signals');
    },
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
  else if (top?.kind === 'settings') body = <SettingsScreen state={state} nav={nav} />;
  else if (tab === 'today') body = <TodayScreen state={state} h={h} nav={nav} />;
  else if (tab === 'signals') body = <SignalsScreen state={state} nav={nav} kind={sig} onKind={changeSig} />;
  else if (tab === 'sectors') body = <SectorsScreen state={state} h={h} nav={nav} />;
  else body = <HoldingsScreen state={state} nav={nav} />;

  return (
    <div className="app">
      <main className="content" key={top ? `${top.kind}:${'code' in top ? top.code : 'name' in top ? top.name : ''}` : tab}>
        {body}
      </main>
      {showHorizon && (
        <div className="horizon-bar">
          <span className="hz-label">期間</span>
          <HorizonPicker value={h} onChange={changeH} />
        </div>
      )}
      <nav className="bottom-nav" aria-label="画面の切り替え">
        {TABS.map(([t, label]) => (
          <button
            key={t}
            type="button"
            aria-current={!top && tab === t ? 'page' : undefined}
            className={tab === t ? 'active' : ''}
            onClick={() => changeTab(t)}
          >
            <span aria-hidden className="nav-icon">
              <Icon name={t} />
            </span>
            {label}
          </button>
        ))}
      </nav>
    </div>
  );
}
