import { useEffect, useState } from 'react';
import { api } from '../api';
import type { DocState, EditionDetail, EditionRef } from '../types';
import { CollationView as ReadOnlyCollation } from './EditionSnapshot';

interface Props {
  state: DocState;
  apply: (s: DocState) => void;
  onError: (e: unknown) => void;
}

export function Editions({ state, apply, onError }: Props) {
  const revision = Number(state.document.revision);
  const [editions, setEditions] = useState<EditionRef[] | null>(null);
  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [detail, setDetail] = useState<EditionDetail | null>(null);

  const brokenCount = state.groups.filter((g) => g.status === 'broken').length;
  const activeCount = state.groups.filter((g) => g.status === 'active').length;
  const canPublish = state.manuscripts.length >= 2 && brokenCount === 0 && activeCount > 0;

  const load = () =>
    api.editions(state.document.id).then((r) => setEditions(r.editions));

  useEffect(() => {
    void load();
  }, [state.document.id]);

  const publish = async () => {
    setBusy(true);
    try {
      const s = await api.publish(state.document.id, label.trim(), revision);
      apply(s);
      setLabel('');
      await load();
    } catch (e) {
      onError(e);
    } finally {
      setBusy(false);
    }
  };

  const open = async (id: string) => {
    if (openId === id) {
      setOpenId(null);
      setDetail(null);
      return;
    }
    setOpenId(id);
    setDetail(null);
    try {
      const d = await api.edition(id);
      setDetail(d);
    } catch (e) {
      onError(e);
    }
  };

  return (
    <div className="editions">
      <section className="panel">
        <h2>发布新校勘版</h2>
        <ul className="publish-rules">
          <li className={state.manuscripts.length >= 2 ? 'ok' : 'bad'}>
            至少两份抄本（当前 {state.manuscripts.length}）
          </li>
          <li className={state.document.baseManuscriptId ? 'ok' : 'bad'}>
            已选定底本（{state.document.baseManuscriptId ? '已选' : '未选'}）
          </li>
          <li className={brokenCount === 0 ? 'ok' : 'bad'}>
            无待修复对应组{brokenCount > 0 ? `（${brokenCount} 组待修复）` : ''}
          </li>
          <li className={activeCount > 0 ? 'ok' : 'bad'}>至少一个有效对应组</li>
        </ul>
        <p className="hint">
          发布后的校勘版为不可变快照，即使继续修改工作区，旧版仍可随时阅读。
        </p>
        <div className="inline-form">
          <input placeholder="版本说明（可空），如：初校" value={label} onChange={(e) => setLabel(e.target.value)} />
          <button className="primary" disabled={busy || !canPublish} onClick={publish}>
            发布新校勘版
          </button>
        </div>
      </section>

      <section className="panel">
        <h2>已发布校勘版</h2>
        {editions === null ? (
          <p className="loading">载入中…</p>
        ) : editions.length === 0 ? (
          <p className="empty">尚未发布任何版本。</p>
        ) : (
          <ul className="edition-list">
            {editions.map((e) => (
              <li key={e.id}>
                <button className="edition-title" onClick={() => open(e.id)}>
                  第 {e.versionNo} 版 {openId === e.id ? '▾' : '▸'}
                </button>
                {e.label && <span className="edition-label">{e.label}</span>}
                <span className="meta">
                  基于 r{e.revision} · {new Date(e.publishedAt).toLocaleString('zh-CN')}
                </span>
                {openId === e.id &&
                  (detail ? (
                    <div className="edition-snapshot">
                      <ReadOnlyCollation detail={detail} />
                    </div>
                  ) : (
                    <p className="loading">载入快照…</p>
                  ))}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
