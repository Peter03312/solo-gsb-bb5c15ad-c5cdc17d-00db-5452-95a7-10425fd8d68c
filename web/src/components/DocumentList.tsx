import { useEffect, useState } from 'react';
import { api } from '../api';
import type { DocumentRef } from '../types';

export function DocumentList() {
  const [docs, setDocs] = useState<DocumentRef[] | null>(null);
  const [title, setTitle] = useState('');
  const [creating, setCreating] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = async () => {
    const r = await api.listDocuments();
    setDocs(r.documents);
  };

  useEffect(() => {
    void load();
  }, []);

  const create = async () => {
    if (!title.trim()) return;
    setCreating(true);
    setErr(null);
    try {
      const s = await api.createDocument(title.trim());
      window.location.hash = `#/doc/${s.document.id}`;
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setCreating(false);
    }
  };

  return (
    <main className="doc-list">
      <h1>文献列表</h1>
      <div className="create-box">
        <input
          placeholder="输入文献篇名，如：論語·學而"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && create()}
        />
        <button disabled={creating || !title.trim()} onClick={create}>
          新建文献
        </button>
      </div>
      {err && <div className="banner error">{err}</div>}

      {docs === null ? (
        <p className="loading">载入中…</p>
      ) : docs.length === 0 ? (
        <p className="empty">尚无文献，请先新建。</p>
      ) : (
        <ul className="docs">
          {docs.map((d) => (
            <li key={d.id}>
              <a href={`#/doc/${d.id}`}>{d.title}</a>
              <span className="meta">
                {d.manuscript_count} 份抄本 · {d.edition_count} 个校勘版
              </span>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
