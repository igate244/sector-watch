"""
要因分解と判定。考え方は docs/DESIGN.md の「6. 要因分解の計算」を参照。

  市場要因     M = β_i × R_日経
  セクター要因 S = R_セクター(i を除いた中央値) − β_セクター × R_日経
  個別要因     I = R_i − M − S
"""

from __future__ import annotations

import math

import numpy as np
import pandas as pd

# ---------------------------------------------------------------- 調整用の値
HORIZONS = (1, 5, 20, 60)   # 見る期間（営業日）
MAIN_H = 20                 # 判定に使う期間。数週間〜数ヶ月の保有を想定
BETA_WINDOW = 250           # β を求める日数（約 1 年）
BETA_MIN_DAYS = 60          # これより短いと β=1 とみなす

DROP_R20 = -0.06            # 20 日でこれ以下なら「下げている」
DROP_DD60 = -0.10           # 60 日高値からこれ以下でも「下げている」
COMMON_MAX = -0.03          # 買い候補: 市場＋セクター要因がこれ以下（つられて下げた）
IND_FLOOR_FOR_BUY = -0.04   # 買い候補: 個別要因がこれより浅い
IND_CAUTION = -0.05         # 要注意: 個別要因がこれ以下で、市場＋セクター要因より大きい
WATCH_R5 = -0.04            # 様子見: 5 日でこれ以下


def _f(x: float | None, nd: int = 4) -> float | None:
    if x is None or (isinstance(x, float) and (math.isnan(x) or math.isinf(x))):
        return None
    return round(float(x), nd)


def align(closes: dict[str, pd.Series], market: pd.Series) -> pd.DataFrame:
    """日経平均の営業日に揃える。売買のなかった日は前日の終値で埋める（最大 5 日）。"""
    idx = market.index
    return pd.DataFrame({t: s.reindex(idx).ffill(limit=5) for t, s in closes.items()}, index=idx)


def period_return(s: pd.Series, h: int) -> float | None:
    if len(s) <= h:
        return None
    a, b = s.iloc[-1 - h], s.iloc[-1]
    if pd.isna(a) or pd.isna(b) or a <= 0:
        return None
    return float(b / a - 1)


def compound(daily: pd.Series, h: int) -> float | None:
    tail = daily.iloc[-h:]
    if tail.isna().all():
        return None
    return float((1 + tail.fillna(0)).prod() - 1)


def beta(y: pd.Series, x: pd.Series) -> float:
    df = pd.concat([y, x], axis=1).iloc[-BETA_WINDOW:].dropna()
    if len(df) < BETA_MIN_DAYS:
        return 1.0
    vx = df.iloc[:, 1].var()
    if not vx or vx <= 0:
        return 1.0
    return float(np.clip(df.iloc[:, 0].cov(df.iloc[:, 1]) / vx, 0.0, 3.0))


def decompose(r: float | None, rm: float | None, b: float,
              rsx: float | None, bsx: float) -> dict | None:
    """騰落率 r を 市場 m・セクター s・個別 i に分ける。3 つを足すと r に戻る。"""
    if r is None or rm is None:
        return None
    m = b * rm
    s = (rsx - bsx * rm) if rsx is not None else 0.0
    return {"r": _f(r), "m": _f(m), "s": _f(s), "i": _f(r - m - s)}


def pct(x: float | None) -> str:
    return "—" if x is None else f"{x * 100:+.1f}%"


def classify(d20: dict | None, d5: dict | None, dd60: float | None) -> tuple[str, str]:
    """戻り値は（判定, 理由）。判定は buy / caution / watch / none。"""
    if not d20:
        return "none", ""
    r, m, s, i = d20["r"], d20["m"], d20["s"], d20["i"]
    common = m + s
    dropping = r <= DROP_R20                                  # 20 日で実際に下げている
    deep = dd60 is not None and dd60 <= DROP_DD60             # 60 日高値から大きく下にいる
    if not dropping and not deep:
        if d5 and d5["r"] <= WATCH_R5:
            return "watch", f"直近 5 日で {pct(d5['r'])}。20 日で見るとまだ大きな下げではない"
        return "none", ""
    head = f"20 日で {pct(r)}（日経 {pct(m)}・セクター {pct(s)}・個別 {pct(i)}）"
    if i <= IND_CAUTION and i < common:
        return "caution", f"{head}。下げの主因は個別要因"
    if dropping and common <= COMMON_MAX and i > IND_FLOOR_FOR_BUY:
        return "buy", f"{head}。下げの大半は地合いとセクターにつられたもの"
    if not dropping:
        return "watch", f"60 日高値から {pct(dd60)}。直近 20 日は {pct(r)} で、下げは落ち着きつつある"
    return "watch", f"{head}。主因がはっきりしない"


