import type { CodingRun } from '../../api/coding'

const COOKIE = 'rukksh.coding.project'
const LEGACY_COOKIE = 'minis.coding.project'

export function readCodingProject(): string {
  try {
    const cookies = document.cookie.split(';').map(item => item.trim())
    const entry = cookies.find(item => item.startsWith(`${COOKIE}=`))
    if (entry) return decodeURIComponent(entry.slice(COOKIE.length + 1))
    const legacy = cookies.find(item => item.startsWith(`${LEGACY_COOKIE}=`))
    if (!legacy) return ''
    const id = decodeURIComponent(legacy.slice(LEGACY_COOKIE.length + 1))
    rememberCodingProject(id)
    return id
  } catch { return '' }
}

/** 不设置 Expires / Max-Age，项目选择只保留在浏览器会话中。 */
export function rememberCodingProject(id: string): void {
  try {
    const attributes = `; Path=/; SameSite=Lax${location.protocol === 'https:' ? '; Secure' : ''}`
    document.cookie = `${COOKIE}=${encodeURIComponent(id)}${attributes}${id ? '' : '; Max-Age=0'}`
    if (document.cookie.split(';').some(item => item.trim().startsWith(`${LEGACY_COOKIE}=`))) {
      document.cookie = `${LEGACY_COOKIE}=${attributes}; Max-Age=0`
    }
  } catch { /* 禁用 cookie 时仍可通过普通项目链接进入 IDE。 */ }
}

export function resolveCodingProject(params: URLSearchParams, runs: Pick<CodingRun, 'id' | 'repositoryId'>[], remembered: string): string {
  const requested = params.get('project') || runs.find(run => run.id === params.get('run'))?.repositoryId || ''
  // 项目、任务、目录快捷入口及主动打开项目选择，均优先于自动恢复。
  return ['project', 'run', 'workspace', 'directory', 'start'].some(key => params.has(key)) ? requested : remembered
}
