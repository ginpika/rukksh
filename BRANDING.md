# 品牌配置说明（Branding）

本项目所有**面向用户显示的正式名称**与**构建产物名**都收敛到根目录一个文件：`branding.json`。
改正式名称时只改这一个文件，前端、后端、桌面端统一生效——不需要在三个技术栈里逐个搜索替换。

---

## 1. 唯一配置源：`branding.json`

```json
{
  "displayName": "Rukksh",
  "slug": "rukksh",
  "tagline": "从零开始的构建",
  "webTitleSuffix": "",
  "identifier": "cc.ginpika.rukksh"
}
```

| 字段 | 含义 | 字符约束 | 用在哪 |
|---|---|---|---|
| `displayName` | 面向用户显示的正式名称 | 无限制（可中文、大写、空格） | 网页标题、页脚、关于页、桌面窗口标题、桌面引导页 `h1`、桌面应用名（productName） |
| `slug` | 技术标识（"机器名"） | 仅小写 ASCII：`a-z 0-9 . _ -` | 容器名、镜像名、jar 名、服务标识、Spring 应用名 |
| `tagline` | 一句话标语 | 无限制 | 页面页脚、桌面引导页副标题 |
| `webTitleSuffix` | 网页标题后缀 | 无限制 | 拼接为 `<displayName> · <webTitleSuffix>` |
| `identifier` | 应用唯一标识（反向域名） | 反向域名格式 | Tauri `bundle.identifier`、应用数据目录名 |

### 派生规则（不用手写，由各端代码计算）

| 产物 | 规则 | 示例 |
|---|---|---|
| 网页标题 | 有后缀时拼接名称和后缀 | `Rukksh` |
| 页脚 | `<displayName> · <tagline>` | `Rukksh · 从零开始的构建` |
| 关于页小标签 | `displayName` 大写 | `RUKKSH` |
| 健康检查服务标识 | `<slug>-backend` | `rukksh-backend` |
| 桌面运行时 jar | `<slug>-backend.jar` | `rukksh-backend.jar` |
| 默认后端容器名 | `<slug>-backend` | `rukksh-backend` |
| 终端会话容器前缀 | `<slug>-term-` | `rukksh-term-` |
| 远程地址占位符 | `https://<slug>.example.com` | `https://rukksh.example.com` |

### 常见误区

- **`displayName` 支持中文。** `slug` 用于容器名、JAR 文件名和 Spring 应用名，需要符合上表的字符约束。
- **`identifier` 的最后一段通常等于 `slug`。** 系统用它识别安装包及应用数据目录，升级已有安装时按下文迁移。

---

## 2. 三端如何读取（构建期注入）

前端、后端、桌面端都在**编译 / 打包那一刻**读 `branding.json`，把值烧进各自产物，运行时零开销、零额外请求。

| 端 | 读取位置 | 注入方式 |
|---|---|---|
| 前端 | `frontend/vite.config.ts`（Vite 配置即 Node 程序） | `transformIndexHtml` 钩子把 `index.html` 的 `__BRAND_TITLE__` 占位符替换为标题 |
| 前端（TS 代码） | `frontend/src/branding.ts` | `import` JSON，打包器内联为常量，供 `App.tsx` / `About.tsx` / `Workspace.tsx` 使用 |
| 后端 | `backend/pom.xml` 的 `<resources>` 把根 JSON 拷进 classpath | `config/Branding.java` 用 Jackson 解析 |
| 后端（应用名） | `RukkshApplication` 在 Spring 启动前 | `setDefaultProperties("spring.application.name", ...)` |
| 桌面壳（Rust） | `desktop/build.rs` | `cargo:rustc-env` 注入环境变量，代码里用 `env!()` 宏在**编译期**取值 |
| 桌面壳（引导页 HTML） | `desktop/src/main.rs` | `initialization_script` 注入 `window.__BRAND__`，页面脚本据此设置 `title` / `h1` / 占位符 |

三种注入手法：
1. **占位符替换**——HTML 里的 `__BRAND_TITLE__`；
2. **编译期常量**——TS 的 JSON import、Rust 的 `env!`；
3. **启动前属性**——Spring 的 `setDefaultProperties`。

---

