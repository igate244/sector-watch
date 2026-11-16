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


def download_closes(tickers: list[str], period: str = "2y",
                    volumes: dict[str, pd.Series] | None = None) -> dict[str, pd.Series]:
    """終値（分割・配当調整済み）をまとめて取る。取れなかった銘柄は 1 回だけ取り直す。
    volumes に dict を渡すと、出来高もそこに入れる（初動の判定に使う）。"""
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
        vols = None
        if volumes is not None:
            try:
                if isinstance(raw.columns, pd.MultiIndex):
                    vols = raw["Volume"] if "Volume" in lv0 else raw.xs("Volume", axis=1, level=1)
                else:
                    vols = raw[["Volume"]].rename(columns={"Volume": batch[0]})
            except KeyError:
                vols = None
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
            if vols is not None and t in vols.columns:
                v = vols[t].dropna()
                vi = pd.to_datetime(v.index)
                if vi.tz is not None:
                    vi = vi.tz_localize(None)
                v.index = vi.normalize()
                volumes[str(t)] = v.astype(float)

    run(tickers)
    missing = [t for t in tickers if t not in result]
    if missing:
        print(f"[prices] 取れなかった {len(missing)} 銘柄を取り直します: {missing}")
        time.sleep(5)
        run(missing)
    print(f"[prices] {len(result)}/{len(tickers)} 銘柄を取得")
    return result


# 市場カードの細かいチャート用。期間 → （取得期間, 足の長さ, 表示する営業日数）
INTRADAY = {"1": ("5d", "5m", 1), "5": ("5d", "15m", 5), "20": ("1mo", "60m", 20)}


def download_intraday(tickers: list[str]) -> dict[str, dict]:
    """日経平均と TOPIX ETF の分足。期間ごとに {"t": [時刻], 銘柄: [値]} を返す。取れなければ空。

    時刻は日本時間の "YYYY-MM-DDTHH:MM"。銘柄ごとに時刻がずれることがあるので、合わせて前の値で埋める。
    """
    out: dict[str, dict] = {}
    for h, (period, interval, days) in INTRADAY.items():
        try:
            raw = yf.download(tickers, period=period, interval=interval, auto_adjust=True,
                              group_by="column", threads=True, progress=False, prepost=False)
        except Exception as exc:  # noqa: BLE001
            print(f"[intraday] {interval} を取れませんでした: {exc}")
            continue
        if raw is None or raw.empty:
            continue
        if isinstance(raw.columns, pd.MultiIndex):
            lv0 = raw.columns.get_level_values(0)
            closes = raw["Close"] if "Close" in lv0 else raw.xs("Close", axis=1, level=1)
        else:
            closes = raw[["Close"]].rename(columns={"Close": tickers[0]})
        idx = pd.to_datetime(closes.index)
        idx = idx.tz_localize("UTC") if idx.tz is None else idx
        closes.index = idx.tz_convert("Asia/Tokyo")
        closes = closes.sort_index().ffill()
        # 直近 days 営業日分だけ残す。先頭には前の日の最後の値を 1 本置き、そこを 0% の基準にする
        all_dates = sorted(set(closes.index.date))
        dates = all_dates[-days:]
        base = closes[closes.index.date == all_dates[-days - 1]].tail(1) if len(all_dates) > days else closes.iloc[:0]
        closes = pd.concat([base, closes[[d in dates for d in closes.index.date]]])
        closes = closes.dropna(how="all")
        if len(closes) < 3:
            continue
        block: dict = {"interval": interval, "t": [t.strftime("%Y-%m-%dT%H:%M") for t in closes.index]}
        for t in tickers:
            if t in closes.columns and closes[t].notna().any():
                block[t] = [None if pd.isna(v) else round(float(v), 2) for v in closes[t]]
        out[h] = block
        print(f"[intraday] {h} 日: {interval} × {len(closes)} 本")
    return out
