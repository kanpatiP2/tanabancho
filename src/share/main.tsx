import { render } from 'preact';
import '@core/tokens.css';
import { bootMigration } from '@core/migrate';
import { ShareApp } from './ShareApp';
import { showToast } from './state';

// v1 → v2 移行は描画前に済ませる。共有ビューでは黙って実行し、結果はトーストだけ。
const report = bootMigration();
if (report?.ran) {
  showToast(`旧バージョンのデータを引き継ぎました（${report.totals.v2Count}件）`);
} else if (report && report.errors.length > 0) {
  showToast('データの引き継ぎに失敗しました（空き容量をご確認ください）', { tone: 'warn' });
}

render(<ShareApp />, document.getElementById('app')!);
