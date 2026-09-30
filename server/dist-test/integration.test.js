"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const assert = __importStar(require("assert"));
const http_1 = require("http");
const app_1 = require("./app");
const db_1 = require("./db");
// 使用真实 PostgreSQL 语义（PGlite / WASM）端到端校验全部业务规则。
async function startServer() {
    await (0, db_1.initSchema)();
    const server = (0, http_1.createServer)((0, app_1.createApp)());
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    const port = server.address().port;
    return {
        base: `http://127.0.0.1:${port}/api`,
        close: () => new Promise((r) => server.close(() => r())),
    };
}
let seq = 0;
async function call(base, method, url, body) {
    const res = await fetch(base + url, {
        method,
        headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
        body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    let json = null;
    try {
        json = await res.json();
    }
    catch {
        /* no body */
    }
    return { status: res.status, json };
}
async function expectFail(r, status, phrase) {
    assert.strictEqual(r.status, status, `期望 ${status}，实际 ${r.status}: ${JSON.stringify(r.json)}`);
    assert.ok(JSON.stringify(r.json).includes(phrase), `错误信息应包含「${phrase}」，实际：${JSON.stringify(r.json)}`);
}
async function main() {
    const { base, close } = await startServer();
    try {
        // ---------- 建档 ----------
        let r = await call(base, 'POST', '/documents', {
            title: `集成测试文献 ${++seq}`,
            manuscripts: ['甲本', '乙本', '丙本'],
        });
        assert.strictEqual(r.status, 201, JSON.stringify(r.json));
        const docId = r.json.id;
        let view = (await call(base, 'GET', `/documents/${docId}`)).json;
        const v1 = view.document.version;
        assert.strictEqual(v1, 1);
        const [msA, msB, msC] = view.manuscripts;
        assert.strictEqual(msA.name, '甲本');
        assert.ok(msA.isBase, '第一份抄本应为默认底本');
        // ---------- 逐行录文 ----------
        // 甲本（底本）：
        //  行1 天命之謂性率性之謂道
        //  行2 修道之謂教
        // 乙本：
        //  行1 天命之謂姓率性之謂道
        //  行2 修道之謂教也
        // 丙本：
        //  行1 天命之謂性
        //  行2 修道之謂教
        await call(base, 'POST', `/manuscripts/${msA.id}/lines`, { expectedVersion: v1, content: '天命之謂性率性之謂道' });
        await call(base, 'POST', `/manuscripts/${msA.id}/lines`, { expectedVersion: 2, content: '修道之謂教' });
        await call(base, 'POST', `/manuscripts/${msB.id}/lines`, { expectedVersion: 3, content: '天命之謂姓率性之謂道' });
        await call(base, 'POST', `/manuscripts/${msB.id}/lines`, { expectedVersion: 4, content: '修道之謂教也' });
        await call(base, 'POST', `/manuscripts/${msC.id}/lines`, { expectedVersion: 5, content: '天命之謂性' });
        await call(base, 'POST', `/manuscripts/${msC.id}/lines`, { expectedVersion: 6, content: '修道之謂教' });
        view = (await call(base, 'GET', `/documents/${docId}`)).json;
        const v7 = view.document.version;
        assert.strictEqual(v7, 7);
        const lines = (msId) => view.rawByMs.find((x) => x.msId === msId).lines;
        const a1 = lines(msA.id)[0].lineId;
        const a2 = lines(msA.id)[1].lineId;
        const b1 = lines(msB.id)[0].lineId;
        const b2 = lines(msB.id)[1].lineId;
        const c1 = lines(msC.id)[0].lineId;
        const c2 = lines(msC.id)[1].lineId;
        // ---------- 归组：合法整批 ----------
        const goodGroups = [
            // 组1 天命之謂性 / 天命之謂姓（异文）/ 天命之謂性
            { ord: 1, fragments: [
                    { msId: msA.id, lineId: a1, startCp: 0, endCp: 5 },
                    { msId: msB.id, lineId: b1, startCp: 0, endCp: 5 },
                    { msId: msC.id, lineId: c1, startCp: 0, endCp: 5 },
                ] },
            // 组2 率性之謂道 / 率性之謂道 / 缺文
            { ord: 2, fragments: [
                    { msId: msA.id, lineId: a1, startCp: 5, endCp: 10 },
                    { msId: msB.id, lineId: b1, startCp: 5, endCp: 10 },
                    { msId: msC.id, missing: true },
                ] },
            // 组3 修道之謂教（三者同文；丙本行2）
            { ord: 3, fragments: [
                    { msId: msA.id, lineId: a2, startCp: 0, endCp: 5 },
                    { msId: msB.id, lineId: b2, startCp: 0, endCp: 5 },
                    { msId: msC.id, lineId: c2, startCp: 0, endCp: 5 },
                ] },
        ];
        r = await call(base, 'PUT', `/documents/${docId}/groups`, { expectedVersion: v7, groups: goodGroups });
        assert.strictEqual(r.status, 200, JSON.stringify(r.json));
        view = (await call(base, 'GET', `/documents/${docId}`)).json;
        assert.strictEqual(view.stats.groupCount, 3);
        assert.strictEqual(view.stats.brokenCount, 0);
        assert.strictEqual(view.groups[0].variant, true, '性/姓应为异文');
        assert.strictEqual(view.groups[0].baseText, '天命之謂性');
        assert.strictEqual(view.groups[1].hasMissing, true, '丙本缺文');
        assert.strictEqual(view.groups[2].variant, false);
        // 未归组文字仍可见：乙本行2「也」无覆盖
        const b2view = view.rawByMs.find((x) => x.msId === msB.id).lines[1];
        assert.strictEqual(b2view.covered.length, 1);
        assert.strictEqual(b2view.covered[0].endCp, 5);
        // ---------- 错误：越界片段（须指出位置，不保存） ----------
        const badRange = JSON.parse(JSON.stringify(goodGroups));
        badRange[1].fragments[1] = { msId: msB.id, lineId: b1, startCp: 5, endCp: 99 };
        r = await call(base, 'PUT', `/documents/${docId}/groups`, { expectedVersion: view.document.version, groups: badRange });
        await expectFail(r, 400, '越界');
        assert.ok(r.json.details.some((d) => d.code === 'OUT_OF_RANGE' && d.lineNo === 1));
        // ---------- 错误：同一抄本重叠归组 ----------
        const overlap = JSON.parse(JSON.stringify(goodGroups));
        overlap[0].fragments[1] = { msId: msB.id, lineId: b1, startCp: 0, endCp: 6 }; // 与组2 [5,10) 重叠
        r = await call(base, 'PUT', `/documents/${docId}/groups`, { expectedVersion: view.document.version, groups: overlap });
        await expectFail(r, 400, '重叠归组');
        assert.ok(r.json.details.some((d) => d.code === 'OVERLAP'));
        // ---------- 错误：缺少底本片段 ----------
        const noBase = JSON.parse(JSON.stringify(goodGroups));
        noBase[0].fragments = noBase[0].fragments.filter((f) => f.msId !== msA.id);
        r = await call(base, 'PUT', `/documents/${docId}/groups`, { expectedVersion: view.document.version, groups: noBase });
        await expectFail(r, 400, '缺少底本片段');
        assert.ok(r.json.details.some((d) => d.code === 'NO_BASE'));
        // ---------- 错误：底本片段被标缺文 ----------
        const baseMissing = JSON.parse(JSON.stringify(goodGroups));
        baseMissing[0].fragments[0] = { msId: msA.id, missing: true };
        r = await call(base, 'PUT', `/documents/${docId}/groups`, { expectedVersion: view.document.version, groups: baseMissing });
        await expectFail(r, 400, '底本片段被标为缺文');
        // ---------- 错误：同组同抄本两个片段 ----------
        const dupMs = JSON.parse(JSON.stringify(goodGroups));
        dupMs[0].fragments.push({ msId: msB.id, lineId: b1, startCp: 8, endCp: 9 });
        r = await call(base, 'PUT', `/documents/${docId}/groups`, { expectedVersion: view.document.version, groups: dupMs });
        await expectFail(r, 400, '出现多个片段');
        // ---------- 错误：不能部分保存 —— 校验失败后已保存数据保持 3 组完好 ----------
        view = (await call(base, 'GET', `/documents/${docId}`)).json;
        assert.strictEqual(view.stats.groupCount, 3);
        assert.strictEqual(view.stats.brokenCount, 0);
        // ---------- 乐观锁：过期版本拒绝 ----------
        r = await call(base, 'PUT', `/documents/${docId}/groups`, { expectedVersion: v7, groups: goodGroups });
        await expectFail(r, 409, '版本已过期');
        r = await call(base, 'POST', `/manuscripts/${msA.id}/lines`, { expectedVersion: 1, content: '过期请求' });
        await expectFail(r, 409, '版本已过期');
        // ---------- 改原文：只使受影响组待修复 ----------
        // 乙本行1「天命之謂姓率性之謂道」把「姓」改为「性」（[4,5)），与组1相交
        r = await call(base, 'PUT', `/lines/${b1}`, { expectedVersion: view.document.version, startCp: 4, endCp: 5, replacement: '性' });
        assert.strictEqual(r.status, 200, JSON.stringify(r.json));
        view = (await call(base, 'GET', `/documents/${docId}`)).json;
        assert.strictEqual(view.stats.brokenCount, 1, '仅组1受影响');
        assert.strictEqual(view.groups[0].broken, true);
        assert.strictEqual(view.groups[1].broken, false);
        assert.strictEqual(view.groups[2].broken, false);
        const curVer = view.document.version;
        // 待修复期间不得发布
        r = await call(base, 'POST', `/documents/${docId}/publish`, { expectedVersion: curVer });
        await expectFail(r, 409, '待修复');
        // ---------- 修复组1（异文消失） ----------
        const g1id = view.groups[0].id;
        r = await call(base, 'PUT', `/documents/${docId}/groups/${g1id}/repair`, {
            expectedVersion: curVer,
            group: { ord: 1, fragments: [
                    { msId: msA.id, lineId: a1, startCp: 0, endCp: 5 },
                    { msId: msB.id, lineId: b1, startCp: 0, endCp: 5 },
                    { msId: msC.id, lineId: c1, startCp: 0, endCp: 5 },
                ] },
        });
        assert.strictEqual(r.status, 200, JSON.stringify(r.json));
        view = (await call(base, 'GET', `/documents/${docId}`)).json;
        assert.strictEqual(view.stats.brokenCount, 0);
        assert.strictEqual(view.groups[0].variant, false, '改字后甲乙一致，不再是异文');
        // 修复时与其他组重叠 → 拒绝
        r = await call(base, 'PUT', `/documents/${docId}/groups/${g1id}/repair`, {
            expectedVersion: view.document.version,
            group: { ord: 1, fragments: [
                    { msId: msA.id, lineId: a1, startCp: 0, endCp: 6 }, // 与组2 [5,10) 重叠
                    { msId: msB.id, lineId: b1, startCp: 0, endCp: 5 },
                    { msId: msC.id, lineId: c1, startCp: 0, endCp: 5 },
                ] },
        });
        await expectFail(r, 400, '重叠归组');
        // 失败的修复不得改动既有状态
        view = (await call(base, 'GET', `/documents/${docId}`)).json;
        assert.strictEqual(view.stats.brokenCount, 0);
        // ---------- 插入导致后方片段平移（不受影响、不待修复） ----------
        // 乙本行2「修道之謂教也」：在开头插入「曰」[0,0)。组3片段 [0,5) 与插入点端点相接（不相交）→ 平移到 [1,6)
        r = await call(base, 'PUT', `/lines/${b2}`, { expectedVersion: view.document.version, startCp: 0, endCp: 0, replacement: '曰' });
        assert.strictEqual(r.status, 200, JSON.stringify(r.json));
        view = (await call(base, 'GET', `/documents/${docId}`)).json;
        assert.strictEqual(view.stats.brokenCount, 0, '端点相接的插入不应使组待修复');
        const b2cell = view.groups[2].cells.find((c) => c.msId === msB.id);
        assert.strictEqual(b2cell.text, '修道之謂教', '平移后截取文字不变');
        assert.strictEqual(b2cell.startCp, 1);
        assert.strictEqual(b2cell.endCp, 6);
        // ---------- 缩短导致越界 → 待修复，且修复前不得发布 ----------
        // 把甲本行1删到只剩 3 字：组1 [0,5)、组2 [5,10) 都失效
        r = await call(base, 'PUT', `/lines/${a1}`, { expectedVersion: view.document.version, startCp: 3, endCp: 10, replacement: '' });
        assert.strictEqual(r.status, 200, JSON.stringify(r.json));
        view = (await call(base, 'GET', `/documents/${docId}`)).json;
        assert.strictEqual(view.stats.brokenCount, 2);
        r = await call(base, 'POST', `/documents/${docId}/publish`, { expectedVersion: view.document.version });
        await expectFail(r, 409, '不得发布');
        // 恢复原文（重新追加），再修复两组
        r = await call(base, 'PUT', `/lines/${a1}`, { expectedVersion: view.document.version, startCp: 3, endCp: 3, replacement: '之謂性率性之謂道' });
        assert.strictEqual(r.status, 200, JSON.stringify(r.json));
        view = (await call(base, 'GET', `/documents/${docId}`)).json;
        // 追加后区间仍保持原样且重新有效？[0,5) 现在合法、[5,10) 合法 —— 但组仍被标 broken（只增不减）
        assert.strictEqual(view.stats.brokenCount, 2);
        for (const g of view.groups.filter((x) => x.broken)) {
            const cells = g.cells;
            const rebuild = [];
            for (const ms of view.manuscripts) {
                const cell = cells.find((c) => c.msId === ms.id);
                if (cell.missing)
                    rebuild.push({ msId: ms.id, missing: true });
                else if (cell.startCp != null) {
                    // 重新定位行 id（按行号）
                    const ln = view.rawByMs.find((x) => x.msId === ms.id).lines.find((l) => l.lineNo === cell.lineNo);
                    rebuild.push({ msId: ms.id, lineId: ln.lineId, startCp: cell.startCp, endCp: cell.endCp });
                }
            }
            const rr = await call(base, 'PUT', `/documents/${docId}/groups/${g.id}/repair`, {
                expectedVersion: view.document.version,
                group: { ord: g.ord, fragments: rebuild },
            });
            assert.strictEqual(rr.status, 200, JSON.stringify(rr.json));
            view = (await call(base, 'GET', `/documents/${docId}`)).json;
        }
        assert.strictEqual(view.stats.brokenCount, 0);
        // ---------- 发布 ----------
        r = await call(base, 'POST', `/documents/${docId}/publish`, { expectedVersion: view.document.version });
        assert.strictEqual(r.status, 201, JSON.stringify(r.json));
        assert.strictEqual(r.json.editionNo, 1);
        view = (await call(base, 'GET', `/documents/${docId}`)).json;
        assert.strictEqual(view.document.publishedVer, 1);
        // 旧版可读（快照）
        const ed = (await call(base, 'GET', `/documents/${docId}/editions/1`)).json;
        assert.strictEqual(ed.view.document.title, view.document.title);
        assert.strictEqual(ed.view.groups.length, 3);
        const eds = (await call(base, 'GET', `/documents/${docId}/editions`)).json;
        assert.strictEqual(eds.editions.length, 1);
        // 发布后继续改原文 → 出现待修复，但旧版仍可读、且不允许发新版
        r = await call(base, 'PUT', `/lines/${a2}`, { expectedVersion: view.document.version, startCp: 0, endCp: 1, replacement: '脩' });
        assert.strictEqual(r.status, 200, JSON.stringify(r.json));
        view = (await call(base, 'GET', `/documents/${docId}`)).json;
        assert.ok(view.stats.brokenCount >= 1);
        r = await call(base, 'POST', `/documents/${docId}/publish`, { expectedVersion: view.document.version });
        await expectFail(r, 409, '不得发布');
        const oldEd = await call(base, 'GET', `/documents/${docId}/editions/1`);
        assert.strictEqual(oldEd.status, 200, '旧发布版必须仍可阅读');
        // ---------- 倒置检测：另建一文献 ----------
        r = await call(base, 'POST', '/documents', { title: `倒置测试 ${++seq}`, manuscripts: ['底', 'W'] });
        assert.strictEqual(r.status, 201);
        const d2 = r.json.id;
        let v2doc = (await call(base, 'GET', `/documents/${d2}`)).json;
        let ver = v2doc.document.version;
        const base2 = v2doc.manuscripts[0];
        const wit2 = v2doc.manuscripts[1];
        // 底：行1 AB；W：行1 BA
        await call(base, 'POST', `/manuscripts/${base2.id}/lines`, { expectedVersion: ver++, content: 'AB' });
        await call(base, 'POST', `/manuscripts/${wit2.id}/lines`, { expectedVersion: ver++, content: 'BA' });
        v2doc = (await call(base, 'GET', `/documents/${d2}`)).json;
        const bl = v2doc.rawByMs.find((x) => x.msId === base2.id).lines[0].lineId;
        const wl = v2doc.rawByMs.find((x) => x.msId === wit2.id).lines[0].lineId;
        // 组1: 底 A / W 第2字；组2: 底 B / W 第1字 → W 中顺序倒置
        r = await call(base, 'PUT', `/documents/${d2}/groups`, {
            expectedVersion: ver,
            groups: [
                { ord: 1, fragments: [
                        { msId: base2.id, lineId: bl, startCp: 0, endCp: 1 },
                        { msId: wit2.id, lineId: wl, startCp: 1, endCp: 2 },
                    ] },
                { ord: 2, fragments: [
                        { msId: base2.id, lineId: bl, startCp: 1, endCp: 2 },
                        { msId: wit2.id, lineId: wl, startCp: 0, endCp: 1 },
                    ] },
            ],
        });
        assert.strictEqual(r.status, 200, JSON.stringify(r.json));
        v2doc = (await call(base, 'GET', `/documents/${d2}`)).json;
        assert.ok(v2doc.groups[0].inverted && v2doc.groups[1].inverted, '两组都应标倒置');
        // ---------- 切底本：不含新底本片段的组待修复 ----------
        // 给 d2 加第三个抄本 C 并切为底本（其行无任何片段）
        r = await call(base, 'POST', `/documents/${d2}/manuscripts`, { expectedVersion: v2doc.document.version, name: 'C' });
        assert.strictEqual(r.status, 201);
        v2doc = (await call(base, 'GET', `/documents/${d2}`)).json;
        const cId3 = v2doc.manuscripts.find((m) => m.name === 'C').id;
        r = await call(base, 'PUT', `/documents/${d2}/base`, { expectedVersion: v2doc.document.version, msId: cId3 });
        assert.strictEqual(r.status, 200);
        v2doc = (await call(base, 'GET', `/documents/${d2}`)).json;
        assert.strictEqual(v2doc.stats.brokenCount, 2, '切换底本后原两组均缺新底本片段');
        console.log('✅ 全部集成测试通过');
    }
    finally {
        await close();
    }
}
main().catch((e) => {
    console.error(e);
    process.exit(1);
});
