import { useMemo, useState } from 'react';
import { api, ApiError } from '../api';
import type { DocState, GroupDTO, LineDTO, MemberDTO } from '../types';
import { CharStrip } from './CharStrip';

interface Props {
  state: DocState;
  apply: (s: DocState) => void;
  onError: (e: unknown) => void;
}

interface MemberDraft {
  manuscriptId: string;
  missing: boolean;
  lineId: string;
  start: number;
  end: number;
}

type Mode = { kind: 'create' } | { kind: 'edit'; group: GroupDTO } | null;

function membersToDraft(state: DocState, members: MemberDTO[]): MemberDraft[] {
  return state.manuscripts.map((ms) => {
    const found = members.find((m) => m.manuscriptId === ms.id);
    return {
      manuscriptId: ms.id,
      missing: found?.missing ?? false,
      lineId: found?.lineId ?? '',
      start: found?.start ?? 0,
      end: found?.end ?? 0,
    };
  });
}

export function Grouping({ state, apply, onError }: Props) {
  const revision = Number(state.document.revision);
  const [mode, setMode] = useState<Mode>(null);
  const [drafts, setDrafts] = useState<MemberDraft[]>([]);
  const [note, setNote] = useState('');
  const [fieldErrors, setFieldErrors] = useState<{ location: string; reason: string }[]>([]);
  const [busy, setBusy] = useState(false);

  const lineById = useMemo(() => new Map(state.lines.map((l) => [l.id, l])), [state.lines]);
  const liveLinesByMs = useMemo(() => {
    const m = new Map<string, LineDTO[]>();
    for (const ms of state.manuscripts) {
      m.set(
        ms.id,
        state.lines.filter((l) => l.manuscriptId === ms.id && !l.deleted).sort((a, b) => a.lineNo - b.lineNo),
      );
    }
    return m;
  }, [state]);

  const baseId = state.document.baseManuscriptId;

  const startCreate = () => {
    if (!baseId) return;
    const d = membersToDraft(state, []);
    const base = d.find((x) => x.manuscriptId === baseId)!;
    const firstBaseLine = liveLinesByMs.get(baseId)?.[0];
    if (firstBaseLine) base.lineId = firstBaseLine.id;
    setDrafts(d);
    setNote('');
    setFieldErrors([]);
    setMode({ kind: 'create' });
  };

  const startEdit = (g: GroupDTO) => {
    setDrafts(membersToDraft(state, g.members));
    setNote(g.note);
    setFieldErrors([]);
    setMode({ kind: 'edit', group: g });
  };

  const cancel = () => {
    setMode(null);
    setFieldErrors([]);
  };

  const patchDraft = (msId: string, patch: Partial<MemberDraft>) => {
    setDrafts((arr) => arr.map((d) => (d.manuscriptId === msId ? { ...d, ...patch } : d)));
  };

  const payloadFor = (d: MemberDraft) => {
    if (d.manuscriptId === baseId) {
      return { manuscriptId: d.manuscriptId, missing: false, lineId: d.lineId, start: d.start, end: d.end };
    }
    if (d.missing) return { manuscriptId: d.manuscriptId, missing: true };
    return { manuscriptId: d.manuscriptId, missing: false, lineId: d.lineId, start: d.start, end: d.end };
  };

  const submit = async () => {
    setFieldErrors([]);
    const members = drafts.map(payloadFor);
    setBusy(true);
    try {
      let s: DocState;
      if (mode?.kind === 'create') {
        s = await api.createGroup(state.document.id, members, note.trim(), revision);
      } else if (mode?.kind === 'edit') {
        s = await api.updateGroup(mode.group.id, members, note.trim(), revision);
      } else {
        return;
      }
      apply(s);
      setMode(null);
    } catch (e) {
      if (e instanceof ApiError && e.details?.errors) {
        setFieldErrors(e.details.errors);
      } else {
        onError(e);
        setMode(null);
      }
    } finally {
      setBusy(false);
    }
  };

  const quickRepair = async (g: GroupDTO) => {
    setBusy(true);
    try {
      const s = await api.repairGroup(g.id, undefined, revision);
      apply(s);
    } catch (e) {
      if (e instanceof ApiError && e.details?.errors) {
        setFieldErrors(e.details.errors);
        startEdit(g);
      } else {
        onError(e);
      }
    } finally {
      setBusy(false);
    }
  };

  const removeGroup = async (g: GroupDTO) => {
    if (!window.confirm(`确定删除第 ${g.ord + 1} 组？`)) return;
    setBusy(true);
    try {
      const s = await api.deleteGroup(g.id, revision);
      apply(s);
    } catch (e) {
      onError(e);
    } finally {
      setBusy(false);
    }
  };

  const orderedGroups = [...state.groups].sort((a, b) => a.ord - b.ord);
  const brokenCount = orderedGroups.filter((g) => g.status === 'broken').length;

  const describeMember = (m: MemberDTO): string => {
    if (m.missing) return '缺文';
    const line = m.lineId ? lineById.get(m.lineId) : undefined;
    if (!line) return '引用缺失';
    return `第${line.lineNo}行 [${m.start ?? 0},${m.end ?? 0})「${Array.from(line.text)
      .slice(m.start ?? 0, m.end ?? 0)
      .join('')}」`;
  };

  return (
    <div className="grouping">
      <section className="panel">
        <div className="panel-head">
          <h2>
            对应组（{orderedGroups.length}
            {brokenCount > 0 && <span className="broken-count">，待修复 {brokenCount}</span>}）
          </h2>
          <button className="primary" disabled={!baseId || busy || !!mode} onClick={startCreate}>
            ＋ 新建对应组
          </button>
        </div>
        {!baseId && <div className="banner warn">请先在「录文」页选定底本。</div>}
        <p className="hint">
          规则：每组须含一个底本片段；其他抄本至多一个片段或标为缺文；同抄本片段不得重叠、不得越界。
          任一不满足都会整体拒绝，不会部分保存。
        </p>

        {orderedGroups.length === 0 && <p className="empty">尚未建立对应组。</p>}

        <ul className="group-list">
          {orderedGroups.map((g) => (
            <li key={g.id} className={g.status === 'broken' ? 'group broken' : 'group'}>
              <div className="group-head">
                <button className="group-title" onClick={() => startEdit(g)}>
                  第 {g.ord + 1} 组
                </button>
                {g.status === 'broken' ? (
                  <span className="tag broken">待修复</span>
                ) : (
                  <span className="tag ok">有效</span>
                )}
                {g.note && <span className="group-note">{g.note}</span>}
                <span className="spacer" />
                {g.status === 'broken' && (
                  <button disabled={busy} onClick={() => quickRepair(g)}>
                    重新校验
                  </button>
                )}
                <button className="link-danger" disabled={busy} onClick={() => removeGroup(g)}>
                  删除
                </button>
              </div>
              {g.status === 'broken' && <div className="broken-reason">原因：{g.brokenReason}</div>}
              <table className="member-preview">
                <tbody>
                  {[...g.members]
                    .sort((a, b) => a.ord - b.ord)
                    .map((m) => {
                      const ms = state.manuscripts.find((x) => x.id === m.manuscriptId);
                      return (
                        <tr key={m.manuscriptId}>
                          <th>
                            {ms?.name}
                            {m.manuscriptId === baseId && <span className="badge base">底</span>}
                          </th>
                          <td className={m.missing ? 'missing-text' : ''}>{describeMember(m)}</td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </li>
          ))}
        </ul>
      </section>

      {mode && (
        <section className="panel editor-panel">
          <h2>{mode.kind === 'create' ? '新建对应组' : `编辑第 ${mode.group.ord + 1} 组`}</h2>
          {fieldErrors.length > 0 && (
            <div className="banner error">
              <div>校验未通过，以下问题须修正（未保存）：</div>
              <ul>
                {fieldErrors.map((e, i) => (
                  <li key={i}>
                    <b>{e.location}</b>：{e.reason}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {drafts.map((d) => {
            const ms = state.manuscripts.find((x) => x.id === d.manuscriptId)!;
            const isBase = d.manuscriptId === baseId;
            const lines = liveLinesByMs.get(d.manuscriptId) ?? [];
            const chosen = lineById.get(d.lineId);
            return (
              <div key={d.manuscriptId} className={`member-edit ${isBase ? 'is-base' : ''}`}>
                <div className="member-head">
                  <strong>
                    {ms.name} {isBase && <span className="badge base">底本·必选片段</span>}
                  </strong>
                  {!isBase && (
                    <label className="missing-toggle">
                      <input
                        type="checkbox"
                        checked={d.missing}
                        onChange={(e) => patchDraft(d.manuscriptId, { missing: e.target.checked })}
                      />
                      缺文（该抄本此处无文）
                    </label>
                  )}
                </div>

                {!d.missing && (
                  <>
                    {lines.length === 0 ? (
                      <div className="banner warn">该抄本尚无存活录文行。</div>
                    ) : (
                      <>
                        <select
                          value={d.lineId}
                          onChange={(e) =>
                            patchDraft(d.manuscriptId, { lineId: e.target.value, start: 0, end: 0 })
                          }
                        >
                          <option value="">选择行…</option>
                          {lines.map((l) => (
                            <option key={l.id} value={l.id}>
                              第 {l.lineNo} 行：{Array.from(l.text).slice(0, 20).join('')}
                              {Array.from(l.text).length > 20 ? '…' : ''}
                            </option>
                          ))}
                        </select>
                        {chosen && (
                          <CharStrip
                            text={chosen.text}
                            start={d.start}
                            end={d.end}
                            onChange={(s, e) => patchDraft(d.manuscriptId, { start: s, end: e })}
                          />
                        )}
                      </>
                    )}
                  </>
                )}
                {d.missing && <div className="missing-box">缺文（对照页将标注）</div>}
              </div>
            );
          })}

          <div className="inline-form">
            <input placeholder="备注（可空）" value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
          <div className="button-row">
            <button onClick={cancel}>取消</button>
            <span className="spacer" />
            <button className="primary" disabled={busy} onClick={submit}>
              {mode.kind === 'create' ? '建立对应组' : '保存修改'}
            </button>
          </div>
        </section>
      )}
    </div>
  );
}
