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
    # 初動: 地合いと無関係に、じり高 → 静かなもみ合い → 出来高を伴って高値を抜ける
    d = np.full(len(idx), 0.0015) + rng.normal(0, 0.006, len(idx))
    d[-40:-3] = rng.normal(0, 0.002, 37)
    d[-3:] = [0.025, 0.012, 0.008]
    closes["2001.T"] = walk(d)
    vol = pd.Series(1e6, index=idx)
    vol.iloc[-3:] = 3e6
    volumes = {"2001.T": vol}
    watch = [{"sector": "テスト", "code": t[:4], "name": t, "memo": ""} for t in closes if t != "2001.T"]
    watch.append({"sector": "上昇", "code": "2001", "name": "初動", "memo": ""})
    res = analysis.analyze(watch, closes, market, volumes)
    got = {s["code"]: s for s in res["stocks"]}
    for code, s in got.items():
        d = s["dec"]["20"]
        assert abs(d["m"] + d["s"] + d["i"] - d["r"]) < 1e-3, "3 つを足すと騰落率に戻ること"
        print(code, s["signal"]["label"], s["signal"]["reason"])
    assert got["1001"]["signal"]["label"] == "buy"
    assert got["1003"]["signal"]["label"] == "caution"
    assert got["2001"]["signal"]["label"] == "rise", got["2001"]["rise"]
    assert "出来高 3.0 倍" in got["2001"]["rise"]["hits"]
    for code in ("1001", "1003"):
        assert got[code]["rise"] is None, "下げている銘柄は初動候補にしない"

    rows, errors = watchlist.parse("セクター,コード,銘柄名\n半導体,８０３５,\n半導体,130a,\n半導体,12,\n,,\n半導体,8035,\n")
    assert [r["code"] for r in rows] == ["8035", "130A"], rows
    assert len(errors) == 2, errors
    print("OK")




def test_earnings_estimate_not_promoted() -> None:
    """前回の「目安」の決算日を、次の回で本当の予定日として扱わない。"""
    from datetime import date
    from . import events
    events.fetch_jpx_kessan = lambda: {}
    rows = [{"code": "6503", "name": "三菱電機"}]
    prev = [{"code": "6503", "earnings": {"last": "2026-10-30", "next": "2027-01-29", "next_est": True}}]
    e = events.earnings(rows, prev, date(2026, 11, 17))
    assert e["6503"].get("next_est") is True, e
    assert not [x for x in events.build(rows, e, date(2026, 11, 17)) if x["kind"] == "earnings"]
    # 出どころの印が無い next（古いデータ）も信用しない
    prev = [{"code": "6503", "earnings": {"last": "2026-10-30", "next": "2027-01-29"}}]
    assert events.earnings(rows, prev, date(2026, 11, 17))["6503"].get("next_est") is True
    # JPX で確かめた予定日は引き継ぐ
    prev = [{"code": "6503", "earnings": {"next": "2026-11-20", "kind": "第2四半期", "confirmed": True}}]
    e = events.earnings(rows, prev, date(2026, 11, 17))
    assert e["6503"]["next"] == "2026-11-20" and not e["6503"].get("next_est"), e



def test_picks_parse():
    """Gemini の見立ての読み取り（形が少し崩れていても拾う）"""
    from . import picks
    v = picks._parse_view(
        "見解: 様子見\n自信: ４\n要約: 業種につられた下げだが決算前で慎重に\n"
        "根拠:\n・PBR1倍割れ\n・受注は堅調\nリスク:\n・11/27 の決算\n"
    )
    assert v["view"] == "様子見" and v["conf"] == 4, v
    assert v["reasons"] == ["PBR1倍割れ", "受注は堅調"] and v["risks"] == ["11/27 の決算"], v
    st = [{"signal": {"label": "buy"}, "z20": z, "code": c} for c, z in (("A", -1.0), ("B", -3.0), ("C", None))]
    st.append({"signal": {"label": "watch"}, "z20": -9, "code": "D"})
    assert [s["code"] for s in picks.top_buys(st, 2)] == ["B", "A"]


if __name__ == "__main__":
    main()
    test_earnings_estimate_not_promoted()
    print("決算の目安: OK")
    test_picks_parse()
    print("Gemini の見立ての読み取り: OK")
