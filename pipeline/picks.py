"""
Gemini の見立て: 買い候補の上位 7 銘柄を 1 つずつ Gemini（Hydrogen）に調べさせ、
最後にその 7 件の見解からお勧めの上位 3 銘柄を選ばせる。夜の回だけ（1 晩 8 回）。

PICKS_MODEL      使うモデル（既定: gemini-4-hydrogen）
PICKS_N          調べる銘柄の数（既定: 7）
"""

from __future__ import annotations

import os
import re
from datetime import datetime

from . import news

DEFAULT_MODEL = "gemini-4-hydrogen"
# 費用の目安（1 Mトークンあたりのドル。入力, 出力）。画面に「今夜いくらくらい」を出すためだけに使う
PRICE_USD = {"gemini-4-hydrogen": (1.50, 7.50)}
YEN_PER_USD = 155
VIEWS = ("買い", "様子見", "見送り")


def _pct(x: float | None) -> str:
    return "不明" if x is None else f"{x * 100:+.1f}%"


def top_buys(stocks: list[dict], n: int) -> list[dict]:
    """候補タブの「買い」と同じ並び（珍しい下げの順）で上位 n 件"""
    buys = [s for s in stocks if s["signal"]["label"] == "buy"]
    buys.sort(key=lambda s: s.get("z20") if s.get("z20") is not None else 0)
    return buys[:n]


def _parse_view(text: str) -> dict:
    out: dict = {"view": None, "conf": None, "summary": "", "reasons": [], "risks": []}
    m = re.search(r"見解[:：]\s*(\S+)", text)
    if m:
        for v in VIEWS:
            if v in m.group(1):
                out["view"] = v
                break
    m = re.search(r"自信[:：]\s*([1-5１-５])", text)
    if m:
        out["conf"] = int(m.group(1).translate(str.maketrans("１２３４５", "12345")))
    m = re.search(r"要約[:：]\s*(.+)", text)
    if m:
        out["summary"] = m.group(1).strip()
    for key, field in (("根拠", "reasons"), ("リスク", "risks")):
        m = re.search(rf"{key}[:：]\s*(.*?)(?=\n\S+[:：]|\Z)", text, re.S)
        if m:
            items = re.findall(r"^[\s　]*[・\-\*•]\s*(.+)$", m.group(1), re.M)
            out[field] = [i.strip()[:80] for i in items if i.strip() and i.strip() != "なし"][:3]
    if not out["summary"]:
        out["summary"] = re.sub(r"\s+", " ", text).strip()[:120]
    return out


def ask_one(g: news.Gemini, st: dict, n225_r20: float | None, asof: str) -> dict | None:
    d20 = st["dec"].get("20") or {}
    prompt = (
        f"あなたは日本株を長く扱ってきたプロのトレーダーです。{asof} 時点で、"
        f"{st['name']}（東証 {st['code']}、{st['sector']}）を「いま買ってよいか」を判断してください。\n"
        f"まず Google 検索で、直近 1 ヶ月のニュース・適時開示・決算と業績予想、PER・PBR などの割安さ、"
        f"チャートの形（移動平均・直近の高値安値）を調べてから答えてください。\n"
        f"手元のデータ: 株価 {st['last']:,} 円、20 営業日で {_pct(d20.get('r'))}（同じ期間の日経平均 {_pct(n225_r20)}）。"
        f"内訳は 日経平均につられた分 {_pct(d20.get('m'))}・業種の分 {_pct(d20.get('s'))}・この銘柄だけの分 {_pct(d20.get('i'))}。"
        f"60 日高値から {_pct(st.get('dd60'))}。このアプリは「市場と業種につられた下げで、個別の悪材料は小さい＝買い候補」と見ています。\n"
        "この見立てが正しいかも含めて、検索で確かめられた事実を根拠に判断してください。\n"
        "次の形で、日本語で答えてください。前置きは不要です。\n"
        "見解: 買い または 様子見 または 見送り\n"
        "自信: 1〜5 の数字（5 が最も自信あり）\n"
        "要約: 結論と一番の理由（60 字以内）\n"
        "根拠:\n・根拠を短く（2〜3 個）\n"
        "リスク:\n・注意点を短く（1〜2 個）"
    )
    out = g.ask(prompt)
    if not out:
        return None
    text, sources = out
    v = _parse_view(text)
    return {
        "code": st["code"],
        "name": st["name"],
        "sector": st["sector"],
        "view": v["view"],
        "conf": v["conf"],
        "summary": v["summary"][:120],
        "reasons": v["reasons"],
        "risks": v["risks"],
        "sources": sources[:3],
        "searched": g.searched,
    }


