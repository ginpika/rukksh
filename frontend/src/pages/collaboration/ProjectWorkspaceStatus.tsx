import type { ProjectWorkspaceBinding } from '../../api/collaboration'
import { AppIcon } from '../../components/AppIcon'
import { codingHref } from '../coding/navigation'

export default function ProjectWorkspaceStatus({ binding, busy = false, onConfigure }: { binding?: ProjectWorkspaceBinding; busy?: boolean; onConfigure: () => void }) {
  return (
    <section className="collab-workspace-status" aria-label="项目工作目录">
      <span className="collab-project-glyph"><AppIcon name="folder-open" size={18} /></span>
      <div className="collab-workspace-location">
        <strong>项目工作目录</strong>
        <p>{binding ? `${binding.workspaceName} / ${binding.directory || '目录不可用'}` : '绑定后可在 AI IDE 中打开项目。'}</p>
        {binding && !binding.enabled && <p role="alert">绑定已失效或工作空间未启用。</p>}
      </div>
      <div className="collab-workspace-actions">
        <button type="button" className={`ui-btn ui-btn--${binding?.enabled ? 'quiet' : 'outline'}`} disabled={busy} onClick={onConfigure}>
          {binding ? '调整工作目录' : '设置工作目录'}
        </button>
        {binding?.enabled && (
          <a className="ui-btn ui-btn--outline" href={codingHref({ projectId: binding.repositoryId, globalProjectId: binding.projectId })}>
            <AppIcon name="code" />打开 AI IDE
          </a>
        )}
      </div>
    </section>
  )
}
