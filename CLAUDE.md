# セクター観測 — Claude 向けの決まりごと

持ち主はスマホだけで開発している（PC は使わない前提）。Claude Code（クラウド）から頼まれて直すことが多い。

## 会話
- 返事・途中経過・コミットメッセージは**すべて日本語**
- 説明は短く。専門用語は最低限にして、何が変わるか（画面で何が見えるか）を先に言う

## 公開の仕組み（大事）
- **main に push した瞬間に公開される**（GitHub Actions → GitHub Pages）。push 時は Gemini を呼ばず前回の判定を使い回す
- 平日 3 回自動で計算（JST）: 11:43 昼＝前場の途中経過（Gemini はひとことだけ）／16:41 夕方＝終値（Gemini なし）／19:13 夜＝ニュース確認。**起こしているのは cron-job.org**（GitHub の schedule は遅れ・飛びが多くてやめた）。workflow_dispatch の入力 `mode`（midday/close/news）と `force` で種類を渡す。手動の Run workflow は既定で夜＋Gemini 呼び直し
- 型エラー・テスト失敗があると Actions が赤くなり、公開されない（壊れたものは出ない）
- 大きめの変更はブランチ＋PR にして、持ち主が GitHub アプリでマージする。小さな修正は頼まれれば main に直接でよい

## 改定のたびに（必ず）
- `web/src/lib/changelog.ts` の一番上に 1 件足し、`web/package.json` の version を同じ番号にする（設定画面の「バージョンと改定履歴」に出る）
- 番号: 機能を足したら真ん中（0.18 → 0.19）、小さな直し・不具合の修正は最後（0.18.0 → 0.18.1）。銘柄リスト・予定の追記だけなら上げなくてよい
- 文は持ち主向けに短く（何が変わったか）

## push の前に必ずやること
```bash
pip install -r requirements.txt
python -m pipeline.test_analysis                 # 判定のテスト
python -m pipeline.run --out web/public/data     # 実データで計算（キーなしなら Gemini は呼ばれない）
cd web && npm ci && npm run build                # 型チェック込みのビルド
```
クラウド環境から Yahoo Finance や JPX に届かず `pipeline.run` が失敗するときは、公開中のデータを借りて画面だけ確認する:
```bash
mkdir -p web/public/data
curl -sL https://igate244.github.io/sector-watch/data/latest.json -o web/public/data/latest.json
curl -sL https://igate244.github.io/sector-watch/data/codes.json  -o web/public/data/codes.json
```
（`web/public/data/` は .gitignore 済み。コミットしない）

画面を変えたら `npm run preview`（http://localhost:4173/sector-watch/）をスマホ幅（390px）で開き、
可能ならスクリーンショットを撮って持ち主に見せる。ライト・ダーク両方。

## 守ること
- **保有株・取引の記録は端末内（IndexedDB）だけ。** リポジトリ・latest.json・銘柄リストに保有情報を入れない
  （このリポジトリと公開ページは誰でも見られる）
- Gemini の呼び出し回数を増やす変更は、費用の見込みを持ち主に伝えてから。上限は `NEWS_MAX_CALLS`（既定 30）。これとは別に、夜の「Gemini の見立て」（`pipeline/picks.py`）が gemini-4-hydrogen を 1 晩 11 回（買い候補上位 10＋上位 3 選び）。費用は Google AI Pro の Cloud クレジット（月 $10）から
- `web/src/lib/db.ts` の `version(n)` は書き換えない。スキーマ変更は新しい version を追記する
- 色: 上昇＝赤（`--up`）、下落＝青（`--down`）。色だけに頼らず ▲▼ か ± を必ず付ける
- チャートの線は 3 本まで、軸は 1 本。凡例と線の端のラベルを付ける
- 判定の閾値は `pipeline/analysis.py` の先頭。変えたら `docs/DESIGN.md` の表も直す

## 構成
- `pipeline/` 計算（Python）。`analysis.py` 要因分解と判定、`news.py` Gemini＋Google 検索、`run.py` 全体
- `web/` 画面（React + TypeScript + Vite + PWA）。`src/screens/` が各画面、`src/components/` が部品
- `docs/DESIGN.md` 設計書（計算式・判定条件・データの形）
- 大きな予定は `config/events.csv`（日本時間）。頼まれたら追記して main に push してよい
- 銘柄リストの本体は `config/watchlist.csv`（列: セクター, コード, 銘柄名, メモ）。頼まれたら直して main に push してよい（push で即再計算・公開）。同じコードは 1 つのセクターにしか入れられない
