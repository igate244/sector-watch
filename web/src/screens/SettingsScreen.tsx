import { useRef, useState } from 'react';
import type { DataState } from '../lib/data';
import { exportAll, importAll } from '../lib/db';
import * as drive from '../lib/drive';
import { Card, TopBar } from '../components/ui';
import type { Nav } from '../App';
import { CHANGELOG, VERSION } from '../lib/changelog';

export default function SettingsScreen({ state, nav }: { state: DataState; nav: Nav }) {
  const d = state.data;
  return (
    <>
      <TopBar title="設定" onBack={nav.back} />

      <Card title="銘柄リスト">
        <p className="small">
          置き場所: <strong>GitHub の config/watchlist.csv</strong>
          <br />
          <span className="muted">
            {d ? `${d.sectors.length} セクター・${d.stocks.length} 銘柄` : ''}。変えたいときは Claude に「◯◯を足して／外して」と頼めば直して反映する。
            自分で直すなら GitHub アプリでこのファイルを編集して commit（すぐ再計算される）。
          </span>
        </p>
        {d?.watchlist.edit_url && (
          <a className="btn" href={d.watchlist.edit_url} target="_blank" rel="noreferrer">
            GitHub で開く
          </a>
        )}
        {!!d?.watchlist.notes.length && (
          <ul className="warn-text small">
            {d.watchlist.notes.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        )}
      </Card>

      <Card title="計算">
        {d && (
          <p className="small">
            最終計算 {d.generated_at.replace('T', ' ').slice(0, 16)}（{d.run.elapsed_sec} 秒）
            <br />
            Gemini の呼び出し {d.run.gemini_calls} 回
            {!!d.run.gemini_errors.length && <span className="warn-text"><br />Gemini のエラー: {d.run.gemini_errors[0]}</span>}
          </p>
        )}
        {d?.run.workflow_url && (
          <a className="btn" href={d.run.workflow_url} target="_blank" rel="noreferrer">
            今すぐ再計算（GitHub で Run workflow）
          </a>
        )}
      </Card>

      <Backup />

      <Card title="見かた">
        <div className="help small">
          <p>
            <strong>内訳</strong>: 騰落率を「日経平均の分」「セクターの分」「個別の分」に分けたもの。3 つを足すと騰落率になる。
          </p>
          <p>
            日経平均の分 ＝ β × 日経平均の騰落率。β はその銘柄が日経平均にどれだけ連動するか（直近 1 年）。
            <br />
            セクターの分 ＝ 同じセクターの他の銘柄（中央値）の動きから、日経平均の分を引いたもの。
            <br />
            個別の分 ＝ 残り。決算や材料など、その会社だけの理由。
          </p>
          <p>
            <strong>◎ 買い候補</strong>: 20 日で −6% 以上下げ、その大半が日経平均とセクターにつられたもの（個別の分が −4% より小さい）。
            Gemini が個別の悪材料を見つけた銘柄は外す。
          </p>
          <p>
            <strong>⚠ 要注意</strong>: 個別の分が −5% 以下で、下げの主因になっているもの。
          </p>
          <p>
            <strong>↗ 初動候補</strong>: 上がり始めの形。50 日線・200 日線より上の上昇トレンドで、
            もみ合いで値幅が縮んだあと（ボリンジャーバンド幅が過去 120 日の下位 25%）、直近 3 日で 60 日高値を抜けたもの。
            50 日線から 15% 以上離れた「走った後」は外す。出来高（50 日平均の 1.5 倍以上）・日経平均より強い・セクターも強い、は参考として表示。
            Gemini が上昇のきっかけになる好材料を調べる。だましも多いので、抜けた高値を割ったら撤退が前提。
          </p>
          <p className="muted">判断材料であって投資助言ではない。株価は東証の終値（夜間取引は含まない）。</p>
        </div>
      </Card>

      <Changelog />
    </>
  );
}

function Backup() {
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [files, setFiles] = useState<drive.DriveFile[] | null>(null);
  const [connected, setConnected] = useState(drive.isConnected());
  const input = useRef<HTMLInputElement>(null);

  const run = async (fn: () => Promise<string | void>) => {
    setBusy(true);
    setMsg('');
    try {
      const m = await fn();
      if (m) setMsg(m);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setConnected(drive.isConnected());
      setBusy(false);
    }
  };

  const exportJson = () =>
    run(async () => {
      const data = await exportAll();
      const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `sector-watch_${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
    });

  const restore = (data: unknown) =>
    run(async () => {
      const replace = window.confirm('今の記録を消して置き換えますか？\n「キャンセル」なら、足りない記録だけ足します。');
      const n = await importAll(data, replace ? 'replace' : 'merge');
      return `${n} 件を復元しました`;
    });

  const last = drive.lastBackupAt();

  return (
    <Card title="バックアップ（保有の記録）">
      <p className="muted small">保有の記録はこの端末の中にだけある。ブラウザのデータを消すと消えるので、外にも置いておく。</p>
      {drive.driveAvailable ? (
        <>
          <p className="small">
            Google ドライブ: {connected ? '接続中' : '未接続'}
            {last && <span className="muted">・前回 {new Date(last).toLocaleString('ja-JP')}</span>}
          </p>
          <div className="btn-row">
            <button
              type="button"
              className="btn primary"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  const t = await drive.getToken(true);
                  if (!t) return;
                  await drive.backupNow(t);
                  return 'ドライブの「セクター観測」フォルダに保存しました';
                })
              }
            >
              {connected ? '今すぐバックアップ' : '接続してバックアップ'}
            </button>
            <button
              type="button"
              className="btn"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  const t = await drive.getToken(true);
                  if (t) setFiles(await drive.listBackups(t));
                })
              }
            >
              ドライブから復元
            </button>
          </div>
          {files && (
            <ul className="preview-list small">
              {!files.length && <li>バックアップはまだありません</li>}
              {files.map((f) => (
                <li key={f.id}>
                  <button
                    type="button"
                    className="link-btn"
                    onClick={() =>
                      void run(async () => {
                        const t = await drive.getToken(true);
                        if (t) await restore(await drive.download(t, f.id));
                      })
                    }
                  >
                    {new Date(f.createdTime).toLocaleString('ja-JP')}
                  </button>
                </li>
              ))}
            </ul>
          )}
          <p className="muted small">接続中は、起動時に前回から 12 時間以上あいていれば自動でバックアップする。</p>
        </>
      ) : (
        <p className="muted small">Google ドライブ連携は未設定（README の手順を参照）。下の JSON 書き出しは使える。</p>
      )}
      <div className="btn-row">
        <button type="button" className="btn" disabled={busy} onClick={() => void exportJson()}>
          JSON に書き出す
        </button>
        <button type="button" className="btn" disabled={busy} onClick={() => input.current?.click()}>
          JSON から読み込む
        </button>
      </div>
      <input
        ref={input}
        type="file"
        accept=".json,application/json"
        hidden
        onChange={async (e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (f) await restore(JSON.parse(await f.text()));
        }}
      />
      {msg && <p className="small">{msg}</p>}
    </Card>
  );
}

/** バージョンと改定履歴。新しい順に 5 つ、「すべて見る」で全部 */
function Changelog() {
  const [all, setAll] = useState(false);
  const list = all ? CHANGELOG : CHANGELOG.slice(0, 5);
  const md = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;
  return (
    <Card title="バージョンと改定履歴" action={<span className="num ver">v{VERSION}</span>}>
      <ol className="changelog">
        {list.map((r) => (
          <li key={r.v}>
            <span className="cl-v num">{r.v}</span>
            <span className="cl-d num">{md(r.date)}</span>
            <span className="cl-items">
              {r.items.map((t) => (
                <span key={t}>{t}</span>
              ))}
            </span>
          </li>
        ))}
      </ol>
      {CHANGELOG.length > 5 && (
        <button type="button" className="link-btn block" onClick={() => setAll(!all)}>
          {all ? '閉じる' : `すべて見る（${CHANGELOG.length} 件）`}
        </button>
      )}
    </Card>
  );
}
