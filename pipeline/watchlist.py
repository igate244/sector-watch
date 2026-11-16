"""
追いかける銘柄の一覧を読む。

優先順:
  1. 環境変数 WATCHLIST_CSV_URL（Google スプレッドシートを「ウェブに公開」した CSV の URL）
  2. config/watchlist.csv（シートが読めないときの予備）

表の形（1 行目は見出し。列の順番は自由。足りない列は空でよい）:
  セクター, コード, 銘柄名, メモ
"""

from __future__ import annotations

import csv
import io
import os
import re
import unicodedata
from pathlib import Path

import requests

ROOT = Path(__file__).resolve().parent.parent
FALLBACK = ROOT / "config" / "watchlist.csv"

# 見出しの揺れを吸収する（日本語・英語どちらでも書ける）
HEADERS = {
    "セクター": "sector", "業種": "sector", "sector": "sector",
    "コード": "code", "銘柄コード": "code", "code": "code", "ticker": "code",
    "銘柄名": "name", "銘柄": "name", "name": "name",
    "メモ": "memo", "memo": "memo", "note": "memo",
}
# 東証のコードは 4 桁。2024 年からは英字入り（例: 130A）もある
CODE_RE = re.compile(r"^[0-9][0-9A-Z]{2}[0-9A-Z]$")


def _norm(s: object) -> str:
    return unicodedata.normalize("NFKC", str(s or "")).strip()


def parse(text: str) -> tuple[list[dict], list[str]]:
    """CSV の中身から銘柄一覧を作る。戻り値は（銘柄一覧, 読めなかった行の説明）。"""
    rows: list[dict] = []
    errors: list[str] = []
    seen: set[str] = set()
    header: list[str | None] | None = None
    for n, raw in enumerate(csv.reader(io.StringIO(text.lstrip("﻿"))), start=1):
        cells = [_norm(c) for c in raw]
        if not any(cells):
            continue
        if header is None:
            header = [HEADERS.get(c.lower(), HEADERS.get(c)) for c in cells]
            if "sector" not in header or "code" not in header:
                raise ValueError("1 行目の見出しに「セクター」と「コード」が必要です")
            continue
        rec = {key: (cells[i] if i < len(cells) else "") for i, key in enumerate(header) if key}
        code = rec.get("code", "").upper().removesuffix(".T")
        sector = rec.get("sector", "")
        if not code and not sector:
            continue
        if not sector:
            errors.append(f"{n} 行目: セクターが空です（{code}）")
            continue
        if not CODE_RE.match(code):
            errors.append(f"{n} 行目: 銘柄コード「{code}」が読めません")
            continue
        if code in seen:
            errors.append(f"{n} 行目: {code} が 2 回出てきます（最初の行だけ使います）")
            continue
        seen.add(code)
        rows.append({"sector": sector, "code": code, "name": rec.get("name", ""), "memo": rec.get("memo", "")})
    return rows, errors


def load() -> tuple[list[dict], list[str], str]:
    """戻り値は（銘柄一覧, 注意書き, 読み込み元 'sheet' | 'fallback'）。"""
    url = os.environ.get("WATCHLIST_CSV_URL", "").strip()
    notes: list[str] = []
    if url:
        try:
            resp = requests.get(url, timeout=30)
            resp.raise_for_status()
            resp.encoding = "utf-8"
            rows, errors = parse(resp.text)
            if rows:
                print(f"[watchlist] スプレッドシートから {len(rows)} 銘柄")
                return rows, errors, "sheet"
            notes.append("スプレッドシートに銘柄が 1 つもなかったので、予備の一覧を使いました")
        except Exception as exc:  # noqa: BLE001
            print(f"[watchlist] スプレッドシートを読めませんでした: {exc}")
            notes.append("スプレッドシートを読めなかったので、予備の一覧を使いました")
    rows, errors = parse(FALLBACK.read_text(encoding="utf-8-sig"))
    print(f"[watchlist] 予備の一覧から {len(rows)} 銘柄")
    return rows, notes + errors, "fallback"
