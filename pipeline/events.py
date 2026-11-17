"""相場の予定（大きなイベント・SQ・決算発表予定日）。

- config/events.csv: 手で書く大きな予定（FOMC・日銀・米雇用統計・CPI など）
- SQ: 毎月第 2 金曜（3・6・9・12 月はメジャー SQ）を自動で計算
- 決算: JPX「決算発表予定日」の Excel（期末の翌月上旬に掲載、随時更新）から、銘柄リストの銘柄だけ拾う。
  過去に拾った日付は前回の latest.json から引き継ぐ（Excel から消えても前回の決算日が分かるように）
"""
from __future__ import annotations

import csv
import io
import re
from datetime import date, datetime, timedelta
from pathlib import Path

import pandas as pd
import requests

ROOT = Path(__file__).resolve().parent.parent
EVENTS = ROOT / "config" / "events.csv"
JPX_PAGE = "https://www.jpx.co.jp/listing/event-schedules/financial-announcement/index.html"
UA = {"User-Agent": "Mozilla/5.0 (sector-watch)"}
HORIZON_DAYS = 120  # 何日先まで出すか


def load_manual(today: date) -> list[dict]:
    out = []
    text = EVENTS.read_text(encoding="utf-8-sig")
    lines = [l for l in text.splitlines() if l.strip() and not l.startswith("#")]
    for r in csv.DictReader(io.StringIO("\n".join(lines))):
        try:
            d = date.fromisoformat(r["日付"].strip())
        except (KeyError, ValueError):
            continue
        if today - timedelta(days=1) <= d <= today + timedelta(days=HORIZON_DAYS):
            out.append({"date": d.isoformat(), "time": r.get("時刻", "").strip(), "region": r.get("地域", "").strip(),
                        "level": r.get("重要度", "中").strip() or "中", "title": r.get("名前", "").strip(),
                        "memo": r.get("メモ", "").strip(), "kind": "macro"})
    return out


def sq_dates(today: date) -> list[dict]:
    out = []
    y, m = today.year, today.month
    for _ in range(5):
        first = date(y, m, 1)
        fri = first + timedelta(days=(4 - first.weekday()) % 7 + 7)  # 第 2 金曜
        if today - timedelta(days=1) <= fri <= today + timedelta(days=HORIZON_DAYS):
            major = m in (3, 6, 9, 12)
            out.append({"date": fri.isoformat(), "time": "寄付", "region": "日本", "level": "大" if major else "中",
                        "title": "メジャー SQ（先物・オプション）" if major else "SQ（オプション）",
                        "memo": "祝日のときは前の営業日", "kind": "sq"})
        m += 1
        if m > 12:
            y, m = y + 1, 1
    return out


def _parse_date(v) -> str | None:
    if v is None or (isinstance(v, float) and pd.isna(v)):
        return None
    if isinstance(v, (datetime, pd.Timestamp)):
        return v.strftime("%Y-%m-%d")
    if isinstance(v, date):
        return v.isoformat()
    s = str(v).strip()
    m = re.search(r"(\d{4})[/\-年.](\d{1,2})[/\-月.](\d{1,2})", s)
    return f"{int(m.group(1)):04d}-{int(m.group(2)):02d}-{int(m.group(3)):02d}" if m else None


def parse_kessan_xlsx(content: bytes) -> dict[str, dict]:
    """JPX の決算発表予定日 Excel を読む。戻り値は {コード4桁: {date, kind, period}}。
    列の並びが変わっても読めるよう、見出し行を探して列名で拾う。"""
    out: dict[str, dict] = {}
    sheets = pd.read_excel(io.BytesIO(content), sheet_name=None, header=None, dtype=object)
    for df in sheets.values():
        head_row = None
        for i in range(min(len(df), 30)):
            cells = [str(x) for x in df.iloc[i].tolist()]
            if any("コード" in c for c in cells) and any("予定日" in c or "発表日" in c for c in cells):
                head_row = i
                break
        if head_row is None:
            continue
        cols = [str(x).replace("\n", "") for x in df.iloc[head_row].tolist()]
        def find(*keys):
            for j, c in enumerate(cols):
                if any(k in c for k in keys):
                    return j
            return None
        jc, jd = find("コード"), find("予定日", "発表日")
        jk, jp = find("種別", "四半期"), find("決算期")
        for _, row in df.iloc[head_row + 1:].iterrows():
            code = str(row.iloc[jc]).strip()
            code = re.sub(r"\.0$", "", code)
            if not re.fullmatch(r"[0-9A-Z]{4,5}", code):
                continue
            code = code[:4]
            d = _parse_date(row.iloc[jd])
            if not d:
                continue
            kind = str(row.iloc[jk]).strip() if jk is not None and pd.notna(row.iloc[jk]) else ""
            period = str(row.iloc[jp]).strip() if jp is not None and pd.notna(row.iloc[jp]) else ""
            out[code] = {"date": d, "kind": kind, "period": period}
    return out


