import { render } from 'preact';
import '@core/tokens.css';
import { ShareApp } from './ShareApp';

render(<ShareApp />, document.getElementById('app')!);
