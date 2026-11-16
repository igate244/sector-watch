import { exportAll } from './db';

/**
 * Google ドライブへのバックアップ（reading-log と同じ考え方）。
 *
 * - スコープは drive.file だけ。このアプリが作ったファイルしか見えない
 * - 置き場所はマイドライブ直下の「セクター観測」フォルダ（見える場所。アプリが壊れても自分で持ち出せる）
 * - サーバーを持たないので、GIS のトークンクライアント（1 時間で切れる）を使う
 * - Google の同意画面はチェックボックスが初期状態で外れている。ドライブの許可が実際に
 *   取れたかを必ず確かめ、取れていなければ保存しない（ログインできたのに 403 になる罠の対策）
 */

const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID ?? '';
const SCOPE = 'https://www.googleapis.com/auth/drive.file';
const FOLDER = 'セクター観測';
const KEEP = 10;
const TOKEN_KEY = 'sw.driveToken';
const LAST_KEY = 'sw.driveLast';

export const driveAvailable = Boolean(CLIENT_ID);

interface TokenResponse {
  access_token: string;
  expires_in: number;
  scope: string;
  error?: string;
}
interface TokenClient {
  requestAccessToken(o?: { prompt?: string }): void;
}
declare global {
  interface Window {
    google?: {
      accounts: {
        oauth2: {
          initTokenClient(o: {
            client_id: string;
            scope: string;
            callback: (r: TokenResponse) => void;
            error_callback?: (e: { type: string }) => void;
          }): TokenClient;
          hasGrantedAllScopes(r: TokenResponse, ...scopes: string[]): boolean;
        };
      };
    };
  }
}

let gis: Promise<void> | null = null;
function loadGis(): Promise<void> {
  gis ??= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => {
      gis = null;
      reject(new Error('Google のログイン部品を読み込めませんでした'));
    };
    document.head.appendChild(s);
  });
  return gis;
}

function cachedToken(): string | null {
  try {
    const t = JSON.parse(localStorage.getItem(TOKEN_KEY) ?? 'null') as { token: string; exp: number } | null;
    return t && t.exp > Date.now() + 60_000 ? t.token : null;
  } catch {
    return null;
  }
}

export function isConnected(): boolean {
  return cachedToken() !== null;
}

/** トークンを得る。interactive=false なら、手元にあるときだけ返す（ポップアップは出さない） */
export async function getToken(interactive: boolean): Promise<string | null> {
  const cached = cachedToken();
  if (cached || !interactive) return cached;
  if (!CLIENT_ID) throw new Error('Google 連携が設定されていません');
  await loadGis();
  return new Promise((resolve, reject) => {
    const client = window.google!.accounts.oauth2.initTokenClient({
      client_id: CLIENT_ID,
      scope: SCOPE,
      callback: (r) => {
        if (r.error) return reject(new Error(r.error));
        if (!window.google!.accounts.oauth2.hasGrantedAllScopes(r, SCOPE)) {
          return reject(new Error('ドライブへのアクセスが許可されていません。同意画面でドライブのチェックを入れてください'));
        }
        localStorage.setItem(TOKEN_KEY, JSON.stringify({ token: r.access_token, exp: Date.now() + r.expires_in * 1000 }));
        resolve(r.access_token);
      },
      error_callback: (e) => reject(new Error(e.type === 'popup_closed' ? 'ログインを中断しました' : e.type)),
    });
    // 不完全な許可を使い回させないよう、同意画面は毎回出す
    client.requestAccessToken({ prompt: 'consent' });
  });
}

export function disconnect(): void {
  localStorage.removeItem(TOKEN_KEY);
}

async function api(token: string, path: string, init: RequestInit = {}): Promise<Response> {
  const res = await fetch(`https://www.googleapis.com${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, ...(init.headers ?? {}) },
  });
  if (res.status === 401) {
    disconnect();
    throw new Error('Google の接続が切れました。もう一度接続してください');
  }
  if (!res.ok) throw new Error(`ドライブの操作に失敗しました（${res.status}）`);
  return res;
}

async function folderId(token: string): Promise<string> {
  const q = encodeURIComponent(`name='${FOLDER}' and mimeType='application/vnd.google-apps.folder' and trashed=false`);
  const found = (await (await api(token, `/drive/v3/files?q=${q}&fields=files(id)`)).json()) as { files: { id: string }[] };
  if (found.files[0]) return found.files[0].id;
  const made = await api(token, '/drive/v3/files?fields=id', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: FOLDER, mimeType: 'application/vnd.google-apps.folder' }),
  });
  return ((await made.json()) as { id: string }).id;
}

export interface DriveFile {
  id: string;
  name: string;
  createdTime: string;
}

export async function listBackups(token: string): Promise<DriveFile[]> {
  const folder = await folderId(token);
  const q = encodeURIComponent(`'${folder}' in parents and trashed=false`);
  const res = await api(token, `/drive/v3/files?q=${q}&orderBy=createdTime desc&fields=files(id,name,createdTime)&pageSize=50`);
  return ((await res.json()) as { files: DriveFile[] }).files;
}

export async function backupNow(token: string): Promise<void> {
  const folder = await folderId(token);
  const data = await exportAll();
  const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');
  const boundary = 'sw' + Math.random().toString(36).slice(2);
  const body =
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n` +
    JSON.stringify({ name: `sector-watch_${stamp}.json`, parents: [folder] }) +
    `\r\n--${boundary}\r\nContent-Type: application/json\r\n\r\n` +
    JSON.stringify(data) +
    `\r\n--${boundary}--`;
  await api(token, '/upload/drive/v3/files?uploadType=multipart', {
    method: 'POST',
    headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
    body,
  });
  // 古い世代を消す
  const files = await listBackups(token);
  for (const f of files.slice(KEEP)) await api(token, `/drive/v3/files/${f.id}`, { method: 'DELETE' });
  localStorage.setItem(LAST_KEY, new Date().toISOString());
}

export async function download(token: string, id: string): Promise<unknown> {
  return (await api(token, `/drive/v3/files/${id}?alt=media`)).json();
}

export function lastBackupAt(): string | null {
  return localStorage.getItem(LAST_KEY);
}

/** 起動時に呼ぶ。接続済みで、前回から 12 時間以上あいていれば裏でバックアップする */
export async function autoBackup(): Promise<void> {
  const last = lastBackupAt();
  if (last && Date.now() - new Date(last).getTime() < 12 * 3600_000) return;
  const token = await getToken(false);
  if (!token) return;
  try {
    await backupNow(token);
  } catch (e) {
    console.warn('[drive] 自動バックアップに失敗', e);
  }
}
