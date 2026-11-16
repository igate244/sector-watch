"""
合成データで判定を確かめる。  python -m pipeline.test_analysis
"""

import numpy as np
import pandas as pd

from . import analysis, watchlist

rng = np.random.default_rng(0)
idx = pd.bdate_range("2025-01-01", periods=300)


def walk(daily: np.ndarray, start: float = 1000.0) -> pd.Series:
    return pd.Series(start * np.cumprod(1 + daily), index=idx)


def main() -> None:
    m = rng.normal(0.0003, 0.01, len(idx))
    m[-20:] = -0.004                      # 直近 20 日、日経がじり安（約 -8%）
    market = walk(m, 40000)

    def stock(extra_last20: float, noise: float = 0.004) -> pd.Series:
        d = m + rng.normal(0, noise, len(idx))
        d[-20:] += extra_last20
        return walk(d)

    closes = {
        "1001.T": stock(0.0),              # 地合いにつられただけ → 買い候補
        "1002.T": stock(0.0),
        "1003.T": stock(-0.006),           # 個別に大きく下げた → 要注意
        "1004.T": stock(0.0),
    }
    watch = [{"sector": "テスト", "code": t[:4], "name": t, "memo": ""} for t in closes]
    res = analysis.analyze(watch, closes, market)
    got = {s["code"]: s for s in res["stocks"]}
    for code, s in got.items():
        d = s["dec"]["20"]
        assert abs(d["m"] + d["s"] + d["i"] - d["r"]) < 1e-3, "3 つを足すと騰落率に戻ること"
        print(code, s["signal"]["label"], s["signal"]["reason"])
    assert got["1001"]["signal"]["label"] == "buy"
    assert got["1003"]["signal"]["label"] == "caution"

    rows, errors = watchlist.parse("セクター,コード,銘柄名\n半導体,８０３５,\n半導体,130a,\n半導体,12,\n,,\n半導体,8035,\n")
    assert [r["code"] for r in rows] == ["8035", "130A"], rows
    assert len(errors) == 2, errors
    print("OK")


if __name__ == "__main__":
    main()