def fetch_jpx_kessan() -> dict[str, dict]:
    """JPX のページから Excel のリンクを探して全部読む。取れなければ空。"""
    try:
        html = requests.get(JPX_PAGE, headers=UA, timeout=30).text
    except Exception as exc:  # noqa: BLE001
        print(f"[events] JPX のページを読めませんでした: {exc}")
        return {}
    links = sorted(set(re.findall(r'href="([^"]+\.xlsx)"', html)))
    out: dict[str, dict] = {}
    for href in links:
        url = href if href.startswith("http") else "https://www.jpx.co.jp" + href
        try:
            r = requests.get(url, headers=UA, timeout=60)
            r.raise_for_status()
            got = parse_kessan_xlsx(r.content)
            out.update(got)
            print(f"[events] 決算発表予定日 {url.rsplit('/', 1)[-1]}: {len(got)} 社")
        except Exception as exc:  # noqa: BLE001
            print(f"[events] {url} を読めませんでした: {exc}")
    return out


def earnings(rows: list[dict], prev_stocks: list[dict], today: date) -> dict[str, dict]:
    """銘柄ごとの {last, next, kind}。next が無ければ last＋約 3 ヶ月を目安（next_est=True）にする。"""
    jpx = fetch_jpx_kessan()
    prev = {s["code"]: s.get("earnings") or {} for s in prev_stocks}
    out: dict[str, dict] = {}
    for r in rows:
        code = r["code"]
        known = dict(prev.get(code, {}))
        # 前回の next は JPX で確かめた日付（confirmed）だけ引き継ぐ。目安や出どころ不明は捨てて計算し直す
        if known.pop("next_est", None) or not known.get("confirmed"):
            known.pop("next", None)
            known.pop("kind", None)
        hit = jpx.get(code)
        if hit:
            if hit["date"] >= today.isoformat():
                known["next"] = hit["date"]
                known["kind"] = hit["kind"]
                known["confirmed"] = True
            else:
                known["last"] = max(known.get("last") or "", hit["date"])
        # 予定日が過ぎたら「前回」に回す
        if known.get("next") and known["next"] < today.isoformat():
            known["last"] = max(known.get("last") or "", known["next"])
            known.pop("next")
            known.pop("kind", None)
        if not known.get("next"):
            known.pop("confirmed", None)
        if not known.get("next") and known.get("last"):
            est = date.fromisoformat(known["last"]) + timedelta(days=91)
            while est < today:
                est += timedelta(days=91)
            known["next"] = est.isoformat()
            known["next_est"] = True
        out[code] = {k: v for k, v in known.items() if v}
    n_next = sum(1 for v in out.values() if v.get("next") and not v.get("next_est"))
    print(f"[events] 決算: 予定日あり {n_next} 銘柄 / 目安 {sum(1 for v in out.values() if v.get('next_est'))} 銘柄")
    return out


def build(rows: list[dict], earn: dict[str, dict], today: date) -> list[dict]:
    """画面の「予定」に出す一覧（日付順）。決算は予定日が決まっているものだけ。"""
    ev = load_manual(today) + sq_dates(today)
    names = {r["code"]: r["name"] for r in rows}
    for code, e in earn.items():
        if e.get("next") and not e.get("next_est"):
            d = date.fromisoformat(e["next"])
            if today <= d <= today + timedelta(days=HORIZON_DAYS):
                ev.append({"date": e["next"], "time": "", "region": "日本", "level": "決算",
                           "title": f"{names.get(code, code)} 決算", "memo": e.get("kind", ""),
                           "kind": "earnings", "code": code})
    return sorted(ev, key=lambda x: (x["date"], {"macro": 0, "sq": 1, "earnings": 2}[x["kind"]]))
