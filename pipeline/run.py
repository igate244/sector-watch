"""
毎日の計算の入口。

  python -m pipeline.run --out site/data

環境変数（すべて任意）:
  WATCHLIST_CSV_URL   銘柄リスト（Google スプレッドシートを「ウェブに公開」した CSV）
  WATCHLIST_EDIT_URL  そのシートの編集用 URL（画面の「銘柄を編集」ボタンに使う）
  GEMINI_API_KEY      Gemini API のキー。ないときはニュースの見出しだけ集める
  GEMINI_MODEL        使うモデル（既定: gemini-3.5-flash-lite）
  NEWS_MAX_CALLS      1 回の実行で Gemini を呼ぶ回数の上限（市場概況 1＋銘柄。既定: 16）
  NEWS_MODE=reuse     Gemini を呼ばず、前回の判定を使い回す（push 時のビルド用）
  PREV_URL            前回の latest.json の URL（判定の使い回しに使う）
"""

from __future__ import annotations

import argparse
import json
import os
import time
from datetime import datetime
from pathlib import Path

import requests

from . import analysis, news, prices, watchlist

ORDER = {"buy": 0, "caution": 1, "watch": 2, "none": 3}


def load_prev(out: Path) -> dict:
    url = os.environ.get("PREV_URL", "").strip()
    try:
        if url:
            resp = requests.get(url, timeout=30)
            if resp.ok:
                return resp.json()
        elif (out / "latest.json").exists():
            return json.loads((out / "latest.json").read_text(encoding="utf-8"))
    except Exception as exc:  # noqa: BLE001
        print(f"[prev] 前回の結果を読めませんでした: {exc}")
    return {}


def attach_news(stocks: list[dict], prev: dict, asof: str, market_r20: float | None,
                g: news.Gemini | None) -> None:
    prev_news = {s["code"]: s.get("news") for s in prev.get("stocks", [])}
    targets = [s for s in stocks if s["signal"]["label"] != "none"]
    targets.sort(key=lambda s: (ORDER[s["signal"]["label"]], s.get("z20") or 0))
    for st in targets:
        old = prev_news.get(st["code"])
        if old and old.get("by") == "gemini" and old.get("asof") == asof and old.get("v") == news.NEWS_VERSION:
            st["news"] = old
        else:
            st["news"] = news.judge_stock(g, st, market_r20, asof) if g else None
            if st["news"] is None:
                st["news"] = news.headlines(st["name"])
        n = st.get("news")
        if n and n.get("bad_news") is True and st["signal"]["label"] in ("buy", "watch"):
            st["signal"] = {
                "label": "caution",
                "reason": st["signal"]["reason"].split("。")[0] + "。Gemini が個別の悪材料を見つけた",
            }


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="site/data")
    args = ap.parse_args()
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    started = time.time()

    rows, notes, source = watchlist.load()
    names = prices.load_names()
    for r in rows:
        if not r["name"]:
            r["name"] = names.get(r["code"], r["code"])

    tickers = [r["code"] + ".T" for r in rows] + [prices.N225, prices.TOPIX_ETF]
    closes = prices.download_closes(tickers)
    if prices.N225 not in closes:
        raise SystemExit("日経平均が取れなかったので中止します")
    market = closes.pop(prices.N225)
    topix = closes.pop(prices.TOPIX_ETF, None)
    for r in rows:
        if r["code"] + ".T" not in closes:
            notes.append(f"{r['code']} {r['name']} の株価が取れませんでした（上場廃止・コード違いの可能性）")

    res = analysis.analyze(rows, closes, market)
    idx = market.index[-250:]
    asof = market.index[-1].strftime("%Y-%m-%d")
    n225 = analysis.market_block("日経平均", market, market.index)
    topix_block = analysis.market_block("TOPIX（1306 ETF）", topix, market.index) if topix is not None else None

    prev = load_prev(out)
    g = news.Gemini.from_env()

    # 市場概況を先に作る（銘柄の確認で呼び出し上限を使い切らないように）
    comment = prev.get("market_comment")
    if not (comment and comment.get("asof") == asof):
        comment = None
        if g:
            secs = sorted(
                (s for s in res["sectors"] if s["dec"]["1"]),
                key=lambda s: s["dec"]["1"]["r"],
            )
            movers = "、".join(
                f"{s['name']} {s['dec']['1']['r'] * 100:+.1f}%" for s in (secs[:2] + secs[-2:])
            )
            comment = news.market_comment(g, asof, n225["ret"]["1"], movers)


    attach_news(res["stocks"], prev, asof, n225["ret"]["20"], g)

    repo = os.environ.get("GITHUB_REPOSITORY", "")
    result = {
        "generated_at": datetime.now(news.JST).strftime("%Y-%m-%dT%H:%M+09:00"),
        "asof": asof,
        "dates": [d.strftime("%Y-%m-%d") for d in idx],
        "market": {"n225": n225, "topix": topix_block},
        "sectors": res["sectors"],
        "stocks": res["stocks"],
        "market_comment": comment,
        "watchlist": {
            "source": source,
            "edit_url": os.environ.get("WATCHLIST_EDIT_URL", "").strip() or None,
            "notes": notes,
        },
        "run": {
            "workflow_url": f"https://github.com/{repo}/actions/workflows/update.yml" if repo else None,
            "gemini_calls": g.used if g else 0,
            "gemini_errors": (g.errors[:3] if g else []),
            "elapsed_sec": round(time.time() - started, 1),
        },
    }
    (out / "latest.json").write_text(json.dumps(result, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    codes = sorted([c, n] for c, n in names.items())
    (out / "codes.json").write_text(json.dumps(codes, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")

    count = {k: sum(1 for s in res["stocks"] if s["signal"]["label"] == k) for k in ORDER}
    print(f"[done] {asof} の終値 / {len(res['stocks'])} 銘柄・{len(res['sectors'])} セクター / "
          f"買い候補 {count['buy']}・要注意 {count['caution']}・様子見 {count['watch']} / "
          f"Gemini {result['run']['gemini_calls']} 回 / {result['run']['elapsed_sec']} 秒")
    for n in notes:
        print(f"[note] {n}")


if __name__ == "__main__":
    main()
