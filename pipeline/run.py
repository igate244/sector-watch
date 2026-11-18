"""
毎日の計算の入口。

  python -m pipeline.run --out site/data

環境変数（すべて任意）:
  GEMINI_API_KEY      Gemini API のキー。ないときはニュースの見出しだけ集める
  GEMINI_MODEL        使うモデル（既定: gemini-3.5-flash-lite）
  NEWS_MAX_CALLS      1 回の実行で Gemini を呼ぶ回数の上限（市場概況 1＋銘柄。既定: 30）
  NEWS_MODE=reuse     Gemini を呼ばず、前回の判定を使い回す（push 時のビルド用）
  NEWS_FORCE=1        同じ日に確認済みでも Gemini を呼ぶ（手動の Run workflow）
  RUN_MODE            予約実行の種類。midday＝昼（前場の途中経過・Gemini はひとことだけ）、
                      close＝夕方（終値・Gemini なし）、news または空＝夜（ニュース確認とひとこと）
  PREV_URL            前回の latest.json の URL（判定の使い回しに使う）
"""

from __future__ import annotations

import argparse
import json
import os
import time
from datetime import datetime
from pathlib import Path

import pandas as pd
import requests

from . import analysis, events, news, prices, track, watchlist

ORDER = {"buy": 0, "caution": 1, "rise": 2, "watch": 3, "none": 4}


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
        kind = "rise" if st["signal"]["label"] == "rise" else "drop"
        old = prev_news.get(st["code"])
        if (old and old.get("by") == "gemini" and old.get("asof") == asof
                and old.get("v") == news.NEWS_VERSION and old.get("kind", "drop") == kind):
            st["news"] = old
        else:
            judge = news.judge_rise if kind == "rise" else news.judge_stock
            st["news"] = judge(g, st, market_r20, asof) if g else None
            if st["news"] is None:
                # 前回の結果があればそれを使う（毎回 RSS を叩くと断られる）。無いときだけ見出しを取りに行く
                st["news"] = old if old and old.get("kind", "drop") == kind else news.headlines(st["name"])
        n = st.get("news")
        if n and n.get("bad_news") is True and st["signal"]["label"] in ("buy", "watch"):
            st["signal"] = {
                "label": "caution",
                "reason": st["signal"]["reason"].split("。")[0] + "。Gemini が個別の悪材料を見つけた",
            }


