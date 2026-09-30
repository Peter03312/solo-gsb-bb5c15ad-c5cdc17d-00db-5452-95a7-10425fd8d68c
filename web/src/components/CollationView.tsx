import { useEffect, useState } from 'react';
import { api } from '../api';
import type { Collation, ManuscriptDTO } from '../types';

interface Props {
  docId: string;
}

export function CollationView({ docId }: Props) {
  const [data, setData] = useState<{
    manuscripts: ManuscriptDTO[];
    collation: Collation;
  } | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    api
      .collation(docId)
      .then((r) => alive && setData({ manuscripts: r.manuscripts, collation: r.collation }))
      .catch((e) => alive && setErr(e.message));
    return () => {
      alive = false;
    };
  }, [docId]);

  if (err) return <div className="banner error">{err}</div>;
  if (!data) return <div className="loading">载入中…</div>;

  const { manuscripts, collation } = data;
  const msName = (id: string) => manuscripts.find((m) => m.id === id)?.name ?? id;
  const baseName = msName(collation.baseManuscriptId);

  return (
    <div className="collation-view">
      {collation.brokenGroups.length > 0 && (
        <section className="panel">
          <h2>待修复对应组（{collation.brokenGroups.length}）</h2>
          <p className="hint">下列组未参与本次对照；修复后自动进入底本序列。修复前不能发布新校勘版。</p>
          <ul className="broken-list">
            {collation.brokenGroups.map((g) => (
              <li key={g.id}>
                <b>第 {g.ord + 1} 组</b>：{g.reason}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="panel">
        <h2>异文对照（依底本「{baseName}」顺序）</h2>
        {collation.groups.length === 0 && <p className="empty">尚无有效对应组。</p>}
        <table className="collation-table">
          <thead>
            <tr>
              <th className="col-seq">序</th>
              {manuscripts.map((m) => (
                <th key={m.id} className={m.id === collation.baseManuscriptId ? 'base-col' : ''}>
                  {m.name}
                  {m.id === collation.baseManuscriptId && <span className="badge base">底</span>}
                </th>
              ))}
              <th className="col-flags">标记</th>
            </tr>
          </thead>
          <tbody>
            {collation.groups.map((g, i) => (
              <tr key={g.id}>
                <td className="col-seq">{i + 1}</td>
                {manuscripts.map((m) => {
                  const mem = g.members.find((x) => x.manuscriptId === m.id);
                  const isBase = m.id === collation.baseManuscriptId;
                  if (!mem) return <td key={m.id} className="empty-cell">—</td>;
                  if (mem.missing)
                    return (
                      <td key={m.id} className="missing-cell">
                        <span className="missing-mark">缺文</span>
                      </td>
                    );
                  return (
                    <td key={m.id} className={mem.variant ? 'variant-cell' : ''}>
                      <span className={mem.inverted ? 'inv-text' : ''}>{mem.text}</span>
                      <span className="loc-hint">
                        第{mem.lineNo}行
                        {mem.inverted && ' · 倒置'}
                      </span>
                      {isBase && <span className="loc-hint">（{g.baseLineNo}行）</span>}
                    </td>
                  );
                })}
                <td className="col-flags">
                  {g.isVariant && <span className="tag variant">异文</span>}
                  {g.hasMissing && <span className="tag missing">缺文</span>}
                  {g.hasInversion && <span className="tag inverted">倒置</span>}
                  {!g.isVariant && !g.hasMissing && !g.hasInversion && (
                    <span className="tag same">同文</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="panel">
        <h2>各抄本原文（未归组文字，按原始行序）</h2>
        <p className="hint">每行中未被任何有效对应组覆盖的字句均保留可见。</p>
        <div className="raw-grid">
          {collation.rawByManuscript.map((rv) => (
            <div key={rv.manuscriptId} className="raw-ms">
              <h3>{msName(rv.manuscriptId)}</h3>
              {rv.segments.length === 0 ? (
                <p className="empty">（全部已归组）</p>
              ) : (
                rv.segments.map((seg) => (
                  <div key={`${seg.lineId}-${seg.start}`} className="raw-seg">
                    <span className="raw-lineno">{seg.lineNo}</span>
                    <span className="raw-text">{seg.text || '（空段）'}</span>
                  </div>
                ))
              )}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
