import { render } from 'preact';
import { App } from './app';
import './styles.css';

document.title = `Deidentifier v${__APP_VERSION__}`;
render(<App />, document.getElementById('app')!);

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`, { scope: import.meta.env.BASE_URL }).catch(() => undefined);
}
