import { render } from 'preact';
import '@core/tokens.css';
import { bootMigration } from '@core/migrate';
import { App } from './App';

// v1 → v2 移行は描画前（store.loadAll より前）に済ませる。
// 結果は MigrationSheet が lastMigrationReport() から読んで表示する。
bootMigration();

render(<App />, document.getElementById('app')!);
