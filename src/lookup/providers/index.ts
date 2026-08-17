/**
 * プロバイダの組み立て。順序 = 照会順（先にヒットしたら以降は呼ばない）。
 *
 * 順序の根拠: JANCODE LOOKUP は日本の商品DBなので、使えるなら商品名の質が高い。
 * Open Food Facts は世界の食品DBで、日用品は入っておらず名前も英語のことがある。
 * よって「日本特化 → 全世界フォールバック」の順に並べる。
 * appId 未設定なら JANCODE LOOKUP は組み立てず、Open Food Facts だけになる。
 */
import type { LookupProvider } from '@core/types';
import { createJanCodeLookupProvider } from './jancodelookup';
import { openFoodFactsProvider } from './openfoodfacts';

export { openFoodFactsProvider, OPEN_FOOD_FACTS } from './openfoodfacts';
export { createJanCodeLookupProvider, JANCODE_LOOKUP } from './jancodelookup';

export interface ProviderOptions {
  /** JANCODE LOOKUP の appId。'' なら同プロバイダを使わない */
  janLookupAppId?: string;
}

export function buildProviders(opts: ProviderOptions = {}): LookupProvider[] {
  const providers: LookupProvider[] = [];
  const appId = (opts.janLookupAppId ?? '').trim();
  if (appId) providers.push(createJanCodeLookupProvider(appId));
  providers.push(openFoodFactsProvider);
  return providers;
}
