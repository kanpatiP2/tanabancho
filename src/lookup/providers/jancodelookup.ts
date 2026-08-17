/**
 * JANCODE LOOKUP プロバイダ（要 appId。設定画面の「JAN照会 appId」から読む）。
 *
 * ⚠ 2026-08 時点でサービスが停止している（docs/lookup-spike.md 参照）。
 * www / api とも同じドメインパーキング用HTMLを返し、JSON は返ってこない。
 * そのため appId 未設定なら **プロバイダごと組み立てない**（= 既定では無効）。
 * 復旧したときに appId を入れるだけで動くよう、実装だけ残してある。
 *
 * レスポンスの形は公開ガイド由来（`info` + `product[]`）だが、
 * サービス停止中で実測できていない。フィールド名は揺れても拾えるように
 * 複数候補から取り出す実装にしてある。
 */
import type { LookupProvider, LookupResult } from '@core/types';

const ENDPOINT = 'https://api.jancodelookup.com/';

export const JANCODE_LOOKUP = 'jancodelookup';

function text(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

/** 候補フィールドを順に見て最初に見つかった文字列を返す */
function pick(row: Record<string, unknown>, names: readonly string[]): string {
  for (const n of names) {
    const v = text(row[n]);
    if (v) return v;
  }
  return '';
}

const NAME_FIELDS = ['itemName', 'itemname', 'name'] as const;
const MAKER_FIELDS = ['makerName', 'brandName', 'makername', 'brandname'] as const;

/**
 * appId 付きのプロバイダを作る。appId は必須（呼び出し側で空判定済みの前提）。
 */
export function createJanCodeLookupProvider(appId: string): LookupProvider {
  return {
    name: JANCODE_LOOKUP,

    async lookup(jan: string): Promise<LookupResult | null> {
      const url =
        `${ENDPOINT}?appId=${encodeURIComponent(appId)}` +
        `&query=${encodeURIComponent(jan)}&type=code&hits=1`;
      const res = await fetch(url, { headers: { Accept: 'application/json' } });

      if (res.status === 404) return null;
      if (res.status === 429) throw new Error(`${JANCODE_LOOKUP}: レート制限（429）`);
      if (!res.ok) throw new Error(`${JANCODE_LOOKUP}: HTTP ${res.status}`);

      // サービス停止中はHTML（パーキングページ）が返るため JSON パース失敗を検出する
      const raw = await res.text();
      let body: { product?: unknown } | null;
      try {
        body = JSON.parse(raw) as { product?: unknown };
      } catch {
        throw new Error(`${JANCODE_LOOKUP}: JSON以外の応答（サービス停止の可能性）`);
      }

      const rows = Array.isArray(body?.product) ? body.product : [];
      const first = rows[0];
      if (typeof first !== 'object' || first === null) return null;

      const row = first as Record<string, unknown>;
      const name = pick(row, NAME_FIELDS);
      if (!name) return null;

      const maker = pick(row, MAKER_FIELDS);
      return { jan, name, provider: JANCODE_LOOKUP, ...(maker ? { maker } : {}) };
    },
  };
}
