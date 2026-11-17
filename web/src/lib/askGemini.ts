import type { MarketEvent, Stock } from './data';

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

/** 銘柄について「いま買ってよいか」をプロのトレーダーの目で聞く質問文。アプリの数字を材料として渡す */
export function promptForStock(
  s: Stock,
  ctx: { sectorRel20: number | null; n225r20: number | null; held: { qty: number; avg: number } | null },
): string {
  const p = (x: number | null | undefined) => (x == null ? '不明' : `${x >= 0 ? '+' : ''}${(x * 100).toFixed(1)}%`);
  const d20 = s.dec['20'];
  const d5 = s.dec['5'];
  const facts = [
    `銘柄: ${s.name}（東証 ${s.code}）／セクター: ${s.sector}`,
    `株価: ${s.last.toLocaleString('ja-JP')} 円（${s.asof} 終値）、前日比 ${p(s.dec['1']?.r)}`,
    `5 日の騰落率 ${p(d5?.r)}／20 日 ${p(d20?.r)}（同じ 20 日の日経平均 ${p(ctx.n225r20)}）`,
    d20
      ? `20 日の内訳: 日経平均につられた分 ${p(d20.m)}・業種（セクター）の分 ${p(d20.s)}・この銘柄だけの分 ${p(d20.i)}`
      : '',
    `60 日高値から ${p(s.dd60)}／1 年の値幅の中での位置 ${s.pos1y == null ? '不明' : `${Math.round(s.pos1y * 100)}%（0%＝1 年の安値、100%＝高値）`}`,
    `日経平均への感応度 β ${s.beta}／20 日の下げの珍しさ（標準化） ${s.z20 ?? '不明'}`,
    `セクター平均の 20 日の日経比 ${p(ctx.sectorRel20)}`,
    `このアプリの判定: ${SIGNAL_JA[s.signal.label] ?? s.signal.label}${s.signal.reason ? `（${s.signal.reason}）` : ''}`,
    s.rise?.hits?.length ? `上がり始めの条件で当てはまったもの: ${s.rise.hits.join('・')}` : '',
    s.earnings?.next ? `次の決算: ${s.earnings.next}${s.earnings.next_est ? '（目安・未発表）' : ''}` : '',
    ctx.held ? `私の保有: ${ctx.held.qty.toLocaleString('ja-JP')} 株、平均取得 ${Math.round(ctx.held.avg).toLocaleString('ja-JP')} 円` : '私はまだ持っていません',
  ].filter(Boolean);
  return [
    `あなたは日本株を長く扱ってきたプロのトレーダーです。${s.name}（${s.code}）を「いま買ってよいか」について、あなたの意見を聞かせてください。`,
    '',
    'まず Google 検索で、次のことを最新の情報で調べてください（調べた日付と出典も書くこと）。',
    '- 直近 1 ヶ月のニュース・適時開示（決算、業績予想の修正、受注、不祥事、格付けの変更など）',
    '- 直近の決算の中身と、会社の業績予想・市場予想（コンセンサス）',
    '- 株価の割安・割高（PER・PBR・配当利回りを同業他社や過去と比べて）',
    '- チャートの形（25 日・75 日・200 日の移動平均との位置関係、直近の高値・安値、出来高）',
    '- 業種全体と市場全体（日経平均・為替・米国株）の流れ',
    '',
    '私のアプリで計算した数字です（判断の材料にしてください）:',
    ...facts.map((f) => `・${f}`),
    '',
    '次の形で答えてください。',
    '1. 結論: 「買い」「押し目を待つ」「見送り」のどれか一つと、確信度（高・中・低）',
    '2. 根拠: 買う理由と、買わない理由をそれぞれ 3 つまで。どれも調べた事実か上の数字に結びつけること',
    '3. 買うなら: 入る値段の目安、損切りの目安（理由つき）、どれくらいの期間持つ想定か',
    `4. ${ctx.held ? '持っている私へ: 買い増し・そのまま持つ・減らす のどれが妥当か' : 'まだ持っていない私へ: 最初に買うならどのくらいの量から始めるか（資金の何割など）'}`,
    '5. この先 1 ヶ月で見ておくべき出来事や数字（決算日・イベントなど）',
    '6. 3 行まとめ',
    '',
    '守ってほしいこと:',
    '・事実と意見を分けて書く。調べてわからないことは「わからない」と書き、作らない',
    '・専門用語にはかっこで一言の説明を付ける（株を始めたばかりの人にもわかるように）',
    '・最終的な判断は私がする前提で、遠慮なく率直に',
  ].join('\n');
}

const SIGNAL_JA: Record<string, string> = {
  buy: '買い候補（地合いと業種につられて下げた）',
  caution: '要注意（その銘柄だけの理由で下げている）',
  rise: '初動候補（上がり始めの形）',
  watch: '様子見',
  none: '特になし',
};
