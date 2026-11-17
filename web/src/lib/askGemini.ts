import type { MarketEvent } from './data';

/**
 * 予定（イベント・決算）を Gemini に聞くための質問文を作り、クリップボードに入れて Gemini を開く。
 * Gemini は URL で質問文を渡す公式の方法がないので「コピー → 開く → 貼り付けて送信」の形にする。
 */

const GEMINI_URL = 'https://gemini.google.com/app';
const WD = ['日', '月', '火', '水', '木', '金', '土'];

function dateLabel(iso: string): string {
  const d = new Date(iso + 'T00:00:00');
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日（${WD[d.getDay()]}）`;
}

/** 誰に向けて・どう答えてほしいか（全部の質問に共通） */
const STYLE = [
  '株を始めたばかりの人にもわかるように、やさしい日本語で答えてください。',
  '専門用語を使うときは、かっこで一言の説明を付けてください（例: 利上げ（政策金利を上げること））。',
  '最新の情報は Google 検索で確認し、いつ時点の情報かも書いてください。',
  '最後に「3 行まとめ」を付けてください。売買をすすめる言い方はしないでください。',
].join('\n');

function context(sectors: string[], held: string[]): string {
  const lines = [`私が日本株で見ているセクター: ${sectors.join('、')}`];
  if (held.length) lines.push(`私が持っている銘柄: ${held.join('、')}`);
  return lines.join('\n');
}

export function promptForEvent(e: MarketEvent, sectors: string[], held: string[]): string {
  const when = `${dateLabel(e.date)}${e.time ? ` ${e.time}（日本時間）` : ''}`;
  if (e.kind === 'sq') {
    return [
      `${when} に日本の ${e.title} があります。`,
      '',
      '次のことを教えてください。',
      '1. SQ とは何か、その日の朝に何が起きるのか',
      '2. SQ の前後で株価が荒れやすいと言われる理由と、どのくらい動くことが多いか',
      '3. 日経平均やよく売買される大型株への影響の出かた',
      '4. ふつうの個人投資家が気をつけること',
      '',
      context(sectors, held),
      '',
      STYLE,
    ].join('\n');
  }
  return [
    `${when} に「${e.title}」${e.region ? `（${e.region}）` : ''}があります。${e.memo ? `（${e.memo}）` : ''}`,
    '',
    '次のことを教えてください。',
    '1. これは何の発表・イベントで、なぜ株式市場が注目するのか',
    '2. 今回の市場予想（わかれば数字も）と、前回の結果・そのときの相場の反応',
    '3. 結果が予想より「良い／悪い」とき、それぞれ日本株・為替（円相場）・米国株がどう動きやすいか',
    '4. 私が見ているセクターのうち、影響を受けやすいものとその理由（強く受ける順に）',
    held.length ? '5. 私が持っている銘柄への影響の考え方' : '5. 影響を受けやすい代表的な日本の銘柄',
    '6. 当日までにチェックしておくとよいこと',
    '',
    context(sectors, held),
    '',
    STYLE,
  ].join('\n');
}

export function promptForEarnings(date: string, names: { name: string; code?: string }[], sectors: string[], held: string[]): string {
  const list = names.map((n) => (n.code ? `${n.name}（${n.code}）` : n.name)).join('、');
  return [
    `${dateLabel(date)} に、次の会社の決算発表があります: ${list}`,
    '',
    '会社ごとに次のことを教えてください。',
    '1. どんな会社で、今回の決算で市場が特に注目しているポイント',
    '2. 会社の業績予想と、市場予想（コンセンサス）の比較。上方修正・下方修正の可能性',
    '3. 前回の決算の内容と、そのときの株価の反応',
    '4. 結果が良い／悪いとき、同じセクターのほかの銘柄や関連する会社に出そうな影響',
    '',
    context(sectors, held),
    '',
    STYLE,
  ].join('\n');
}

/** 押した瞬間のうちにコピーする（あとからだと、Gemini の画面に切り替わって失敗することがある） */
function copyNow(text: string): boolean {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly', '');
  ta.style.position = 'fixed';
  ta.style.top = '0';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  ta.setSelectionRange(0, text.length);
  let ok = false;
  try {
    ok = document.execCommand('copy');
  } catch {
    ok = false;
  }
  ta.remove();
  if (!ok && navigator.clipboard) {
    navigator.clipboard.writeText(text).catch(() => undefined);
    ok = true;
  }
  return ok;
}

export function toast(msg: string) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.setAttribute('role', 'status');
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.classList.add('out'), 2600);
  setTimeout(() => el.remove(), 3000);
}

/** 押した瞬間にコピーして Gemini を開く（ボタンの onClick から直接呼ぶこと） */
export function askGemini(prompt: string) {
  const ok = copyNow(prompt);
  toast(ok ? '質問をコピーしました。Gemini の入力欄に貼り付けて送信してください' : 'コピーできませんでした');
  window.open(GEMINI_URL, '_blank', 'noopener');
}
