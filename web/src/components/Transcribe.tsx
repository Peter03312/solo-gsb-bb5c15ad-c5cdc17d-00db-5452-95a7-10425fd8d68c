import { useEffect, useMemo, useState } from 'react';
import { api, ApiError } from '../api';
import type { DocState, LineDTO } from '../types';

interface Props {
  state: DocState;
  apply: (s: DocState) => void;
  onError: (e: unknown) => void;
}

interface DraftLine {
  key: string;
  lineNo: number;
  text: string;
}

export function Transcribe({ state, apply, onError }: Props) {
  const revision = Number(state.document.revision);
  const [activeMs, setActiveMs] = useState<string>(
    state.document.baseManuscriptId ?? state.manuscripts[0]?.id ?? '',
  );
  const [newName, setNewName] = useState('');
  const [busy, setBusy] = useState(false);

  // 每个抄本保存自己的草稿，避免切换时丢字
  const [drafts, setDrafts] = useState<Record<string, DraftLine[]>>({});
  const [localErr, setLocalErr] = useState<string | null>(null);

  useEffect(() => {
    if (!activeMs && state.manuscripts[0]) {
      setActiveMs(state.document.baseManuscriptId ?? state.manuscripts[0].id);
    }
  }, [state, activeMs]);

  // 服务器状态刷新后，为尚无草稿的抄本初始化（已编辑过的草稿保留）
  useEffect(() => {
    setDrafts((prev) => {
      const next = { ...prev };
      for (const ms of state.manuscripts) {
        if (next[ms.id]) continue;
        next[ms.id] = state.lines
          .filter((l) => l.manuscriptId === ms.id && !l.deleted)
          .sort((a, b) => a.lineNo - b.lineNo)
          .map((l) => ({ key: l.id, lineNo: l.lineNo, text: l.text }));
      }
      return next;
    });
  }, [state]);

  const draft = drafts[activeMs] ?? [];
  const activeManuscript = state.manuscripts.find((m) => m.id === activeMs);

  const savedLines: LineDTO[] = useMemo(
    () =>
      state.lines
        .filter((l) => l.manuscriptId === activeMs && !l.deleted)
        .sort((a, b) => a.lineNo - b.lineNo),
    [state.lines, activeMs],
  );

  const dirty = useMemo(() => {
    if (draft.length !== savedLines.length) return true;
    return draft.some((d, i) => d.lineNo !== savedLines[i].lineNo || d.text !== savedLines[i].text);
  }, [draft, savedLines]);

  const updateDraft = (next: DraftLine[]) => {
    setDrafts((d) => ({ ...d, [activeMs]: next }));
  };

  const setLine = (key: string, patch: Partial<DraftLine>) => {
    updateDraft(draft.map((d) => (d.key === key ? { ...d, ...patch } : d)));
  };

  const addLine = () => {
    const maxNo = draft.reduce((m, d) => Math.max(m, d.lineNo), 0);
    updateDraft([
      ...draft,
      { key: `new-${Date.now()}-${Math.random()}`, lineNo: maxNo + 1, text: '' },
    ]);
  };

  const removeLine = (key: string) => {
    updateDraft(draft.filter((d) => d.key !== key));
  };

  const renumber = () => {
    updateDraft(draft.map((d, i) => ({ ...d, lineNo: i + 1 })));
  };

  const addManuscript = async () => {
    if (!newName.trim()) return;
    setBusy(true);
    setLocalErr(null);
    try {
      const s = await api.addManuscript(state.document.id, newName.trim(), revision);
      apply(s);
      setNewName('');
    } catch (e) {
      onError(e);
    } finally {
      setBusy(false);
    }
  };

  const chooseBase = async (msId: string) => {
    if (msId === state.document.baseManuscriptId) return;
    setBusy(true);
    try {
      const s = await api.setBase(state.document.id, msId, revision);
      apply(s);
    } catch (e) {
      onError(e);
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    setLocalErr(null);
    const nums = new Set<number>();
    for (const d of draft) {
      if (!Number.isInteger(d.lineNo) || d.lineNo <= 0) {
        setLocalErr(`存在非法行号（${d.lineNo}），行号须为正整数`);
        return;
      }
      if (nums.has(d.lineNo)) {
        setLocalErr(`行号 ${d.lineNo} 重复`);
        return;
      }
      nums.add(d.lineNo);
    }
    setBusy(true);
    try {
      const s = await api.saveLines(
        activeMs,
        draft.map((d) => ({ lineNo: d.lineNo, text: d.text })),
        revision,
      );
      apply(s);
    } catch (e) {
      if (e instanceof ApiError && e.details?.errors) {
        setLocalErr(e.details.errors.map((x) => `${x.location}：${x.reason}`).join('；'));
      } else {
        onError(e);
      }
    } finally {
      setBusy(false);
    }
  };

  const affectedGroups = useMemo(() => {
    if (!dirty) return new Set<string>();
    const changedIds = new Set<string>();
    savedLines.forEach((l, i) => {
      const d = draft[i];
      if (!d || d.text !== l.text) changedIds.add(l.id);
    });
    if (draft.length !== savedLines.length) {
      const draftNums = new Set(draft.map((d) => d.lineNo));
      for (const l of savedLines) if (!draftNums.has(l.lineNo)) changedIds.add(l.id);
    }
    return new Set(
      state.groups
        .filter((g) => g.members.some((m) => m.lineId && changedIds.has(m.lineId)))
        .map((g) => g.id),
    );
  }, [dirty, draft, savedLines, state.groups]);

  return (
    <div className="transcribe">
      <section className="panel">
        <h2>抄本</h2>
        <p className="hint">至少两份抄本；选定一份为底本。更换底本后原有对应组将全部转为待修复。</p>
        <div className="ms-list">
          {state.manuscripts.map((m) => (
            <div key={m.id} className={`ms-chip ${m.id === activeMs ? 'selected' : ''}`}>
              <button
                className="ms-name"
                onClick={() => setActiveMs(m.id)}
                title="切换编辑"
              >
                {m.name}
              </button>
              {m.id === state.document.baseManuscriptId ? (
                <span className="badge base">底本</span>
              ) : (
                <button className="badge set-base" disabled={busy} onClick={() => chooseBase(m.id)}>
                  设为底本
                </button>
              )}
            </div>
          ))}
        </div>
        <div className="inline-form">
          <input
            placeholder="新抄本名称，如：乙本"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
          />
          <button disabled={busy || !newName.trim()} onClick={addManuscript}>
            添加抄本
          </button>
        </div>
      </section>

      {activeManuscript && (
        <section className="panel">
          <h2>
            逐行录文 — {activeManuscript.name}
            {dirty && <span className="unsaved">● 未保存</span>}
          </h2>
          <p className="hint">
            按行录入原文。保存时仅整表替换本抄本；文字变化或被删除的行所涉及的对应组会转为
            <b> 待修复</b>，其他组不受影响。整表为一个事务，不会部分保存。
          </p>

          {affectedGroups.size > 0 && dirty && (
            <div className="banner warn">
              保存后将有 {affectedGroups.size} 个对应组因引用本行而待修复，修复前不能发布新版。
            </div>
          )}
          {localErr && <div className="banner error">{localErr}</div>}

          <table className="line-editor">
            <thead>
              <tr>
                <th className="col-no">行号</th>
                <th>文字（区间按字符计，[起, 止)）</th>
                <th className="col-op" />
              </tr>
            </thead>
            <tbody>
              {draft.map((d) => (
                <tr key={d.key}>
                  <td className="col-no">
                    <input
                      type="number"
                      min={1}
                      value={d.lineNo}
                      onChange={(e) => setLine(d.key, { lineNo: Number(e.target.value) })}
                    />
                  </td>
                  <td>
                    <input
                      className="text-input"
                      value={d.text}
                      placeholder="录本行文字"
                      onChange={(e) => setLine(d.key, { text: e.target.value })}
                    />
                    <span className="cp-count">{Array.from(d.text).length} 字</span>
                  </td>
                  <td className="col-op">
                    <button className="link-danger" onClick={() => removeLine(d.key)}>
                      删除
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="button-row">
            <button onClick={addLine}>＋ 新增一行</button>
            <button onClick={renumber}>顺序重排行号</button>
            <span className="spacer" />
            <button className="primary" disabled={busy || !dirty} onClick={save}>
              保存录文
            </button>
          </div>
        </section>
      )}
    </div>
  );
}
