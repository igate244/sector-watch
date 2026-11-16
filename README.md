# セクター観測

セクターごとに 5 銘柄ほどの株価を追い、値動きを **日経平均（地合い）・セクター・個別** に分けて見る個人用アプリ（PWA）。
地合いやセクターに**つられて下がっただけ**の銘柄を「買い候補」として拾う。

- 平日 16:30 ごろ、GitHub Actions が自動で計算して公開する（PC 不要・サーバー代 0 円）
- 下げている銘柄は、Gemini に Google 検索させて「個別の悪材料があるか」を確認する（Google AI Pro の特典クレジットで払う）
- 追う銘柄は Google スプレッドシートで、スマホから編集する
- 保有株の記録は端末の中だけ（外には出さない）。楽天証券の取引履歴 CSV をそのまま取り込める

設計の考え方・計算式・判定の条件は [docs/DESIGN.md](docs/DESIGN.md)。

## しくみ

```
【平日 16:30 自動】GitHub Actions
   スプレッドシートから銘柄リストを読む
   → 株価（yfinance）を取る → 日経平均・セクター・個別に分解 → 買い候補／要注意を判定
   → 下げている銘柄は悪材料、初動候補は好材料を Gemini＋Google 検索で確認（最大 29 件）
   → 結果（data/latest.json）と画面を GitHub Pages に公開
        ↓
【スマホ】ホーム画面のアイコンから開く
```

## 最初の設定（1 回だけ）

### 1. GitHub にリポジトリを作って送る
1. GitHub で **Public** のリポジトリ `sector-watch` を作る（README などは付けない）
2. PC でこのフォルダから送る（ここだけ PC。以降はスマホでよい）
   ```
   git push -u origin main
   ```
3. リポジトリの **Settings → Pages → Source** を **GitHub Actions** にする
4. **Actions** タブ → `update` → **Run workflow**。数分で緑になれば
   `https://igate244.github.io/sector-watch/` が開ける

ここまでで動く（銘柄はリポジトリ内の予備の一覧、ニュースは見出しだけ）。

### 2. 銘柄リストをスプレッドシートにする
Google ドライブに「セクター観測 銘柄リスト」を作ってある。

1. スプレッドシートの共有を **「リンクを知っている全員」「閲覧者」** にする（スマホのアプリでもできる。「ウェブに公開」はスマホにない）
2. GitHub の **Settings → Secrets and variables → Actions → Variables** に追加（設定済み）
   - `WATCHLIST_CSV_URL` = `https://docs.google.com/spreadsheets/d/<ID>/export?format=csv`
     （`gid=` は付けない。付けると、番号が違ったときに読めなくなる。いちばん左のシートが読まれる）
   - `WATCHLIST_EDIT_URL` = スプレッドシートの普段の URL（アプリの「スプレッドシートを開く」ボタン用）

**注意**: このリストとメモ欄は公開ページに載る（URL を知っていれば誰でも見える）。保有していることなど、
知られたくないことはメモに書かない。保有はアプリの「保有」タブ（端末の中だけ）で管理する。

列は `セクター, コード, 銘柄名, メモ`。銘柄名は空でもよい（自動で埋まる）。行を足せばセクターも銘柄も増やせる。

### 3. Gemini（Google 検索つきのニュース確認）を有効にする
Google AI Pro には毎月 $10 分の Google Cloud クレジットが付く。それで Gemini API を払う。

1. https://developers.google.com/program/my-benefits で特典を有効化し、クレジットを請求先アカウントに適用する
2. https://aistudio.google.com/apikey で API キーを作る（クレジットを適用した請求先アカウントのプロジェクトで）
3. **予算アラートを必ず設定する**: Google Cloud コンソール → お支払い → 予算とアラート → 月 $10 で通知
4. GitHub の **Secrets**（Variables ではない）に `GEMINI_API_KEY` を追加

使う量の目安: 1 日最大 30 回（下げている銘柄・初動候補 29 件＋市場概況 1 件）× 営業日 22 日 ＝ 月 660 回ほど。
Google 検索は月 5,000 回まで無料。残りはごく少ないトークン代で、クレジットの範囲に収まる見込み。

使うモデルを変えたいときは Variables に `GEMINI_MODEL`（既定 `gemini-3.5-flash-lite`）、
件数の上限は `NEWS_MAX_CALLS`（既定 30）。

### 4.（任意）保有の記録を Google ドライブにバックアップする
reading-log と同じ OAuth クライアント ID を使い回せる。

1. Google Cloud Console → 認証情報 → reading-log の OAuth クライアント ID を開き、
   「承認済みの JavaScript 生成元」に `https://igate244.github.io` を追加
2. GitHub の Variables に `GOOGLE_CLIENT_ID` を追加

未設定でも、設定画面から JSON の書き出し・読み込みはできる。

### 5. スマホに入れる
`https://igate244.github.io/sector-watch/` を開いて「ホーム画面に追加」。

## スマホだけで回す

| やりたいこと | やりかた |
|---|---|
| 追う銘柄・セクターを変える | スプレッドシートアプリで編集 → 次の計算から反映 |
| すぐ計算し直す | アプリの設定 →「今すぐ再計算」→ Run workflow |
| 判定の厳しさを変える | GitHub で `pipeline/analysis.py` の上の方の値を直して commit（push で自動公開） |
| 画面を直す | GitHub で `web/src/` を直して commit。型エラーがあれば Actions が赤くなり、公開されない |
| 保有を記録する | アプリの「保有」→「＋ 記録」、または楽天証券の取引履歴 CSV を取り込む |

60 日間コミットがないと GitHub が定期実行を止めるので、45 日ごとに自動で空コミットしている。

## PC で動かすとき

```bash
python -m venv .venv && .venv/Scripts/pip install -r requirements.txt
.venv/Scripts/python -m pipeline.test_analysis          # 判定のテスト
.venv/Scripts/python -m pipeline.run --out web/public/data   # 実データで計算（キーがなければニュースは見出しだけ）
cd web && npm install && npm run build && npm run preview
# → http://localhost:4173/sector-watch/
```

## 構成

```
pipeline/           毎日の計算（Python）
  run.py            全体の流れ・latest.json の書き出し
  watchlist.py      銘柄リスト（スプレッドシート / 予備の CSV）
  prices.py         株価（yfinance）と銘柄名の一覧（JPX）
  analysis.py       要因分解と判定 ← 判定の閾値はここの先頭
  news.py           Gemini＋Google 検索 / Google ニュース RSS
  test_analysis.py  合成データでのテスト
config/watchlist.csv   スプレッドシートが読めないときの予備
config/tickers.csv     JPX が読めないときの銘柄名の予備
web/                画面（React + TypeScript + Vite + PWA）
docs/DESIGN.md      設計書
.github/workflows/update.yml   毎日の自動実行と公開
```

株価は Yahoo Finance（yfinance）、銘柄一覧は JPX、ニュースは Google 検索／Google ニュース。
無料データなので欠けたり遅れたりすることがある。投資助言ではなく、自分で判断するための材料。
