"""判定の成績表（バックテスト）。

過去の毎日に、その日までの株価だけで今と同じ判定をやり直し、判定が「新しく出た日」から
5 日後・20 日後に日経平均より上がったか（日経比）を数える。

- 同じ銘柄が何日も続けて同じ判定のときは、最初の日だけ数える（同じ下げを何度も数えないため）
- ニュース（Gemini）で要注意に変わった分は、過去にさかのぼれないので入らない
- 比べる相手（基準）は「同じ日の監視銘柄すべて」の日経比
- 出力は data/track.json（成績タブを開いたときだけ読む）
"""
from __future__ import annotations

import time

import pandas as pd

from . import analysis

HORIZONS = (5, 20)
LABELS = ("buy", "rise", "caution", "watch")


def _stats(xs: list[float]) -> dict | None:
    if not xs:
        return None
    s = pd.Series(xs)
    return {"n": int(len(s)), "mean": round(float(s.mean()), 5), "median": round(float(s.median()), 5),
            "win": round(float((s > 0).mean()), 4)}


def backtest(rows: list[dict], closes: dict[str, pd.Series], market: pd.Series,
             volumes: dict[str, pd.Series] | None = None, days: int = 120) -> dict:
    t0 = time.time()
    idx = market.index
    names = {r["code"]: r["name"] for r in rows}
    sector = {r["code"]: r["sector"] for r in rows}
    px = analysis.align({c: s for c, s in closes.items()}, market)
    # その日の判定（code -> label）を日ごとに
    daily: list[tuple[pd.Timestamp, dict[str, str]]] = []
    for end in idx[-days:]:
        sl_c = {t: s[s.index <= end] for t, s in closes.items()}
        sl_v = {t: s[s.index <= end] for t, s in (volumes or {}).items()}
        res = analysis.analyze(rows, sl_c, market[market.index <= end], sl_v)
        daily.append((end, {st["code"]: st["signal"]["label"] for st in res["stocks"]}))

    pos = {d: i for i, d in enumerate(idx)}

    def fwd(code: str, d: pd.Timestamp, h: int) -> float | None:
        t = code + ".T"
        i = pos[d]
        if t not in px.columns or i + h >= len(idx):
            return None
        a, b = px[t].iloc[i], px[t].iloc[i + h]
        ma, mb = market.iloc[i], market.iloc[i + h]
        if pd.isna(a) or pd.isna(b):
            return None
        return float((b / a - 1) - (mb / ma - 1))

    hits: dict[str, dict[int, list[float]]] = {k: {h: [] for h in HORIZONS} for k in LABELS}
    base: dict[int, list[float]] = {h: [] for h in HORIZONS}
    events: list[dict] = []
    prev: dict[str, str] = {}
    for d, labels in daily:
        for code, lab in labels.items():
            for h in HORIZONS:
                f = fwd(code, d, h)
                if f is not None:
                    base[h].append(f)
            if lab in LABELS and prev.get(code) != lab:  # 新しく出た日だけ
                f5, f20 = fwd(code, d, 5), fwd(code, d, 20)
                for h, f in ((5, f5), (20, f20)):
                    if f is not None:
                        hits[lab][h].append(f)
                if lab != "watch":
                    events.append({"date": d.strftime("%Y-%m-%d"), "code": code, "name": names.get(code, code),
                                   "sector": sector.get(code, ""), "label": lab,
                                   "fwd5": None if f5 is None else round(f5, 4),
                                   "fwd20": None if f20 is None else round(f20, 4)})
        prev = labels

    out = {
        "asof": idx[-1].strftime("%Y-%m-%d"),
        "from": daily[0][0].strftime("%Y-%m-%d") if daily else None,
        "days": len(daily),
        "horizons": list(HORIZONS),
        "base": {str(h): _stats(base[h]) for h in HORIZONS},
        "signals": {k: {str(h): _stats(hits[k][h]) for h in HORIZONS} for k in LABELS},
        # 結果（5 日後）が出たものを新しい順に。結果待ちは件数だけ
        "recent": sorted((e for e in events if e["fwd5"] is not None), key=lambda e: e["date"], reverse=True)[:200],
        "pending": sum(1 for e in events if e["fwd5"] is None),
    }
    print(f"[track] {len(daily)} 日ぶんの判定をやり直しました（{time.time() - t0:.1f} 秒）")
    return out
