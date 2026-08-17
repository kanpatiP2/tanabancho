import { render } from 'preact';
import '@core/tokens.css';
import { ShiwakeApp } from './ShiwakeApp';

render(<ShiwakeApp />, document.getElementById('app')!);
