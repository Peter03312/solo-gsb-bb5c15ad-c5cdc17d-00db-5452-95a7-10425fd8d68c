import type { EditionDetail } from '../types';

/** 已发布快照的只读对照视图（与工作区结构一致） */
export function CollationView({ detail }: { detail: EditionDetail }) {
  const { snapshot } = detail;
  const { manuscripts, collation } = snapshot;
  const msName = (id: string) => manuscripts.find((m) => m.id === id)?.name ?? id;

  return (
    <div className="collation-view readonly">
      <h3>
        第 {detail.versionNo} 版快照（{snapshot.document.title}，发布自 r{detail.revision}）
      </h3>
      <table className="collation-table">
        <thead>
          <tr>
            <th className="col-seq">序</th>
            {manuscripts.map((m) => (
              <th key={m.id} className={m.id === collation.baseManuscriptId ? 'base-col' : ''}>
                {msName(m.id)}
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

      <div className="raw-grid">
        {collation.rawByManuscript.map((rv) => (
          <div key={rv.manuscriptId} className="raw-ms">
            <h4>{msName(rv.manuscriptId)}（未归组文字）</h4>
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
    </div>
  );
}