def choose_top3(g: news.Gemini, items: list[dict], asof: str) -> dict | None:
    lines = []
    for it in items:
        lines.append(
            f"- {it['name']}（{it['code']}・{it['sector']}）見解: {it['view'] or '不明'}／自信 {it['conf'] or '?'}／"
            f"{it['summary']}／根拠: {'、'.join(it['reasons'])}／リスク: {'、'.join(it['risks'])}"
        )
    codes = [it["code"] for it in items]
    prompt = (
        f"あなたは日本株のプロのトレーダーです。{asof} 時点の買い候補 {len(items)} 銘柄について、"
        "1 銘柄ずつ調べた見解が下にあります。この中から、いま買うならお勧めの上位 3 銘柄を選んでください。"
        "見解が「見送り」のものは選ばないでください。3 つに満たなければ少なくてかまいません。\n\n"
        + "\n".join(lines)
        + "\n\n次の形で、日本語で答えてください。前置きは不要です。コードは上の 4 桁（英字を含むこともある）をそのまま使うこと。\n"
        "1位: コード｜選んだ理由（50 字以内）\n2位: コード｜選んだ理由\n3位: コード｜選んだ理由\n"
        "総評: 今日の候補全体について一言（60 字以内）"
    )
    out = g.ask(prompt, search=False)
    if not out:
        return None
    text, _ = out
    top = []
    for m in re.finditer(r"[1-3１-３]位[:：]\s*([0-9A-Za-z]{4})\s*[｜|]\s*(.+)", text):
        code = m.group(1).upper()
        if code in codes and code not in [t["code"] for t in top]:
            top.append({"code": code, "reason": m.group(2).strip()[:80]})
    m = re.search(r"総評[:：]\s*(.+)", text)
    return {"top3": top[:3], "overall": (m.group(1).strip()[:120] if m else "")}


def run(stocks: list[dict], n225_r20: float | None, asof: str, prev: dict | None) -> dict | None:
    """夜の回に呼ぶ。キーがない・使い回しのときは前回の結果を返す。"""
    key = os.environ.get("GEMINI_API_KEY", "").strip()
    if not key or os.environ.get("NEWS_MODE", "") == "reuse":
        return prev
    if prev and prev.get("asof") == asof and not os.environ.get("NEWS_FORCE"):
        print(f"[picks] {asof} の見立ては済んでいるので、今回は呼びません")
        return prev
    model = os.environ.get("PICKS_MODEL", "").strip() or DEFAULT_MODEL
    n = int(os.environ.get("PICKS_N", "7"))
    targets = top_buys(stocks, n)
    if not targets:
        return {"asof": asof, "model": model, "items": [], "top3": [], "overall": "今日は買い候補がありません", "usage": None}
    g = news.Gemini(key, model, n + 1)
    items = []
    for st in targets:
        r = ask_one(g, st, n225_r20, asof)
        if r:
            items.append(r)
    if not items:
        print(f"[picks] 1 件も答えが取れませんでした: {g.errors[:1]}")
        return prev
    pick = choose_top3(g, items, asof) or {"top3": [], "overall": ""}
    price = PRICE_USD.get(model)
    yen = None
    if price:
        yen = round((g.tokens_in * price[0] + g.tokens_out * price[1]) / 1e6 * YEN_PER_USD, 1)
    print(f"[picks] {model} {g.used} 回・入力 {g.tokens_in}・出力 {g.tokens_out} トークン（目安 {yen} 円）")
    return {
        "asof": asof,
        "model": model,
        "generated_at": datetime.now(news.JST).strftime("%Y-%m-%dT%H:%M+09:00"),
        "items": items,
        "top3": pick["top3"],
        "overall": pick["overall"],
        "usage": {"calls": g.used, "in": g.tokens_in, "out": g.tokens_out, "yen": yen},
        "errors": g.errors[:2],
    }
