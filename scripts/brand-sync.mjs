#!/usr/bin/env node
/**
 * 品牌名同步脚本。
 *
 * 以仓库根目录 branding.json 为准，把「无法在构建期直接读取 JSON」的静态文件写回统一值：
 *   - desktop/tauri.conf.json 的 productName / identifier
 *   - desktop/Cargo.toml 的 [[bin]].name（桌面可执行文件名，影响 macOS 开发期应用名）
 *   - backend/pom.xml 的 artifactId / name
 *   - docker-compose.yml 的镜像名 / 容器名
 *
 * 其余各处（前端 Vite、后端 classpath、桌面壳 build.rs）都在构建期直接读 branding.json，
 * 无需本脚本。改正式名称时：改 branding.json → 跑一次本脚本（或被下列构建入口自动调用）：
 *   - desktop/package.json 的 predev / prebuild
 *   - desktop/assemble-runtime.ps1 / desktop/assemble-runtime.sh 的起始处
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const brand = JSON.parse(readFileSync(join(root, 'branding.json'), 'utf8'))

const { displayName, slug, identifier } = brand
const backendName = `${slug}-backend`
const frontendName = `${slug}-frontend`
const binName = /^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(displayName)
  ? displayName
  : slug.replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'desktop'

const changed = []

// 1) desktop/tauri.conf.json：productName / identifier
{
  const file = join(root, 'desktop', 'tauri.conf.json')
  const conf = JSON.parse(readFileSync(file, 'utf8'))
  if (conf.productName !== displayName || conf.identifier !== identifier) {
    conf.productName = displayName
    conf.identifier = identifier
    writeFileSync(file, `${JSON.stringify(conf, null, 2)}\n`)
    changed.push('desktop/tauri.conf.json')
  }
}

// 2) desktop/Cargo.toml：[[bin]].name（避免未打包 dev 运行时在 macOS 上显示 package 名 minis-desktop）
{
  const file = join(root, 'desktop', 'Cargo.toml')
  const before = readFileSync(file, 'utf8')
  const binSectionRe = /\[\[bin\]\][\s\S]*?(?=\r?\n\[|$)/
  let after
  if (binSectionRe.test(before)) {
    after = before.replace(binSectionRe, (section) => {
      if (/^name\s*=\s*"[^"]*"/m.test(section)) {
        return section.replace(/^name\s*=\s*"[^"]*"/m, `name = "${binName}"`)
      }
      return section.replace(/^\[\[bin\]\]\r?\n?/, `[[bin]]\nname = "${binName}"\n`)
    })
  } else {
    after = before.replace(
      /(\[package\][\s\S]*?)(\r?\n)+(?=\[|$)/,
      `$1\n\n[[bin]]\nname = "${binName}"\npath = "src/main.rs"\n\n`,
    )
  }
  if (after !== before) {
    writeFileSync(file, after)
    changed.push('desktop/Cargo.toml')
  }
}

// 3) backend/pom.xml：项目自身的 artifactId / name（父工程 pom 的同名字段保持不动）
{
  const file = join(root, 'backend', 'pom.xml')
  const before = readFileSync(file, 'utf8')
  const after = before
    .replace(
      /(<\/parent>\s*<groupId>[^<]*<\/groupId>\s*<artifactId>)[^<]*(<\/artifactId>)/,
      `$1${backendName}$2`,
    )
    .replace(/(<\/parent>[\s\S]*?<name>)[^<]*(<\/name>)/, `$1${backendName}$2`)
  if (after !== before) {
    writeFileSync(file, after)
    changed.push('backend/pom.xml')
  }
}

// 4) docker-compose.yml：镜像名 / 容器名
{
  const file = join(root, 'docker-compose.yml')
  const before = readFileSync(file, 'utf8')
  const after = before
    .replace(/(image:\s*)\S*-backend:latest/g, `$1${backendName}:latest`)
    .replace(/(image:\s*)\S*-frontend:latest/g, `$1${frontendName}:latest`)
    .replace(/(container_name:\s*)\S*-backend\b/g, `$1${backendName}`)
    .replace(/(container_name:\s*)\S*-frontend\b/g, `$1${frontendName}`)
  if (after !== before) {
    writeFileSync(file, after)
    changed.push('docker-compose.yml')
  }
}

console.log(
  changed.length
    ? `[brand-sync] 已同步: ${changed.join(', ')}`
    : '[brand-sync] 无需变更（静态文件已是最新）',
)
