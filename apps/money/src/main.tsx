import { lazy, StrictMode, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles.css';

const Investment = lazy(async () => {
  const [{ App: Editor }] = await Promise.all([import('../../invest/src/App'), import('../../invest/src/styles.css')]);
  return { default: Editor };
});
const showInvestment = new URLSearchParams(location.search).has('investEditor');

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {showInvestment ? <Suspense fallback={<p className="card">讀取投資表單中…</p>}><Investment /></Suspense> : <App />}
  </StrictMode>,
);
