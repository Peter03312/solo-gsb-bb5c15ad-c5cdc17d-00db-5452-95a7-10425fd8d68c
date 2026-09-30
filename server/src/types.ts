// 数据库行类型
export interface DocumentRow {
  id: number;
  title: string;
  base_ms_id: number | null;
  version: number;
  published_ver: number;
}

export interface ManuscriptRow {
  id: number;
  doc_id: number;
  name: string;
  position: number;
}

export interface LineRow {
  id: number;
  ms_id: number;
  line_no: number;
  content: string;
}

export interface GroupRow {
  id: number;
  doc_id: number;
  ord: number;
  broken: boolean;
}

export interface FragmentRow {
  id: number;
  group_id: number;
  doc_id: number;
  ms_id: number;
  line_id: number | null;
  start_cp: number | null;
  end_cp: number | null;
  missing: boolean;
}

export interface EditionRow {
  id: number;
  doc_id: number;
  edition_no: number;
  snapshot: CollationView;
  created_at: string;
}

// ---- 对外（API / 前端）类型 ----

export interface FragmentDTO {
  msId: number;
  missing: boolean;
  lineId?: number | null;
  startCp?: number | null;
  endCp?: number | null;
}

export interface GroupDTO {
  id?: number;
  ord: number;
  fragments: FragmentDTO[];
}

/** 组在某抄本上的呈现片段（读模型，运行时派生）。 */
export interface CellView {
  msId: number;
  missing: boolean;          // 显式缺文
  broken: boolean;           // 原文改动后越界 / 底本已变 → 待修复
  lineNo?: number;
  startCp?: number;
  endCp?: number;
  text?: string;             // 当前原文截取；越界时为越界前可见部分
  oobEnd?: number;           // endCp 超过当前行长时的实际行长
}

export interface GroupView {
  id: number;
  ord: number;
  broken: boolean;
  baseText: string;          // 底本片段文字（底本缺失则为空串）
  inverted: boolean;         // 相对底本顺序的倒置
  cells: CellView[];
  variant: boolean;          // 存在异文
  hasMissing: boolean;       // 存在显式缺文
}

export interface RawLineView {
  lineId: number;
  lineNo: number;
  content: string;
  // 已被有效片段覆盖的码点区间（用于下划线标识），互不重叠
  covered: Array<{ startCp: number; endCp: number; groupId: number; broken: boolean }>;
}

export interface CollationView {
  document: {
    id: number;
    title: string;
    version: number;
    baseMsId: number | null;
    publishedVer: number;
  };
  manuscripts: Array<{ id: number; name: string; position: number; isBase: boolean }>;
  groups: GroupView[];
  /** 各抄本原始行序视图（含未归组文字）。 */
  rawByMs: Array<{ msId: number; lines: RawLineView[] }>;
  stats: {
    manuscriptCount: number;
    lineCount: number;
    groupCount: number;
    brokenCount: number;
  };
}
