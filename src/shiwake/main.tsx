import { render } from 'preact';
import '@core/tokens.css';
import { bootMigration } from '@core/migrate';
import { ShiwakeApp } from './ShiwakeApp';

// v1（sb_* キー）→ v2 移行は描画前に済ませる。仕分番長では黙って実行し、
// 結果は ShiwakeApp が lastMigrationReport() を読んでトーストで知らせる。
bootMigration();

render(<ShiwakeApp />, document.getElementById('app')!);
