import type { Nav } from "../App";
import { stockByCode, type DataState, type Horizon } from "../lib/data";
import { dir, HORIZON_LABEL, signed } from "../lib/format";
import { Freshness, Loading } from "../components/parts";
import { Chg, TopBar } from "../components/ui";

export default function SectorsScreen({
  state,
  h,
  nav,
}: {
  state: DataState;
  h: Horizon;
  nav: Nav;
}) {
  const d = state.data;
  return (
    <>
      <TopBar title="セクター" />
      <Freshness state={state} />
      <Loading state={state} />
      {d && (
        <>
          <p className="note pad">
            {HORIZON_LABEL[h]}
            の騰落率が低い順。値は構成銘柄の平均。帯は日経平均との差（中央＝日経と同じ）。
          </p>
          {(() => {
            const byCode = stockByCode(d);
            const n225 = d.market.n225.ret[h];
            return [...d.sectors]
              .sort((a, b) => (a.dec[h]?.r ?? 0) - (b.dec[h]?.r ?? 0))
              .map((s) => {
                const dec = s.dec[h];
                const rel = dec && n225 != null ? dec.r - n225 : null;
                const w =
                  rel == null ? 0 : Math.min(50, (Math.abs(rel) / 0.15) * 50);
                return (
                  <button
                    key={s.name}
                    type="button"
                    className="card sector-card"
                    onClick={() => nav.open({ kind: "sector", name: s.name })}
                  >
                    <div className="sector-head">
                      <div>
                        <h3>{s.name}</h3>
                        <div className="sector-sub">
                          日経比 <span className="num">{signed(rel)}</span> ·
                          日経分 <span className="num">{signed(dec?.m)}</span> ·
                          業種固有 <span className="num">{signed(dec?.s)}</span>
                        </div>
                      </div>
                      <Chg v={dec?.r} />
                    </div>
                    <div className="rel-bar" aria-hidden>
                      <span
                        data-dir={dir(rel)}
                        style={{
                          width: `${w}%`,
                          [rel != null && rel >= 0 ? "left" : "right"]: "50%",
                        }}
                      />
                    </div>
                    <div className="chips">
                      {[...s.codes]
                        .sort(
                          (a, b) =>
                            (byCode.get(a)?.dec[h]?.r ?? 0) -
                            (byCode.get(b)?.dec[h]?.r ?? 0),
                        )
                        .map((c) => {
                          const st = byCode.get(c);
                          if (!st) return null;
                          const r = st.dec[h]?.r;
                          return (
                            <span key={c} className="chip" data-dir={dir(r)}>
                              <span className="nm">
                                {st.signal.label === "buy" && (
                                  <span
                                    className="sig sig-buy"
                                    aria-label="買い候補"
                                  >
                                    ◎
                                  </span>
                                )}
                                {st.signal.label === "caution" && (
                                  <span
                                    className="sig sig-caution"
                                    aria-label="要注意"
                                  >
                                    ⚠
                                  </span>
                                )}
                                {shortName(st.name)}
                              </span>
                              <strong>{signed(r)}</strong>
                            </span>
                          );
                        })}
                    </div>
                  </button>
                );
              });
          })()}
        </>
      )}
    </>
  );
}

export function shortName(name: string): string {
  const n = name
    .replace(/フィナンシャル・?グループ$/, "")
    .replace(/ホールディングス$/, "HD")
    .replace(/グループ$/, "G")
    .replace(/株式会社/g, "");
  return n.length > 8 ? n.slice(0, 7) + "…" : n;
}
