import { DocState, GroupDTO, LineDTO, MemberInput } from './types';
import { ValidationError } from './errors';
import { codePointLength, rangeOverlaps } from './util';

export interface NormalizedMember {
  manuscriptId: string;
  ord: number;
  missing: boolean;
  lineId: string | null;
  start: number;
  end: number;
}

function msName(state: DocState, id: string): string {
  return state.manuscripts.find((m) => m.id === id)?.name ?? id;
}

function lineLabel(state: DocState, line: LineDTO | undefined, msId: string): string {
  const name = msName(state, msId);
  if (!line) return `抄本「${name}」`;
  return `抄本「${name}」第 ${line.lineNo} 行`;
}

/**
 * 校验并归一化一组组成员。
 * - 每组须含恰好一个底本片段（底本不得缺文）
 * - 每个抄本至多一个片段，或显式缺文
 * - 片段不得越界，行须属于该抄本且存活
 * - 同一抄本的片段不得与其他 active 组重叠
 * - 只允许引用本文档的抄本
 * excludeGroupId：编辑/修复本组时排除自身
 */
export function validateMembers(
  state: DocState,
  input: MemberInput[],
  excludeGroupId: string | null,
): { members?: NormalizedMember[]; errors: ValidationError[] } {
  const errors: ValidationError[] = [];
  const baseId = state.document.baseManuscriptId;

  if (!baseId || !state.manuscripts.some((m) => m.id === baseId)) {
    errors.push({ location: '文档', reason: '尚未选定底本，无法归组' });
    return { errors };
  }
  if (!Array.isArray(input) || input.length === 0) {
    errors.push({ location: '对应组', reason: '至少需要一个底本片段' });
    return { errors };
  }

  const msOrder = new Map(state.manuscripts.map((m, i) => [m.id, i]));
  const seen = new Map<string, MemberInput>();

  for (const raw of input) {
    const msId = raw.manuscriptId;
    const locBase = lineLabel(state, undefined, msId);

    if (!msId || !msOrder.has(msId)) {
      errors.push({ location: `成员`, reason: `抄本不存在或不属于本文档（${msId ?? '空'}）` });
      continue;
    }
    if (seen.has(msId)) {
      errors.push({
        location: `抄本「${msName(state, msId)}」`,
        reason: '同一抄本在一组中至多占一个片段（或标为缺文）',
      });
      continue;
    }
    seen.set(msId, raw);
    void locBase;
  }

  if (!seen.has(baseId)) {
    errors.push({ location: `抄本「${msName(state, baseId)}」（底本）`, reason: '每组必须包含一个底本片段' });
  }

  // 每个成员自身合法性
  const normalized: NormalizedMember[] = [];
  for (const [msId, raw] of seen) {
    const ord = msOrder.get(msId)!;
    if (raw.missing) {
      if (msId === baseId) {
        errors.push({
          location: `抄本「${msName(state, baseId)}」（底本）`,
          reason: '底本片段不得标为缺文',
        });
        continue;
      }
      normalized.push({ manuscriptId: msId, ord, missing: true, lineId: null, start: 0, end: 0 });
      continue;
    }

    const start = Number(raw.start);
    const end = Number(raw.end);
    const lineId = raw.lineId ?? null;

    if (!lineId) {
      errors.push({
        location: `抄本「${msName(state, msId)}」`,
        reason: '未标为缺文时必须提供片段（抄本、行号、起止位置）',
      });
      continue;
    }
    const line = state.lines.find((l) => l.id === lineId);
    const loc = lineLabel(state, line, msId);
    if (!line) {
      errors.push({ location: `抄本「${msName(state, msId)}」`, reason: `引用的行不存在（${lineId}）` });
      continue;
    }
    if (line.manuscriptId !== msId) {
      errors.push({ location: loc, reason: '该行不属于该抄本' });
      continue;
    }
    if (line.deleted) {
      errors.push({ location: loc, reason: '该行已被删除，请重新选择片段' });
      continue;
    }
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0) {
      errors.push({ location: loc, reason: `片段起点非法（start=${raw.start}）` });
      continue;
    }
    if (end <= start) {
      errors.push({
        location: loc,
        reason: `片段长度必须大于零（区间 [${start}, ${end}) 为空或倒置）`,
      });
      continue;
    }
    const len = codePointLength(line.text);
    if (end > len) {
      errors.push({
        location: loc,
        reason: `片段越界：区间 [${start}, ${end}) 超出本行文字长度 ${len}`,
      });
      continue;
    }

    // 与其他 active 组的重叠检查（同一抄本同一行）
    for (const g of state.groups) {
      if (g.status !== 'active') continue;
      if (excludeGroupId && g.id === excludeGroupId) continue;
      for (const om of g.members) {
        if (om.manuscriptId !== msId || om.missing || om.lineId !== lineId) continue;
        if (rangeOverlaps(start, end, om.start ?? 0, om.end ?? 0)) {
          errors.push({
            location: loc,
            reason: `片段 [${start}, ${end}) 与第 ${g.ord + 1} 组中已有片段 [${om.start}, ${om.end}) 重叠，同一抄本片段不得重复归组`,
          });
        }
      }
    }

    normalized.push({ manuscriptId: msId, ord, missing: false, lineId, start, end });
  }

  normalized.sort((a, b) => a.ord - b.ord);
  return errors.length ? { errors } : { members: normalized, errors: [] };
}

