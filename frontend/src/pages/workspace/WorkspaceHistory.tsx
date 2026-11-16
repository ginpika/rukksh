import type { TerminalCommand } from '../../api/client'
import { AppIcon } from '../../components/AppIcon'
import FloatWindow from '../../components/FloatWindow'
import './workspaceTools.css'

export default function WorkspaceHistory({
  commands,
  loading,
  error,
  onRefresh,
  onClose,
}: {
  commands: TerminalCommand[]
  loading: boolean
  error: string | null
  onRefresh: () => void
  onClose: () => void
}) {
  return (
    <FloatWindow
      title={<span className="workspace-tools__title"><AppIcon name="clock" /><span>最近执行</span></span>}
      onClose={onClose}
      width={660}
    >
      <div className="workspace-tools workspace-tools--history">
        <div className="workspace-tools__history-head">
          <p className="workspace-tools__note">最近 20 条单次命令，交互式 Shell 命令不计入。</p>
          <button
            type="button"
            className="workspace-tools__button"
            aria-disabled={loading}
            onClick={() => { if (!loading) onRefresh() }}
          >
            <AppIcon name="refresh" size={15} />
            {loading ? '刷新中…' : '刷新'}
          </button>
        </div>
        {error && (
          <div className="workspace-tools__notice" role="alert">
            <AppIcon name="alert" size={16} />
            <span>执行记录加载失败：{error}</span>
          </div>
        )}
        {commands.length > 0 && (
          <ul className="workspace-tools__history-list" aria-label="执行记录" aria-busy={loading}>
            {commands.map(command => {
              const time = new Date(command.createdAt)
              return (
                <li className="workspace-tools__history-row" key={command.id}>
                  <div className="workspace-tools__history-main">
                    <code>{command.command}</code>
                    <p>
                      <span>{command.targetName}</span>
                      <span>{command.source}</span>
                      <time dateTime={Number.isFinite(time.getTime()) ? time.toISOString() : undefined}>{time.toLocaleString()}</time>
                    </p>
                  </div>
                  <div className="workspace-tools__flags">
                    {command.timedOut && <span data-tone="warn">超时</span>}
                    {command.truncated && <span data-tone="warn">截断</span>}
                    <span data-tone={command.ok ? 'ok' : 'danger'}>
                      {command.exitCode == null ? 'exit ?' : `exit ${command.exitCode}`}
                    </span>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
        {commands.length === 0 && !error && (
          <div className="workspace-tools__state workspace-tools__state--boxed" role="status">
            <AppIcon name={loading ? 'loading' : 'clock'} size={22} />
            <p>{loading ? '正在加载执行记录…' : '还没有执行记录。'}</p>
          </div>
        )}
      </div>
    </FloatWindow>
  )
}
