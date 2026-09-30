import { GroupDTO, LineDTO, ManuscriptDTO } from './types';
import { codePointSlice } from './util';

export interface CollationMember {
  manuscriptId: string;
  missing: boolean;
  lineId: string | null;
  lineNo: number | null;
  start: number;
  end: number;
  text: string | null;
  variant: boolean;
  inverted: boolean;
}

export interface CollationGroup {
  id: string;
  ord: number;
  note: string;
  baseLineNo: number;
  baseStart: number;
  baseEnd: number;
  baseText: string;
  isVariant: boolean;
  hasMissing: boolean;
  hasInversion: boolean;
  members: CollationMember[]; // 第一位为底本，其余按抄本顺序
}

export interface RawSegment {
  lineId: string;
  lineNo: number;
  start: number;
  end: number;
  text: string;
}

export interface RawManuscriptView {
  manuscriptId: string;
  segments: RawSegment[];
}

export interface BrokenGroupView {
  id: string;
  ord: number;
  reason: string;
  note: string;
}

export interface Collation {
  baseManuscriptId: string;
  groups: CollationGroup[];
  brokenGroups: BrokenGroupView[];
  rawByManuscript: RawManuscriptView[];
}

/** 判断某抄本在该组序列上是否相对底本倒置：
 *  底本按 (行号,起始) 递增排列各组；该抄本位置序列中出现降序即为倒置。 */
function computeInversion(groups: CollationGroup[]): void {
  for (const g of groups) g.hasInversion = false;

  const byMs = new Map<string, CollationGroup[]>();
  for (const g of groups) {
    for (const m of g.members) {
      if (m.missing) continue;
      if (!byMs.has(m.manuscriptId)) byMs.set(m.manuscriptId, []);
      byMs.get(m.manuscriptId)!.push(g);
    }
  }

  for (const [msId, list] of byMs) {
    if (msId === groups[0]?.members[0]?.manuscriptId) continue; // 底本本身跳过
    const ordered = [...list].sort((a, b) => a.ord - b.ord);
    for (let i = 1; i < ordered.length; i++) {
      const prev = ordered[i - 1].members.find((m) => m.manuscriptId === msId)!;
      const cur = ordered[i].members.find((m) => m.manuscriptId === msId)!;
      const desc =
        (cur.lineNo ?? 0) < (prev.lineNo ?? 0) ||
        ((cur.lineNo ?? 0) === (prev.lineNo ?? 0) && cur.start < prev.start);
      if (desc) {
        // 底本顺序在前的组，在该抄本中位置反而靠后——只标记这个被提前/挪后的片段
        cur.inverted = true;
        ordered[i].hasInversion = true;
      }
    }
  }
}

export function buildCollation(
  manuscripts: ManuscriptDTO[],
  lines: LineDTO[],
  groups: GroupDTO[],
  baseManuscriptId: string,
): Collation {
  const lineById = new Map(lines.map((l) => [l.id, l]));
  const msOrder = new Map(manuscripts.map((m, i) => [m.id, i]));
  const base = baseManuscriptId;

  const active = groups.filter((g) => g.status === 'active');

  const collGroups: CollationGroup[] = [];
  for (const g of active) {
    const baseMember = g.members.find((m) => m.manuscriptId === base && !m.missing && m.lineId);
    if (!baseMember || !baseMember.lineId) continue; // 理论上 active 不会出现
    const baseLine = lineById.get(baseMember.lineId);
    if (!baseLine || baseLine.deleted) continue;

    const bStart = baseMember.start ?? 0;
    const bEnd = baseMember.end ?? 0;
    const baseText = codePointSlice(baseLine.text, bStart, bEnd);

    const members: CollationMember[] = [];
    let isVariant = false;
    let hasMissing = false;

    const orderedMembers = [...g.members].sort(
      (a, b) => (msOrder.get(a.manuscriptId) ?? 0) - (msOrder.get(b.manuscriptId) ?? 0),
    );

    for (const m of orderedMembers) {
      if (m.missing || !m.lineId) {
        hasMissing = true;
        members.push({
          manuscriptId: m.manuscriptId,
          missing: true,
          lineId: null,
          lineNo: null,
          start: 0,
          end: 0,
          text: null,
          variant: m.manuscriptId === base,
          inverted: false,
        });
        continue;
      }
      const line = lineById.get(m.lineId);
      if (!line || line.deleted) continue;
      const s = m.start ?? 0;
      const e = m.end ?? 0;
      const text = codePointSlice(line.text, s, e);
      const variant = m.manuscriptId === base ? false : text !== baseText;
      if (variant) isVariant = true;
      members.push({
        manuscriptId: m.manuscriptId,
        missing: false,
        lineId: m.lineId,
        lineNo: line.lineNo,
        start: s,
        end: e,
        text,
        variant,
        inverted: false,
      });
    }

    collGroups.push({
      id: g.id,
      ord: g.ord,
      note: g.note,
      baseLineNo: baseLine.lineNo,
      baseStart: bStart,
      baseEnd: bEnd,
      baseText,
      isVariant,
      hasMissing,
      hasInversion: false,
      members,
    });
  }

  // 依底本 (行号, 起始) 排序，并列时用 ord
  collGroups.sort(
    (a, b) =>
      a.baseLineNo - b.baseLineNo ||
      a.baseStart - b.baseStart ||
      a.ord - b.ord,
  );

  // 倒置判定（需要全局序列）
  if (collGroups.length > 1) computeInversion(collGroups);

  // 未归组文字：每个抄本按原始行序，扣除 active 组覆盖的区间
  const coverage = new Map<string, Array<{ start: number; end: number }>>();
  for (const g of active) {
    for (const m of g.members) {
      if (m.missing || !m.lineId) continue;
      const line = lineById.get(m.lineId);
      if (!line || line.deleted) continue;
      const arr = coverage.get(m.lineId) ?? [];
      arr.push({ start: m.start ?? 0, end: m.end ?? 0 });
      coverage.set(m.lineId, arr);
    }
  }

  const rawByManuscript: RawManuscriptView[] = manuscripts.map((m) => {
    const msLines = lines
      .filter((l) => l.manuscriptId === m.id && !l.deleted)
      .sort((a, b) => a.lineNo - b.lineNo);
    const segments: RawSegment[] = [];
    for (const line of msLines) {
      const spans = (coverage.get(line.id) ?? []).sort((a, b) => a.start - b.start);
      let cursor = 0;
      const len = Array.from(line.text).length;
      for (const sp of spans) {
        if (sp.start > cursor) {
          segments.push({
            lineId: line.id,
            lineNo: line.lineNo,
            start: cursor,
            end: sp.start,
            text: codePointSlice(line.text, cursor, sp.start),
          });
        }
        cursor = Math.max(cursor, sp.end);
      }
      if (cursor < len) {
        segments.push({
          lineId: line.id,
          lineNo: line.lineNo,
          start: cursor,
          end: len,
          text: codePointSlice(line.text, cursor, len),
        });
      }
    }
    return { manuscriptId: m.id, segments };
  });

  const brokenGroups: BrokenGroupView[] = groups
    .filter((g) => g.status === 'broken')
    .map((g) => ({ id: g.id, ord: g.ord, reason: g.brokenReason, note: g.note }))
    .sort((a, b) => a.ord - b.ord);

  return { baseManuscriptId: base, groups: collGroups, brokenGroups, rawByManuscript };
}
