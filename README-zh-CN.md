<div align="center">

<img src="./design/brand/logo-candidates-2026-10-30/png/rukksh-graphite-macos-white-1024.png" alt="Rukksh" width="96" height="96">

# Rukksh

**又一个个人 AI 助手**

自托管的 AI 工作台，把对话、个人知识和项目放在一起。

[![Docker 构建与验证](https://github.com/ginpika/rukksh/actions/workflows/docker-build.yml/badge.svg)](https://github.com/ginpika/rukksh/actions/workflows/docker-build.yml)
[![Docker AMD64 / ARM64](https://img.shields.io/badge/Docker-AMD64%20%2F%20ARM64-2496ED?logo=docker&logoColor=white)](#prebuilt)

[English](./README.md) · **简体中文**

[界面预览](#preview) · [功能](#features) · [快速开始](#quick-start) · [预构建镜像](#prebuilt) · [文档](#documentation)

</div>

<a id="preview"></a>

![Rukksh 对话首页，左侧为助手列表，中间为消息输入区](./docs/assets/readme-home.png)

<a id="features"></a>

## 功能

| 场景 | 能做什么 |
| --- | --- |
| **对话与智能体** | 接入 OpenAI Chat Completions 或 Anthropic Messages 接口，切换模型，为智能体配置各自的提示词、工具和记忆。 |
| **个人知识库** | 导入和整理文档，保存网页快照，通过检索和知识图谱浏览资料。 |
| **项目与编程** | 在不同会话间延续项目上下文，浏览工作空间文件，审阅编程智能体提出的修改。 |
| **多智能体协作** | 分配角色，跟进任务执行过程，在同一个协作空间查看产出。 |

<a id="quick-start"></a>

## 快速开始

安装 Docker 后，用一个容器启动 Rukksh。`rukksh-data` 卷会在升级时保留 SQLite 和应用文件。若镜像需要鉴权，先登录 `ghcr.io`。

```sh
docker run -d --name rukksh --init --restart unless-stopped --shm-size 256m \
  -p 18081:18081 -v rukksh-data:/data ghcr.io/ginpika/rukksh:latest
```

打开 [http://localhost:18081](http://localhost:18081)，进入 **设置 → 大模型**，填写接口格式、服务地址、模型 ID，以及服务所需的 API Key。测试连接后，将该模型设为新会话的默认模型。

可用 `--env-file` 或 `-e` 传入 `SSO_SERVER_URL` 等部署参数。使用需要 Chromium 沙箱的功能时，可在仓库目录为 `docker run` 添加 `--security-opt seccomp=./backend/browser-seccomp.json`，也可使用下方的单容器源码部署，它会自动加载该配置。

### 从源码构建

安装 **Git、Docker 和 Docker Compose 2.24.0 或更新版本**。按部署方式选一条 Compose 命令执行。

```sh
git clone https://github.com/ginpika/rukksh.git
cd rukksh
# 前后端单容器
docker compose -f docker-compose.yml -f docker-compose.fullstack.yml up -d --build rukksh

# 前后端分离
docker compose up -d --build
```

两种 Compose 部署使用相同的默认端口和数据卷。修改根目录 `.env` 中的 `RUKKSH_HOST_PORT` 可调整网页端口。需要修改其他部署参数时，将 [后端环境变量示例](./backend/.env.example) 复制为 `backend/.env`。

<a id="prebuilt"></a>

## 预构建镜像

GitHub Actions 在 Linux AMD64 和 ARM64 上构建并验证 `rukksh`、`rukksh-frontend` 和 `rukksh-backend`。Pull Request 运行检查。推送到 `main` 或 `master`、推送 `v*` 标签、手动运行工作流时，会向 GitHub Container Registry 发布这三个镜像，并添加 `sha-<完整提交 SHA>` 标签。默认分支的当前提交还会更新 `latest`，版本发布会添加 `v1.2.3` 这样的标签。

固定单容器版本时，将快速开始命令中的 `latest` 替换为已发布的 SHA 标签或版本标签。使用分离式预构建镜像时，从发布任务摘要复制 `RUKKSH_IMAGE_TAG`，在对应提交的仓库目录运行以下命令。

```sh
export RUKKSH_IMAGE_TAG='sha-<完整提交 SHA>'
docker compose -f docker-compose.yml -f docker-compose.ghcr.yml pull
docker compose -f docker-compose.yml -f docker-compose.ghcr.yml up -d
```

[GHCR Compose 覆盖文件](./docker-compose.ghcr.yml) 用同一个标签选择前后端镜像，沿用源码部署的端口和数据卷。使用派生仓库发布的包时，将 `RUKKSH_IMAGE_NAMESPACE` 设为 `ghcr.io/<owner>/<repo>`。

## 备份与升级

升级或切换部署方式前，先停止应用并备份整个 `/data` 数据卷。启动时沿用原数据卷。用 `docker run` 部署时，拉取新镜像，执行 `docker rm rukksh` 删除已停止的旧容器，再用原数据卷执行快速开始命令。用 Compose 部署时，重新运行对应的构建命令，或更新 `RUKKSH_IMAGE_TAG` 后拉取预构建镜像。原 Minis 部署请参阅 [数据迁移说明](./BRANDING.md#5-已有安装升级到-rukksh)。

## 本地开发

前端使用 React、TypeScript 和 Vite，后端使用 Java 21、Spring Boot 和 SQLite，桌面端使用 Tauri。

```sh
# 后端，在仓库根目录执行，需要 JDK 21
cd backend
sh ./mvnw spring-boot:run
```

```sh
# 前端，在另一个终端从仓库根目录执行，需要 Node.js 22.12+
cd frontend
npm ci
npm run dev
```

打开 [http://localhost:5173](http://localhost:5173)。Vite 将 API 请求代理到 `18081` 端口上的后端。

<a id="documentation"></a>

## 文档

| 主题 | 指南 |
| --- | --- |
| 后端结构 | [后端架构](./backend/ARCHITECTURE.md) |
| 记忆与知识库 | [记忆体系](./docs/memory/memory-v6.md) |
| 项目与编程 | [工作空间与项目入口](./docs/ai-coding/AI-Coding工作空间与项目入口-2026-10-14.md) |
| 多智能体协作 | [协作工作空间](./docs/design/collaboration-workspace.md) |
| 桌面端 | [桌面端开发与打包](./desktop/README.md) |
| 品牌与升级 | [品牌配置与旧版数据迁移](./BRANDING.md) |