/** 发布前条件：至少两份抄本、有底本、无待修复组、至少一个有效组 */
export function publishPreconditions(state: DocState): ValidationError[] {
  const errors: ValidationError[] = [];
  if (state.manuscripts.length < 2) {
    errors.push({ location: '文档', reason: '至少需要两份抄本才能校勘' });
  }
  if (!state.document.baseManuscriptId) {
    errors.push({ location: '文档', reason: '尚未选定底本' });
  }
  const broken = state.groups.filter((g) => g.status === 'broken');
  for (const g of broken) {
    errors.push({
      location: `第 ${g.ord + 1} 组`,
      reason: `对应组待修复：${g.brokenReason || '请重新校验片段'}。修复前不得发布`,
    });
  }
  if (!state.groups.some((g) => g.status === 'active')) {
    errors.push({ location: '文档', reason: '尚无任何有效对应组，无法形成校勘' });
  }
  return errors;
}

/** 原文改动后判定组是否仍然有效（不要求“底本唯一”结构变化，仅检查引用完整性与区间） */
export function reasonGroupBrokenByLines(
  group: GroupDTO,
  state: DocState,
): string | null {
  const baseId = state.document.baseManuscriptId;
  const baseMember = group.members.find((m) => m.manuscriptId === baseId);
  if (!baseMember) return '缺少底本片段（底本已更换，请重新指定底本对应）';
  if (baseMember.missing) return '底本片段被标为缺文';
  if (!baseMember.lineId) return '底本片段缺少行引用';

  for (const m of group.members) {
    if (m.missing || !m.lineId) continue;
    const line = state.lines.find((l) => l.id === m.lineId);
    const name = msName(state, m.manuscriptId);
    if (!line) return `引用的行已不存在（${name}）`;
    if (line.manuscriptId !== m.manuscriptId) return `成员行归属变化（${name}）`;
    if (line.deleted) return `${name}的引用行（第 ${line.lineNo} 行）已被删除`;
    const len = codePointLength(line.text);
    if ((m.start ?? 0) < 0 || (m.end ?? 0) <= (m.start ?? 0)) {
      return `${name}第 ${line.lineNo} 行片段区间非法`;
    }
    if ((m.end ?? 0) > len) {
      return `${name}第 ${line.lineNo} 行片段越界：原区间 [${m.start}, ${m.end})，本行现长 ${len}`;
    }
  }
  return null;
}