def analyze(watch: list[dict], closes: dict[str, pd.Series], market: pd.Series) -> dict:
    """銘柄ごと・セクターごとの指標を計算する。"""
    tickers = [w["code"] + ".T" for w in watch if w["code"] + ".T" in closes]
    px = align({t: closes[t] for t in tickers}, market)
    rets = px.pct_change(fill_method=None)
    mret = market.pct_change(fill_method=None)

    sectors: dict[str, list[str]] = {}
    for w in watch:
        if w["code"] + ".T" in px.columns:
            sectors.setdefault(w["sector"], []).append(w["code"] + ".T")

    betas = {t: beta(rets[t], mret) for t in px.columns}
    pr = {(t, h): period_return(px[t], h) for t in px.columns for h in HORIZONS}

    stocks: list[dict] = []
    for w in watch:
        t = w["code"] + ".T"
        if t not in px.columns:
            continue
        s = px[t]
        # セクターの基準は「自分以外の銘柄の中央値」。平均だと、1 銘柄の急落が
        # ほかの銘柄のセクター要因に混ざってしまう（個別の悪材料が見えにくくなる）
        others = [o for o in sectors[w["sector"]] if o != t]
        b = betas[t]
        bsx = float(np.median([betas[o] for o in others])) if others else 1.0
        dec = {}
        for h in HORIZONS:
            r = pr[(t, h)]
            rm = period_return(market, h)
            vals = [pr[(o, h)] for o in others if pr[(o, h)] is not None]
            rsx = float(np.median(vals)) if vals else None
            dec[str(h)] = decompose(r, rm, b, rsx, bsx)

        valid = s.dropna()
        last = float(valid.iloc[-1])
        hi60 = valid.iloc[-60:].max()
        y1 = valid.iloc[-250:]
        dd60 = last / hi60 - 1 if hi60 > 0 else None
        span = y1.max() - y1.min()
        pos1y = (last - y1.min()) / span if span > 0 else None
        vol = rets[t].iloc[-60:].std()
        r20 = dec["20"]["r"] if dec["20"] else None
        z20 = r20 / (vol * math.sqrt(20)) if (r20 is not None and vol and vol > 0) else None
        label, reason = classify(dec["20"], dec["5"], dd60)
        stocks.append({
            "code": w["code"], "name": w["name"], "sector": w["sector"], "memo": w["memo"],
            "last": _f(last, 2), "asof": valid.index[-1].strftime("%Y-%m-%d"),
            "dec": dec, "beta": _f(b, 2), "dd60": _f(dd60), "pos1y": _f(pos1y, 3), "z20": _f(z20, 2),
            "signal": {"label": label, "reason": reason},
            "series": [_f(v, 2) for v in s.iloc[-250:]],
        })

    sector_out: list[dict] = []
    for name, members in sectors.items():
        sr = rets[members].mean(axis=1, skipna=True)
        b = beta(sr, mret)
        dec = {}
        for h in HORIZONS:
            r = compound(sr, h)
            rm = period_return(market, h)
            dec[str(h)] = None if r is None or rm is None else {"r": _f(r), "m": _f(b * rm), "s": _f(r - b * rm)}
        level = (1 + sr.iloc[-250:].fillna(0)).cumprod()
        sector_out.append({
            "name": name, "beta": _f(b, 2), "dec": dec,
            "codes": [m.removesuffix(".T") for m in members],
            "series": [_f(v * 100, 2) for v in level],
        })

    return {"stocks": stocks, "sectors": sector_out}


def market_block(name: str, s: pd.Series, idx: pd.Index) -> dict:
    s = s.reindex(idx).ffill(limit=5)
    return {
        "name": name,
        "last": _f(s.dropna().iloc[-1], 2) if s.notna().any() else None,
        "ret": {str(h): _f(period_return(s, h)) for h in HORIZONS},
        "series": [_f(v, 2) for v in s.iloc[-250:]],
    }
