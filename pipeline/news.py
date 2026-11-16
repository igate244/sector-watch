"""
ニュースの確認。

- GEMINI_API_KEY があるとき: Gemini API に Google 検索をさせて、
  「下げの原因に個別の悪材料があるか」を判定させる（Grounding with Google Search）。
  費用は Google AI Pro の特典（Cloud クレジット 月 $10）から払われる。検索は月 5,000 回まで無料。
- ないとき: Google ニュースの RSS から見出しを集めるだけ（無料・キー不要）。
"""

from __future__ import annotations

import json
import os
import re
import time
import urllib.parse
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime

import requests

API = "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
DEFAULT_MODEL = "gemini-3.5-flash-lite"
JST = timezone(timedelta(hours=9))
# 株価ページや掲示板など、ニュースではない見出し
NOISE = re.compile(r"株価・株式情報|株価チャート|掲示板|株主優待|企業情報|時系列|みんかぶ|株探|Yahoo!ファイナンス$|IR情報")


class Gemini:
    def __init__(self, key: str, model: str, max_calls: int):
        self.key = key
        self.model = model or DEFAULT_MODEL
        self.left = max_calls
        self.used = 0
        self.errors: list[str] = []

    @classmethod
    def from_env(cls) -> "Gemini | None":
        key = os.environ.get("GEMINI_API_KEY", "").strip()
        if not key or os.environ.get("NEWS_MODE", "") == "reuse":
            return None
        return cls(key, os.environ.get("GEMINI_MODEL", "").strip(), int(os.environ.get("NEWS_MAX_CALLS", "15")))

    def ask(self, prompt: str) -> tuple[str, list[dict]] | None:
        """検索つきで質問する。戻り値は（本文, 出典）。上限に達したか失敗したら None。"""
        if self.left <= 0:
            return None
        self.left -= 1
        body = {
            "contents": [{"role": "user", "parts": [{"text": prompt}]}],
            "tools": [{"google_search": {}}],
            "generationConfig": {"temperature": 0.2},
        }
        for attempt in range(2):
            try:
                resp = requests.post(
                    API.format(model=self.model), json=body, timeout=120,
                    headers={"x-goog-api-key": self.key, "Content-Type": "application/json"},
                )
                if resp.status_code == 429 and attempt == 0:
                    time.sleep(30)
                    continue
                if resp.status_code in (400, 401, 402, 403, 404):
                    # キー・支払い・モデル名の問題は何度呼んでも同じなので、この回はもう呼ばない
                    self.left = 0
                    try:
                        detail = resp.json().get("error", {}).get("message", "")
                    except ValueError:
                        detail = resp.text
                    raise RuntimeError(f"HTTP {resp.status_code}: {detail[:300]}")
                resp.raise_for_status()
                self.used += 1
                cand = resp.json()["candidates"][0]
                text = "".join(p.get("text", "") for p in cand.get("content", {}).get("parts", []))
                chunks = cand.get("groundingMetadata", {}).get("groundingChunks", [])
                sources = [
                    {"title": c["web"].get("title", ""), "url": c["web"].get("uri", "")}
                    for c in chunks if "web" in c
                ][:5]
                return text, sources
            except Exception as exc:  # noqa: BLE001
                msg = str(exc)
                if self.key in msg:
                    msg = msg.replace(self.key, "***")
                self.errors.append(msg[:300])
                print(f"[gemini] 失敗: {msg[:300]}")
                return None
        return None


def _json_in(text: str) -> dict | None:
    m = re.search(r"\{.*\}", text, re.S)
    if not m:
        return None
    try:
        return json.loads(m.group(0))
    except json.JSONDecodeError:
        return None


def judge_stock(g: Gemini, st: dict, market_r20: float | None, asof: str) -> dict | None:
    """下げている銘柄について、個別の悪材料があるかを Gemini に調べさせる。"""
    d = st["dec"]["20"]
    pct = lambda x: "不明" if x is None else f"{x * 100:+.1f}%"  # noqa: E731
    prompt = (
        f"あなたは日本株のアナリストです。Google 検索で最新のニュースを調べて答えてください。\n"
        f"銘柄: {st['name']}（東証 {st['code']}、セクター: {st['sector']}）\n"
        f"{asof} までの 20 営業日で株価は {pct(d['r'])}。同じ期間の日経平均は {pct(market_r20)}、"
        f"同じセクターの他銘柄の平均を元に分けると、市場要因 {pct(d['m'])}・セクター要因 {pct(d['s'])}・個別要因 {pct(d['i'])}。\n"
        "直近 3 週間に、この会社固有の悪材料（決算の悪化・業績予想の下方修正・不祥事・格下げ・"
        "公募増資・主要顧客の喪失・訴訟など）があったかを調べてください。\n"
        "次の JSON だけを出力してください。説明文は不要です。\n"
        '{"bad_news": true か false, "summary": "下げの理由の要約（80 字以内）", '
        '"factors": ["材料を短く", "..."]}'
    )
    out = g.ask(prompt)
    if not out:
        return None
    text, sources = out
    data = _json_in(text) or {}
    return {
        "by": "gemini",
        "asof": asof,
        "bad_news": bool(data.get("bad_news")) if "bad_news" in data else None,
        "summary": str(data.get("summary") or text.strip())[:200],
        "factors": [str(f)[:60] for f in (data.get("factors") or [])][:4],
        "sources": sources,
    }


def market_comment(g: Gemini, asof: str, n225_r1: float | None, movers: str) -> dict | None:
    prompt = (
        f"Google 検索で調べて答えてください。{asof} の東京株式市場について、"
        f"日経平均の前日比は {'不明' if n225_r1 is None else f'{n225_r1 * 100:+.2f}%'}。\n"
        f"手元のデータで動きが大きかった業種: {movers}\n"
        "この日の相場の概況と、主な業種の動きの理由を、日本語 150 字以内でまとめてください。前置きは不要です。"
    )
    out = g.ask(prompt)
    if not out:
        return None
    text, sources = out
    return {"asof": asof, "text": text.strip()[:400], "sources": sources}


def headlines(name: str, days: int = 14, limit: int = 5) -> dict | None:
    """Google ニュースの RSS から見出しを拾う（判定はしない）。"""
    q = urllib.parse.quote(f"{name} 株")
    url = f"https://news.google.com/rss/search?q={q}&hl=ja&gl=JP&ceid=JP:ja"
    try:
        resp = requests.get(url, timeout=20, headers={"User-Agent": "Mozilla/5.0"})
        resp.raise_for_status()
        root = ET.fromstring(resp.content)
    except Exception as exc:  # noqa: BLE001
        print(f"[rss] {name}: {exc}")
        return None
    since = datetime.now(JST) - timedelta(days=days)
    items = []
    for it in root.iter("item"):
        try:
            when = parsedate_to_datetime(it.findtext("pubDate") or "")
        except (TypeError, ValueError):
            continue
        title = (it.findtext("title") or "").strip()
        if when < since or NOISE.search(title):
            continue
        items.append({
            "title": title,
            "url": (it.findtext("link") or "").strip(),
            "date": when.astimezone(JST).strftime("%Y-%m-%d"),
        })
    items.sort(key=lambda x: x["date"], reverse=True)
    if not items:
        return None
    return {"by": "rss", "bad_news": None, "summary": "", "factors": [], "sources": items[:limit]}
