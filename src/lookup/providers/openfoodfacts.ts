/**
 * Open Food Facts プロバイダ（認証不要・CORS 開放）。
 *
 * 実測（docs/lookup-spike.md）:
 * - `Access-Control-Allow-Origin: *` を返すのでブラウザから直接叩ける（リレー不要）
 * - レート制限は商品参照 100req/分。超えると 429 を返し、しばらく 429 が続く
 * - 食品DBなので日用品・雑貨はほぼ入っていない
 *
 * 注意: ブラウザの fetch では User-Agent を上書きできない（禁止ヘッダ）。
 * OFF は UA での識別を推奨しているが、指定できないので付けない。
 */
import type { LookupProvider, LookupResult } from '@core/types';

const ENDPOINT = 'https://world.openfoodfacts.org/api/v2/product/';
/** 必要な列だけ取る（既定のレスポンスは 1 商品で数十KBある） */
const FIELDS = 'code,product_name,product_name_ja,product_name_en,brands';

export const OPEN_FOOD_FACTS = 'openfoodfacts';

interface OffProduct {
  product_name?: unknown;
  product_name_ja?: unknown;
  product_name_en?: unknown;
  brands?: unknown;
}

/**
 * OFF の商品名には HTML エンティティがそのまま入っていることがある
 * （実測例: `gogo no kocha ... &quot;kirin&quot;`）。
 * 描画は JSX なのでエスケープはされるが、`&quot;` と字面が出てしまうのでここで戻す。
 * innerHTML は使えない（ARCHITECTURE のXSS対策）ので手で置換する。
 */
const ENTITIES: Record<string, string> = {
  '&quot;': '"',
  '&apos;': "'",
  '&#39;': "'",
  '&lt;': '<',
  '&gt;': '>',
  '&nbsp;': ' ',
  '&amp;': '&', // 二重エスケープを戻すため最後に処理する
};

function decodeEntities(s: string): string {
  return s.replace(/&(?:quot|apos|#39|lt|gt|nbsp|amp);/g, (m) => ENTITIES[m] ?? m);
}

function text(v: unknown): string {
  return typeof v === 'string' ? decodeEntities(v).trim() : '';
}

/** 日本語名 > 既定名 > 英語名。棚POPに使うので日本語を最優先する */
function pickName(p: OffProduct): string {
  return text(p.product_name_ja) || text(p.product_name) || text(p.product_name_en);
}

export const openFoodFactsProvider: LookupProvider = {
  name: OPEN_FOOD_FACTS,

  async lookup(jan: string): Promise<LookupResult | null> {
    const url = `${ENDPOINT}${encodeURIComponent(jan)}.json?fields=${FIELDS}`;
    const res = await fetch(url, { headers: { Accept: 'application/json' } });

    // 404 = 未登録。「確実に無い」ので negative cache に載せてよい
    if (res.status === 404) return null;
    // 429 / 5xx は一時的な失敗。throw して次のプロバイダ・キューへ回す
    if (res.status === 429) throw new Error(`${OPEN_FOOD_FACTS}: レート制限（429）`);
    if (!res.ok) throw new Error(`${OPEN_FOOD_FACTS}: HTTP ${res.status}`);

    const body = (await res.json()) as { status?: unknown; product?: OffProduct } | null;
    if (!body || body.status !== 1 || !body.product) return null;

    const name = pickName(body.product);
    // 登録はあるが名前が空（写真だけ登録された商品）はミス扱い
    if (!name) return null;

    const maker = text(body.product.brands);
    return { jan, name, provider: OPEN_FOOD_FACTS, ...(maker ? { maker } : {}) };
  },
};