def write_stock_intraday(out: Path, rows: list[dict], intra: dict, asof: str) -> None:
    """銘柄ごとの分足を data/intraday/<コード>.json に書く（詳細を開いたときだけ読む）。
    セクターは構成銘柄の「前の日の終値＝100」にそろえた平均。"""
    d = out / "intraday"
    d.mkdir(parents=True, exist_ok=True)
    for f in d.glob("*.json"):
        f.unlink()
    if not intra:
        return
    members: dict[str, list[str]] = {}
    for r in rows:
        members.setdefault(r["sector"], []).append(r["code"] + ".T")

    def norm(v: list) -> list:
        base = next((x for x in v if x), None)
        return [None if (x is None or not base) else x / base * 100 for x in v]

    sector_avg: dict = {}
    for h, b in intra.items():
        for sec, ts in members.items():
            cols = [norm(b[t]) for t in ts if b.get(t)]
            avg = []
            for i in range(len(b["t"])):
                xs = [c[i] for c in cols if c[i] is not None]
                avg.append(round(sum(xs) / len(xs), 3) if xs else None)
            sector_avg[(h, sec)] = avg if cols else None
    n = 0
    for r in rows:
        t = r["code"] + ".T"
        blocks = {}
        for h, b in intra.items():
            if not b.get(t):
                continue
            blocks[h] = {"interval": b["interval"], "t": b["t"], "stock": b[t],
                         "sector": sector_avg.get((h, r["sector"])), "n225": b.get(prices.N225)}
        if blocks:
            (d / f"{r['code']}.json").write_text(
                json.dumps({"asof": asof, "h": blocks}, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
            n += 1
    print(f"[intraday] 銘柄ごとの分足 {n} 件を書きました")


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
    volumes: dict = {}
    closes = prices.download_closes(tickers, volumes=volumes)
    if prices.N225 not in closes:
        raise SystemExit("日経平均が取れなかったので中止します")
    # 場中（大引け 15:30 の少し後まで）に動いたときは、今日の途中の値を「終値」として出さないように今日の分を外す
    now = pd.Timestamp.now(tz="Asia/Tokyo")
    today = pd.Timestamp(now.date())
    mode = os.environ.get("RUN_MODE", "").strip() or "news"
    if os.environ.get("NEWS_MODE") == "reuse" and now.hour * 60 + now.minute < 15 * 60 + 45:
        # 昼の回のあと、大引け前に push したときは、前場の途中経過のまま作り直す（前日の終値に戻さない）
        early = load_prev(out)
        if early.get("session") == "midday" and early.get("asof") == now.strftime("%Y-%m-%d"):
            mode = "midday"
    # 昼の回は前場の途中の値をそのまま使う（画面では「前場・途中」と出す）。それ以外は場中なら今日の分を外す
    cut = None if mode == "midday" else (today if now.hour * 60 + now.minute < 15 * 60 + 45 else None)
    if cut is not None:
        closes = {t: s[s.index < cut] for t, s in closes.items()}
        volumes = {t: s[s.index < cut] for t, s in volumes.items()}
        print(f"[prices] 場中なので {today:%Y-%m-%d} の途中の値は使いません")
    market = closes.pop(prices.N225)
    topix = closes.pop(prices.TOPIX_ETF, None)

    # 日経平均の最新日が欠けることがある（Yahoo 側の都合）。銘柄のほうが新しい日まであれば取り直す
    latest = max((s.index[-1] for s in closes.values()), default=market.index[-1])
    if market.index[-1] < latest:
        print(f"[prices] 日経平均が {market.index[-1]:%Y-%m-%d} までしかないので取り直します（銘柄は {latest:%Y-%m-%d} まで）")
        again = prices.download_closes([prices.N225]).get(prices.N225)
        if again is not None and cut is not None:
            again = again[again.index < cut]
        if again is not None and again.index[-1] >= latest:
            market = again
        else:
            market = prices.fill_recent_closes(prices.N225, market, cut)
    if topix is not None and topix.index[-1] < market.index[-1]:
        topix = prices.fill_recent_closes(prices.TOPIX_ETF, topix, cut)
    prev = load_prev(out)
    prev_asof = prev.get("asof", "")
    # 公開中のものが場中に作られた（＝途中の値）なら、それより古くなっても上書きしてよい
    gen = str(prev.get("generated_at", ""))
    prev_partial = gen[:10] == prev_asof and gen[11:16] < "15:45"
    if prev_asof and not prev_partial and market.index[-1].strftime("%Y-%m-%d") < prev_asof:
        # 古いデータで新しい結果を上書きしない（ここで止めれば、公開中のものがそのまま残る）
        raise SystemExit(
            f"日経平均の最新日 {market.index[-1]:%Y-%m-%d} が公開中の {prev_asof} より古いので中止します"
        )
    for r in rows:
        if r["code"] + ".T" not in closes:
            notes.append(f"{r['code']} {r['name']} の株価が取れませんでした（上場廃止・コード違いの可能性）")

    res = analysis.analyze(rows, closes, market, volumes)
    idx = market.index[-250:]
    asof = market.index[-1].strftime("%Y-%m-%d")
    n225 = analysis.market_block("日経平均", market, market.index)
    topix_block = analysis.market_block("TOPIX（1306 ETF）", topix, market.index) if topix is not None else None

    # 分足（1 日＝5 分足、5 日＝15 分足、20 日＝60 分足）。市場カードと銘柄詳細のチャート用。取れなくても続ける
    intraday: dict = {}
    intra_raw: dict = {}
    try:
        intra_raw = prices.download_intraday([r["code"] + ".T" for r in rows] + [prices.N225, prices.TOPIX_ETF], until=asof)
        for h, b in intra_raw.items():
            intraday[h] = {"interval": b["interval"], "t": b["t"],
                           "n225": b.get(prices.N225), "topix": b.get(prices.TOPIX_ETF)}
    except Exception as exc:  # noqa: BLE001
        print(f"[intraday] 失敗: {exc}")

    session = "midday" if mode == "midday" and asof == today.strftime("%Y-%m-%d") else "close"
    g = news.Gemini.from_env()
    if mode == "close":
        g = None  # 夕方は終値の計算だけ。ニュースは夜の回で（大引け後の発表が出そろってから）
    # 夜の予備の回: 同じ日の Gemini 確認がもう済んでいれば呼ばない（手動の Run workflow は NEWS_FORCE=1 で呼ぶ）
    if g and mode == "news" and prev.get("news_asof") == asof and not os.environ.get("NEWS_FORCE"):
        print(f"[news] {asof} の Gemini 確認は済んでいるので、今回は呼びません")
        g = None
    print(f"[mode] {mode}（{'前場の途中経過' if session == 'midday' else '終値'}）")

    # 市場概況を先に作る（銘柄の確認で呼び出し上限を使い切らないように）
    comment = prev.get("market_comment")
    # 同じ日の同じ時間帯（前場／終値）のひとことがあれば使う。夜の回は前場のひとことを書き直す
    fresh = comment and comment.get("asof") == asof and comment.get("session", "close") == session
    if mode == "close" and comment and comment.get("asof") == asof:
        fresh = True  # 夕方は昼のひとことを夜まで残す
    if not fresh:
        comment = None
        if g:
            secs = sorted(
                (s for s in res["sectors"] if s["dec"]["1"]),
                key=lambda s: s["dec"]["1"]["r"],
            )
            movers = "、".join(
                f"{s['name']} {s['dec']['1']['r'] * 100:+.1f}%" for s in (secs[:2] + secs[-2:])
            )
            comment = news.market_comment(g, asof, n225["ret"]["1"], movers, midday=session == "midday")


    # 銘柄ごとのニュース確認は夜の回だけ（昼・夕方は前回の結果を使う）
    attach_news(res["stocks"], prev, asof, n225["ret"]["20"], g if mode == "news" else None)

    # 決算発表予定日と大きな予定（取れなくても続ける）
    today = datetime.now(news.JST).date()
    try:
        earn = events.earnings(rows, prev.get("stocks", []), today)
        schedule = events.build(rows, earn, today)
    except Exception as exc:  # noqa: BLE001
        print(f"[events] 失敗: {exc}")
        earn, schedule = {s["code"]: s.get("earnings") for s in prev.get("stocks", [])}, prev.get("events", [])
    for st in res["stocks"]:
        st["earnings"] = earn.get(st["code"]) or None

    # 判定の成績表（過去 120 営業日に判定をやり直す）。成績タブを開いたときだけ読む。
    # ついでに「今の判定がいつから続いているか」を各銘柄に付ける
    tr = None
    try:
        tr = track.backtest(rows, closes, market, volumes)
    except Exception as exc:  # noqa: BLE001
        print(f"[track] 失敗: {exc}")
    since = (tr or {}).pop("since", {}) if tr else {}
    for st in res["stocks"]:
        x = since.get(st["code"])
        if x and x["label"] == st["signal"]["label"]:
            st["signal"]["since"] = x["date"]
            st["signal"]["days"] = x["days"]
            if x["capped"]:
                st["signal"]["capped"] = True

    repo = os.environ.get("GITHUB_REPOSITORY", "")
    result = {
        "generated_at": datetime.now(news.JST).strftime("%Y-%m-%dT%H:%M+09:00"),
        "asof": asof,
        "dates": [d.strftime("%Y-%m-%d") for d in idx],
        "market": {"n225": n225, "topix": topix_block, "intraday": intraday},
        "sectors": res["sectors"],
        "stocks": res["stocks"],
        "events": schedule,
        # Gemini で確認した日。予備の予約実行で二重に呼ばないための印
        "news_asof": asof if (g and g.used and mode == "news") else prev.get("news_asof"),
        # 前場の途中経過（midday）か、終値（close）か
        "session": session,
        "market_comment": comment,
        "watchlist": {
            "source": source,
            # 画面の「GitHub で開く」ボタン用
            "edit_url": f"https://github.com/{repo}/blob/main/config/watchlist.csv" if repo else None,
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
    write_stock_intraday(out, rows, intra_raw, asof)
    if tr:
        (out / "track.json").write_text(json.dumps(tr, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    (out / "codes.json").write_text(json.dumps(codes, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")

    count = {k: sum(1 for s in res["stocks"] if s["signal"]["label"] == k) for k in ORDER}
    print(f"[done] {asof} の{'前場（途中）' if session == 'midday' else '終値'} / {len(res['stocks'])} 銘柄・{len(res['sectors'])} セクター / "
          f"買い候補 {count['buy']}・要注意 {count['caution']}・初動 {count['rise']}・様子見 {count['watch']} / "
          f"Gemini {result['run']['gemini_calls']} 回 / {result['run']['elapsed_sec']} 秒")
    for n in notes:
        print(f"[note] {n}")


if __name__ == "__main__":
    main()
