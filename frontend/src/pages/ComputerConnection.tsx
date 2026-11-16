import { useEffect, useState } from 'react'
import { requestJson } from '../api/client'
import { apiFetch } from '../api/desktop'
import { terminalError } from '../api/terminal'
import { AppIcon } from '../components/AppIcon'
import FloatWindow from '../components/FloatWindow'

type Status = { desktopLocal: boolean; chromeConnected: boolean; windowCapture: boolean }

function ComputerConnectionWindow({ onClose }: { onClose: () => void }) {
  const [status, setStatus] = useState<Status | null>(null)
  const [connection, setConnection] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(true)

  useEffect(() => {
    let active = true
    requestJson<Status>('/api/computer')
      .then(next => { if (active) setStatus(next) })
      .catch((failure: unknown) => { if (active) setError(terminalError(failure)) })
      .finally(() => { if (active) setBusy(false) })
    return () => { active = false }
  }, [])

  async function refreshStatus() {
    setStatus(await requestJson<Status>('/api/computer'))
  }

  async function run(action: () => Promise<void>) {
    setBusy(true)
    setError('')
    try {
      await action()
    } catch (failure) {
      setError(terminalError(failure))
    } finally {
      setBusy(false)
    }
  }

  async function pair() {
    const result = await requestJson<{ connectionUrl: string }>('/api/computer/chrome/pair', { method: 'POST' })
    setConnection(result.connectionUrl)
    await refreshStatus()
  }

  async function disconnect() {
    await requestJson('/api/computer/chrome/connection', { method: 'DELETE' })
    setConnection('')
    await refreshStatus()
  }

  async function downloadExtension() {
    const response = await apiFetch('/api/computer/chrome/extension', { credentials: 'same-origin' })
    if (!response.ok) throw new Error('扩展下载失败，请重新组装后端运行时后重试')
    const url = URL.createObjectURL(await response.blob())
    const link = document.createElement('a')
    link.href = url
    link.download = 'rukksh-chrome-extension.zip'
    link.click()
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  return (
    <FloatWindow title="电脑与 Chrome" width={600} onClose={onClose}>
      <div className="workspace-computer">
        <div className="workspace-computer__toolbar">
          <p>管理对话中的 Chrome 工具和本机窗口截图。</p>
          <button type="button" className="workspace-button" disabled={busy} onClick={() => void run(refreshStatus)}>
            <AppIcon name="refresh" />刷新状态
          </button>
        </div>
        {error && <p className="workspace-computer__error" role="alert">{error}</p>}
        {!status && busy && <p role="status">正在读取连接状态…</p>}

        {status && (
          <div className="workspace-computer__sections">
            <section className="workspace-computer__section">
              <h3>隔离 Chrome</h3>
              <p>对话中的 Chrome 工具可在独立后台标签页打开网页、读取内容、填写表单和点击按钮。</p>
              {!status.desktopLocal && <p>当前为 Web / 远程模式，仅开放隔离 Chrome。</p>}
            </section>

            {status.desktopLocal && (
              <>
                <section className="workspace-computer__section">
                  <div className="workspace-computer__heading">
                    <h3>个人 Chrome</h3>
                    <span className="workspace-label workspace-label--status" data-enabled={status.chromeConnected}>
                      <span className="workspace-status-dot" data-enabled={status.chromeConnected} />
                      {status.chromeConnected ? '已连接' : '未连接'}
                    </span>
                  </div>
                  <p>配对后可沿用个人 Chrome 的登录状态。Cookie 和登录凭证留在浏览器里，工具在独立后台标签页运行。</p>
                  <div className="workspace-computer__actions">
                    <button type="button" className="workspace-button" disabled={busy} onClick={() => void run(downloadExtension)}>
                      <AppIcon name="download" />下载扩展
                    </button>
                    <button type="button" className="workspace-button workspace-button--primary" disabled={busy} onClick={() => void run(pair)}>
                      <AppIcon name="link" />{status.chromeConnected ? '重新配对' : '生成连接地址'}
                    </button>
                    {status.chromeConnected && (
                      <button type="button" className="workspace-button" disabled={busy} onClick={() => void run(disconnect)}>
                        断开连接
                      </button>
                    )}
                  </div>
                  {connection && (
                    <label className="workspace-computer__address">
                      连接地址（十分钟内有效）
                      <textarea readOnly rows={3} value={connection} onFocus={event => event.target.select()} />
                    </label>
                  )}
                  <details className="workspace-computer__help">
                    <summary>首次配对步骤</summary>
                    <ol>
                      <li>下载并解压扩展，在 Chrome 扩展管理页开启开发者模式。</li>
                      <li>选择「加载已解压的扩展程序」，打开解压后的目录。</li>
                      <li>生成连接地址并粘贴到扩展中。该地址仅用于本机配对。</li>
                    </ol>
                  </details>
                </section>
                <section className="workspace-computer__section">
                  <div className="workspace-computer__heading">
                    <h3>指定窗口截图</h3>
                    <span className="workspace-label workspace-label--status" data-enabled={status.windowCapture}>
                      <span className="workspace-status-dot" data-enabled={status.windowCapture} />
                      {status.windowCapture ? '已就绪' : '不可用'}
                    </span>
                  </div>
                  <p>{status.windowCapture ? '可以在对话中指定应用窗口。' : '需要使用支持窗口截图的 Windows / macOS 桌面端本机模式。'}系统可能要求屏幕录制权限。</p>
                </section>
              </>
            )}
          </div>
        )}
      </div>
    </FloatWindow>
  )
}

export default function ComputerConnection() {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" className="workspace-button" onClick={() => setOpen(true)}>
        <AppIcon name="appearance-system" />Chrome
      </button>
      {open && <ComputerConnectionWindow onClose={() => setOpen(false)} />}
    </>
  )
}
