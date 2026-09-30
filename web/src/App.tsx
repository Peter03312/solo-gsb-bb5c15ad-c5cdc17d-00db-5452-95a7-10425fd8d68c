import { useCallback, useEffect, useState } from 'react';
import { api } from './api';
import type { DocState } from './types';
import { DocumentList } from './components/DocumentList';
import { Transcribe } from './components/Transcribe';
import { Grouping } from './components/Grouping';
import { CollationView } from './components/CollationView';
import { Editions } from './components/Editions';

type Tab = 'transcribe' | 'grouping' | 'collation' | 'editions';

function useHashRoute() {
  const [hash, setHash] = useState(window.location.hash);
  useEffect(() => {
    const onHash = () => setHash(window.location.hash);
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  return hash;
}

export default function App() {
  const hash = useHashRoute();
  const docId = hash.startsWith('#/doc/') ? hash.slice('#/doc/'.length).split('/')[0] : null;

  const [state, setState] = useState<DocState | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('transcribe');

  const refresh = useCallback(async (id: string) => {
    setLoading(true);
    try {
      const s = await api.getDocument(id);
      setState(s);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (docId) void refresh(docId);
    else setState(null);
  }, [docId, refresh]);

  const applyState = useCallback((s: DocState) => {
    setState(s);
    setError(null);
  }, []);

  const handleError = useCallback((e: unknown) => {
    const err = e as { message: string; status?: number };
    if (err.status === 409) {
      setError('版本冲突：数据已被他人修改，请刷新页面获取最新版本后再操作。本次改动未保存。');
    } else {
      setError(err.message);
    }
  }, []);

  const tabs: { key: Tab; label: string }[] = [
    { key: 'transcribe', label: '录文' },
    { key: 'grouping', label: '归组' },
    { key: 'collation', label: '对照' },
    { key: 'editions', label: '校勘版' },
  ];

  return (
    <div className="app">
      <header className="topbar">
        <a href="#/" className="brand">
          📜 多抄本校勘
        </a>
        {state && (
          <span className="doc-title">
            {state.document.title}
            <em className="revision">版本号 r{state.document.revision}</em>
          </span>
        )}
      </header>

      {error && (
        <div className="banner error" onClick={() => setError(null)}>
          ⚠ {error} <span className="banner-close">（点击关闭）</span>
        </div>
      )}

      {!docId ? (
        <DocumentList />
      ) : loading && !state ? (
        <div className="loading">载入中…</div>
      ) : state ? (
        <main>
          <nav className="tabs">
            {tabs.map((t) => (
              <button
                key={t.key}
                className={tab === t.key ? 'tab active' : 'tab'}
                onClick={() => setTab(t.key)}
              >
                {t.label}
              </button>
            ))}
            <a className="back-link" href="#/">
              ← 返回文献列表
            </a>
          </nav>

          {tab === 'transcribe' && (
            <Transcribe state={state} apply={applyState} onError={handleError} />
          )}
          {tab === 'grouping' && (
            <Grouping state={state} apply={applyState} onError={handleError} />
          )}
          {tab === 'collation' && <CollationView docId={state.document.id} />}
          {tab === 'editions' && (
            <Editions state={state} apply={applyState} onError={handleError} />
          )}
        </main>
      ) : (
        <div className="loading">未找到文献</div>
      )}
    </div>
  );
}
