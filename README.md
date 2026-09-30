# 多抄本校勘 Web 应用（古籍整理）

面向古籍整理团队的多抄本对校工具：对同一篇文献录入 **至少两份抄本** 的逐行文字，
选定 **底本**，将行内连续字句编入 **对应组**；自动呈现异文、缺文、倒置与未归组文字，
并提供「待修复 → 修复 → 发布」的版本化工作流。

技术栈：**Node.js + TypeScript（Express）· React 18 + Vite · PostgreSQL 16**。

---

## 一、一键启动（Docker，推荐）

前置：已安装 Docker 与 Docker Compose v2。

```bash
docker compose up -d --build
```

启动后打开浏览器：

> **http://localhost:4000**

- 端口可通过环境变量 `APP_PORT` 修改（默认 `4000`）；
- 首次启动自动：建库、建表（`db/schema.sql`）、安装全部依赖、构建前端；
- 数据持久化于命名卷 `collation-pgdata`。

常用命令：

```bash
docker compose logs -f app      # 查看应用日志
docker compose down             # 停止（保留数据）
docker compose down -v          # 停止并删除数据库数据
```

### 配置（可选）

复制 `.env.example` 为 `.env` 后修改：

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `APP_PORT` | `4000` | 浏览器访问端口（宿主机） |
| `PGUSER` | `collation` | 数据库用户 |
| `PGPASSWORD` | `collation` | 数据库密码 |
| `PGDATABASE` | `collation` | 数据库名 |

---

## 二、本地开发（不用 Docker）

需要本机已有 PostgreSQL 13+，并预先创建数据库：

```bash
createdb collation
# 表结构由后端启动时自动执行 db/schema.sql 建好；也可手动：
# psql -d collation -f db/schema.sql
```

启动后端（终端 1）：

```bash
cd server
npm install
npm run dev          # http://localhost:4000，热重载
```

启动前端（终端 2）：

```bash
cd web
npm install
npm run dev          # http://localhost:5173 （/api 自动代理到 4000）
```

开发模式请打开 **http://localhost:5173**；生产模式仅暴露 **4000**（Express 托管前端产物）。

后端环境变量（均有默认值）：`PGHOST=localhost PGPORT=5432 PGUSER=collation PGPASSWORD=collation PGDATABASE=collation PORT=4000`。

---

## 三、业务规则与功能

### 录文
- 每份抄本按 **原始行序逐行录入**；新增抄本不限份数。
- 在行文中鼠标拖选连续字句即可就地 **改字**（替换 / 插入 / 删除，删除即替换框留空）。
- 字符位置以 **Unicode 码点** 计，生僻字、扩展区汉字（𫬺、𰻞等）安全。

### 归组规则（保存时强校验，任一不满足即整体拒绝、**绝不部分保存**）
1. 每组 **必须且仅含一个底本片段**（底本片段不能标缺文）；
2. 其他抄本 **每组至多占一个片段**，或对该组显式 **标为缺文**；
3. 同一抄本的片段 **不得在行内重叠归组**（端点相接允许）；
4. 片段不得 **越界**（起点/终点超出该行当前字数）。

校验失败时错误信息逐条给出 **位置与原因**，例如：

> 第 2 组「乙本」越界：该行共 10 字，片段位于第 1 行第 6–99 字；合法范围为第 1–10 字
> 抄本「乙本」第 1 行存在重叠归组：第 1 组 [1, 6) 与第 2 组 [6, 11) 在第 6 字重叠…

组序（底本顺序）必须自 1 连续。

### 对照页
- 上半部 **依底本顺序** 列出每个对应组，自动标注 **异文 / 缺文 / 倒置**；
- 下半部按各抄本 **原始行序** 展示全文：已归组文字加底色，**未归组文字自然完整可见**。

### 改动原文与待修复
- 修改原文时，只有 **受影响** 的对应组变为待修复：
  与改动区间相交、或改动缩短行后导致片段越界的组；
  改动点之后的片段自动平移，不受影响的组保持完好。
- 切换底本后，不含新底本片段的组全部待修复。
- **修复前不得发布新校勘版**；待修复组需逐组重录并通过同一套校验。

### 发布与旧版
- 发布生成 **不可变快照**（JSONB）。发布后继续修改只影响工作版，
  **旧发布版始终可阅读**（“发布与旧版”页签 → 阅读此版）。

### 并发控制
- 所有写请求必须携带 `expectedVersion`（乐观锁）；
- 基于过期版本的修改返回 **409 拒绝**，不做任何写入，前端提示刷新后重试；
- 事务隔离级别为 `SERIALIZABLE`，序列化冲突同样返回 409。

---

## 四、HTTP API 摘要

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/documents` | 文献列表 |
| POST | `/api/documents` | 新建（标题 + ≥2 份抄本名） |
| GET | `/api/documents/:id` | 校勘读模型（组/异文/缺文/倒置/原始行/覆盖区间/版本号） |
| POST | `/api/documents/:id/manuscripts` | 增加抄本 |
| PUT | `/api/documents/:id/base` | 选定底本 |
| POST | `/api/manuscripts/:msId/lines` | 追加一行 |
| PUT | `/api/lines/:lineId` | 行内改字（`startCp/endCp/replacement`） |
| PUT | `/api/documents/:id/groups` | 整批保存对应组（替换式，全量校验） |
| PUT | `/api/documents/:id/groups/:gid/repair` | 修复单个对应组 |
| DELETE | `/api/documents/:id/groups/:gid` | 删除对应组 |
| POST | `/api/documents/:id/publish` | 发布新版（有待修复组则 409） |
| GET | `/api/documents/:id/editions` / `…/editions/:no` | 版本列表 / 阅读旧版快照 |

写请求体均含 `expectedVersion`；错误响应：`{ "error": "...", "details": [ { "code", "message", "groupOrd", "msName", "lineNo", ... } ] }`。

---

## 五、测试

后端使用内嵌 PostgreSQL（PGlite，WASM）做端到端集成测试，无需外部数据库：

```bash
cd server
npm test
```

覆盖：合法归组、异文/缺文判定、倒置、越界/重叠/缺底本/重复抄本报错定位、
整体拒绝不部分保存、乐观锁 409、改字仅波及相关组、平移、缩短越界、
修复流程、发布门禁、旧版快照可读、切换底本等。

---

## 六、目录结构

```
.
├── Dockerfile                # 多阶段构建：前端 → 后端 → 静态托管
├── docker-compose.yml        # 一键：db(PostgreSQL 16) + app
├── db/schema.sql             # 数据库结构（幂等，可重复执行）
├── server/                   # Node.js + TypeScript + Express
│   └── src/ (db/validate/collation/routes/repo/...)
└── web/                      # React 18 + Vite + TypeScript
    └── src/ (录文 / 归组 / 对照 / 发布与旧版)
```
