import { useState } from 'react';
import type { Nav, SigKind } from '../App';
import type { DataState, Stock } from '../lib/data';
import { useHeldCodes } from '../lib/useHoldings';
import { Freshness, Loading, StockRow } from '../components/parts';
import { Card, Empty, Segmented, SettingsButton, TopBar } from '../components/ui';

/** 候補: 買い候補・初動候補・要注意を切り替えて 1 つずつ見る（今日の画面から分けた） */
export default function SignalsScreen({
  state,
  nav,
  kind,
  onKind,
}: {
  state: DataState;
  nav: Nav;
  kind: SigKind;
  onKind: (k: SigKind) => void;
}) {
  const held = useHeldCodes();
  const [all, setAll] = useState(false);
  const d = state.data;
  const n = (k: Stock['signal']['label']) => d?.stocks.filter((s) => s.signal.label === k).length ?? 0;

  const list = !d
    ? []
    : kind === 'rise'
      ? d.stocks
          .filter((s) => s.signal.label === 'rise')
          .sort((a, b) => (b.rise?.score ?? 0) - (a.rise?.score ?? 0) || (b.rise?.vol_ratio ?? 0) - (a.rise?.vol_ratio ?? 0))
      : d.stocks.filter((s) => s.signal.label === kind).sort((a, b) => (a.z20 ?? 0) - (b.z20 ?? 0));
  const FIRST = 15;
  const shown = all ? list : list.slice(0, FIRST);

  return (
    <>
      <TopBar title="候補" right={<SettingsButton nav={nav} />} />
      <Freshness state={state} />
      <Loading state={state} />
      {d && (
        <>
          <div className="chart-win">
            <Segmented
              label="候補の種類"
              value={kind}
              onChange={(k) => {
                onKind(k);
                setAll(false);
              }}
              options={[
                ['buy', `買い ${n('buy')}`],
                ['rise', `初動 ${n('rise')}`],
                ['caution', `要注意 ${n('caution')}`],
              ]}
            />
          </div>
          <Card>
            <p className="note">
              {kind === 'buy' && '20 日の下げの大半が、日経平均とセクター（業種）につられたもの。珍しい下げの順。'}
              {kind === 'rise' && '値幅が縮んだもみ合いのあと、60 日高値を抜けた銘柄。だましも多いので、抜けた高値を割ったら撤退が前提。'}
              {kind === 'caution' && '20 日の下げのうち、個別の分（その銘柄だけの理由）が大きいもの。悪材料に注意。'}
            </p>
            {!list.length ? (
              <Empty>今日は該当する銘柄がありません</Empty>
            ) : (
              <>
                <div className="list">
                  {shown.map((s) => (
                    <StockRow key={s.code} s={s} h="20" showSector held={held.has(s.code)} onOpen={() => nav.open({ kind: 'stock', code: s.code })} />
                  ))}
                </div>
                {list.length > FIRST && (
                  <button type="button" className="link-btn block" onClick={() => setAll(!all)}>
                    {all ? '閉じる' : `残り ${list.length - FIRST} 件を見る`}
                  </button>
                )}
              </>
            )}
          </Card>
        </>
      )}
    </>
  );
}
