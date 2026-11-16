"""
株価の取得（yfinance）と、銘柄名⇔コードの対応表（JPX の上場銘柄一覧）。
GitHub Actions 上で実行する前提。
"""

from __future__ import annotations

import io
import time
import unicodedata
from pathlib import Path

import pandas as pd
import requests
import yfinance as yf

ROOT = Path(__file__).resolve().parent.parent
JPX_URL = "https://www.jpx.co.jp/markets/statistics-equities/misc/tvdivq0000001vg2-att/data_j.xlsx"
TICKERS_CSV = ROOT / "config" / "tickers.csv"

N225 = "^N225"
TOPIX_ETF = "1306.T"  # TOPIX は yfinance で取れないので、連動 ETF で代わりにする


def _norm_name(s: object) -> str:
    return unicodedata.normalize("NFKC", str(s or "")).replace(" ", "").strip()


def load_names() -> dict[str, str]:
    """コード → 銘柄名。JPX から取れなければリポジトリ内の予備の一覧を使う。"""
    try:
        resp = requests.get(JPX_URL, timeout=60, headers={"User-Agent": "Mozilla/5.0"})
        resp.raise_for_status()
        df = pd.read_excel(io.BytesIO(resp.content))
        df = df.rename(columns={"コード": "code", "銘柄名": "name", "33業種区分": "sector"})
        df = df[df["sector"] != "-"]
        out = {str(c).strip(): unicodedata.normalize("NFKC", str(n)).strip() for c, n in zip(df["code"], df["name"])}
        print(f"[names] JPX から {len(out)} 銘柄")
        return out
    except Exception as exc:  # noqa: BLE001
        print(f"[names] JPX を読めませんでした（{exc}）。予備の一覧を使います")
        df = pd.read_csv(TICKERS_CSV, encoding="utf-8-sig")
        return {
            str(t).removesuffix(".T"): unicodedata.normalize("NFKC", str(n)).strip()
            for t, n in zip(df["ticker"], df["name"])
        }


def _drop_glitches(s: pd.Series) -> pd.Series:
    """1 日で 3 倍超・3 分の 1 未満の動きはデータ異常とみなし、それより後ろだけ残す（stock-app の知見）。"""
    if len(s) < 2:
        return s
    ratio = s / s.shift(1)
    bad = (ratio > 3) | (ratio < 1 / 3)
    if not bad.any():
        return s
    return s.loc[s.index >= bad[bad].index[-1]]


def download_closes(tickers: list[str], period: str = "2y") -> dict[str, pd.Series]:
    """終値（分割・配当調整済み）をまとめて取る。取れなかった銘柄は 1 回だけ取り直す。"""
    result: dict[str, pd.Series] = {}

    def run(batch: list[str]) -> None:
        for attempt in range(3):
            try:
                raw = yf.download(batch, period=period, interval="1d", auto_adjust=True,
                                  group_by="column", threads=True, progress=False)
                break
            except Exception as exc:  # noqa: BLE001 — レート制限などは待って再試行
                wait = 20 * (attempt + 1)
                print(f"[prices] 取得エラー（{exc}）。{wait} 秒待って再試行")
                time.sleep(wait)
        else:
            return
        if raw is None or raw.empty:
            return
        if isinstance(raw.columns, pd.MultiIndex):
            lv0 = raw.columns.get_level_values(0)
            closes = raw["Close"] if "Close" in lv0 else raw.xs("Close", axis=1, level=1)
        else:
            closes = raw[["Close"]].rename(columns={"Close": batch[0]})
        for t in closes.columns:
            s = closes[t].dropna()
            s = s[s > 0]
            s = _drop_glitches(s)
            if len(s) < 30:
                continue
            idx = pd.to_datetime(s.index)
            if idx.tz is not None:
                idx = idx.tz_localize(None)
            s.index = idx.normalize()
            result[str(t)] = s.astype(float)

    run(tickers)
    missing = [t for t in tickers if t not in result]
    if missing:
        print(f"[prices] 取れなかった {len(missing)} 銘柄を取り直します: {missing}")
        time.sleep(5)
        run(missing)
    print(f"[prices] {len(result)}/{len(tickers)} 銘柄を取得")
    return result