## 3. 同步脚本（打包前写回静态文件）

有四份文件**读不了 JSON**，因为它们的消费者在很早的阶段解析且不支持变量：

| 文件 | 消费者 | 原因 |
|---|---|---|
| `desktop/tauri.conf.json` | Tauri CLI | 纯静态 JSON，`productName` 无变量能力 |
| `desktop/Cargo.toml` | Cargo / macOS LaunchServices | `[[bin]].name` 决定编译出的可执行文件名（未打包的 `tauri dev` 运行时依赖它显示应用名）；`displayName` 含空格或非 ASCII 时回退到 `slug` |
| `backend/pom.xml` | Maven 模型 | `<artifactId>` 在插件运行前就已定型 |
| `docker-compose.yml` | Docker Compose | 只读环境变量，不读 JSON |

因此由 `scripts/brand-sync.mjs` 在打包前把它们写回统一值（结构化改写、幂等，重复执行无副作用）。

该脚本已挂到下列构建入口，通常**无需手动执行**：

- `desktop/package.json` 的 `predev` / `prebuild`
- `desktop/assemble-runtime.ps1` / `desktop/assemble-runtime.sh`（起始处）

手动执行：

```bash
node scripts/brand-sync.mjs
```

---

## 4. 改正式名称的标准流程

1. 编辑根目录 `branding.json`（改 `displayName`；如需同时改技术标识，改 `slug`，并同步 `identifier`）。
2. 运行一次同步脚本（或直接走任一构建入口，会自动触发）：
   ```bash
   node scripts/brand-sync.mjs
   ```
3. 重新构建需要出包的端（前端 `npm run build`、后端 `./mvnw package`、桌面 `npm run build`）。

> 说明：前端 / 后端 / 桌面壳的构建期读取是自动的；第 2 步只负责那四份静态配置文件。

---

## 5. 已有安装升级到 Rukksh

- 将部署配置中的 `MINIS_*` 环境变量改为 `RUKKSH_*`，Spring 自定义属性前缀改为 `rukksh.*`。前端、后端、桌面壳及 Chrome 扩展使用同一版构建。独立 Linux 部署按 `backend/.env.example` 安装新版沙箱程序。
- 后端从 `backend/` 启动时，默认查找 `../data/rukksh.db`。若只有原来的 `../data/minis.db`，会直接打开该库。自定义路径通过 `RUKKSH_DB_PATH` 指定。应用会在数据库版本迁移前创建 SQLite 备份。
- Docker Compose 升级前，查出旧后端挂载到 `/data` 的实际卷名。在旧项目中运行 `docker compose down`，保留数据卷。首次启动新版前，在仓库根目录的 `.env` 中设置 `RUKKSH_DATA_VOLUME=<现有卷名>`、`RUKKSH_DATA_VOLUME_EXTERNAL=true` 和 `RUKKSH_DB_PATH=/data/minis.db`。全新安装默认使用 `rukksh-data` 卷和 `/data/rukksh.db`。
- 桌面端默认使用标识 `cc.ginpika.rukksh` 对应的应用配置及数据目录。若旧版使用 `cc.ginpika.minis`，先退出旧版，再将原目录中的 `config.json` 及业务数据复制到新版的对应目录。在 macOS，配置和数据目录都位于 `~/Library/Application Support/` 下。备份 SQLite 时请使用 SQLite 的备份功能，或在确认旧进程已退出后复制完整数据。新版可在自己的目录中打开旧名 SQLite 文件，HostID 可能需要重新登录。
- 同源网页首次打开时会迁移原有的浏览器偏好和会话内项目选择。若部署同时更换域名，浏览器会为新域名使用独立存储。

---

## 6. 验证

```bash
# 前端：类型检查 + 构建（同时验证 JSON import 与标题注入）
cd frontend && npm run build
# 构建产物标题应为 "<displayName> · <webTitleSuffix>"
grep "<title>" dist/index.html

# 后端：编译（resources 阶段会把 branding.json 拷进 classpath）
cd backend && sh ./mvnw -B -DskipTests clean compile
# 分层守门测试
sh ./mvnw -B -Dtest=LayeringTest test

# 桌面壳：编译（build.rs 读取并注入环境变量）
cd desktop && cargo check
```
