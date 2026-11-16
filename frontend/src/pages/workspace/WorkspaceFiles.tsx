import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  ApiError,
  downloadWorkspaceFile,
  listWorkspaceFiles,
  readWorkspaceFile,
  type TerminalTarget,
} from '../../api/client'
import { terminalError } from '../../api/terminal'
import { AppIcon } from '../../components/AppIcon'
import './workspaceFiles.css'

type FileResult<T> = { data: T; error?: never } | { error: string; data?: never }

function fileError(error: unknown): string {
  const message = terminalError(error)
  if (error instanceof ApiError && message === error.message) {
    return error.body.trim() || `请求失败（${error.status}）`
  }
  return message
}

function useFileRequest<T>(
  load: (id: string, path: string) => Promise<T>,
  id: string,
  path: string | null,
  revision: number,
) {
  const request = useMemo(() => ({ id, path, revision }), [id, path, revision])
  const [completed, setCompleted] = useState<{ request: typeof request; result: FileResult<T> } | null>(null)

  useEffect(() => {
    if (request.path === null) return
    let current = true
    void load(request.id, request.path).then(
      (data) => { if (current) setCompleted({ request, result: { data } }) },
      (error: unknown) => { if (current) setCompleted({ request, result: { error: fileError(error) } }) },
    )
    return () => { current = false }
  }, [load, request])

  return completed?.request === request ? completed.result : null
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const size = bytes < 1024 ** 2 ? bytes / 1024 : bytes / 1024 ** 2
  return `${size < 10 ? size.toFixed(1) : Math.round(size)} ${bytes < 1024 ** 2 ? 'KB' : 'MB'}`
}

export default function WorkspaceFiles({ workspace, onToast }: {
  workspace: TerminalTarget
  onToast: (toast: { kind: 'success' | 'error'; msg: string }) => void
}) {
  const [segments, setSegments] = useState<string[]>([])
  const [fileName, setFileName] = useState<string | null>(null)
  const [directoryRevision, setDirectoryRevision] = useState(0)
  const [previewRevision, setPreviewRevision] = useState(0)
  const [downloads, setDownloads] = useState(() => new Set<string>())
  const pathHeading = useRef<HTMLElement>(null)
  const previewTitle = useRef<HTMLHeadingElement>(null)
  const previewOpener = useRef<HTMLButtonElement>(null)
  const nextFocus = useRef<'path' | 'entry' | null>(null)

  const path = segments.join('/') || '.'
  const entryPath = (name: string) => [...segments, name].join('/')
  const filePath = fileName === null ? null : entryPath(fileName)
  const directory = useFileRequest(listWorkspaceFiles, workspace.id, path, directoryRevision)
  const preview = useFileRequest(readWorkspaceFile, workspace.id, filePath, previewRevision)
  const crumbs = ['文件', ...segments]
  const codingHref = `#/coding?workspace=${encodeURIComponent(workspace.id)}&directory=${encodeURIComponent(path)}`

  useLayoutEffect(() => {
    if (fileName !== null) {
      previewTitle.current?.focus()
    } else if (nextFocus.current === 'entry') {
      previewOpener.current?.focus()
    } else if (nextFocus.current === 'path') {
      pathHeading.current?.focus()
    }
    nextFocus.current = null
  }, [fileName, path])

  const navigate = (next: string[]) => {
    nextFocus.current = 'path'
    setFileName(null)
    setSegments(next)
  }

  const closePreview = () => {
    nextFocus.current = 'entry'
    setFileName(null)
  }

  const goUp = () => {
    if (fileName !== null) closePreview()
    else navigate(segments.slice(0, -1))
  }

  const refresh = () => {
    if (fileName === null) setDirectoryRevision((value) => value + 1)
    else setPreviewRevision((value) => value + 1)
  }

  const download = async (file: string) => {
    setDownloads((previous) => new Set(previous).add(file))
    try {
      const { filename, blob } = await downloadWorkspaceFile(workspace.id, file)
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = filename
      document.body.appendChild(link)
      link.click()
      link.remove()
      window.setTimeout(() => URL.revokeObjectURL(url), 1000)
    } catch (error) {
      onToast({ kind: 'error', msg: `下载失败：${fileError(error)}` })
    } finally {
      setDownloads((previous) => {
        const next = new Set(previous)
        next.delete(file)
        return next
      })
    }
  }

  const refreshLabel = fileName === null ? '刷新目录' : '刷新预览'

  return (
    <section className="workspace-files" aria-label="工作空间文件">
      <div className="workspace-files__toolbar">
        <nav className="workspace-files__path" aria-label="文件路径">
          <AppIcon name="folder-open" size={17} />
          <ol>
            {crumbs.map((crumb, index) => (
              <li key={index}>
                {index > 0 && <span aria-hidden="true">/</span>}
                {fileName === null && index === crumbs.length - 1 ? (
                  <strong ref={pathHeading} tabIndex={-1} aria-current="location">{crumb}</strong>
                ) : (
                  <button type="button" onClick={() => navigate(segments.slice(0, index))}>{crumb}</button>
                )}
              </li>
            ))}
            {fileName !== null && (
              <li><span aria-hidden="true">/</span><strong aria-current="location">{fileName}</strong></li>
            )}
          </ol>
        </nav>
        <div className="workspace-files__actions">
          <button
            type="button"
            className="workspace-files__action workspace-files__action--icon"
            onClick={goUp}
            disabled={segments.length === 0 && fileName === null}
            aria-label="返回上一级"
            title="返回上一级"
          >
            <AppIcon name="arrow-up" size={15} />
          </button>
          <button
            type="button"
            className="workspace-files__action workspace-files__action--icon"
            onClick={refresh}
            disabled={fileName === null ? directory === null : preview === null}
            aria-label={refreshLabel}
            title={refreshLabel}
          >
            <AppIcon name="refresh" size={15} />
          </button>
          {workspace.kind !== 'local' && (
            <a className="workspace-files__action" href={codingHref}><AppIcon name="code" size={16} />编程</a>
          )}
        </div>
      </div>

      <div hidden={fileName !== null}>
        {directory === null && <p className="workspace-files__message" role="status">正在读取目录…</p>}
        {directory?.error && <p className="workspace-files__message workspace-files__message--error" role="alert">{directory.error}</p>}
        {directory?.data?.entries.length === 0 && (
          <div className="workspace-files__message"><AppIcon name="folder-open" size={23} />此目录为空</div>
        )}
        {directory?.data && directory.data.entries.length > 0 && (
          <table className="workspace-files__table" aria-label="目录内容">
            <thead>
              <tr>
                <th scope="col">名称</th>
                <th scope="col" className="workspace-files__modified">修改时间</th>
                <th scope="col" className="workspace-files__size">大小</th>
                <th scope="col" className="workspace-files__download"><span className="sr-only">下载</span></th>
              </tr>
            </thead>
            <tbody>
              {directory.data.entries.map((entry) => {
                const file = entryPath(entry.name)
                return (
                  <tr key={entry.name}>
                    <td>
                      <button
                        type="button"
                        className="workspace-files__entry"
                        title={entry.name}
                        onClick={(event) => {
                          if (entry.dir) {
                            navigate([...segments, entry.name])
                          } else {
                            previewOpener.current = event.currentTarget
                            setFileName(entry.name)
                          }
                        }}
                      >
                        <AppIcon name={entry.dir ? 'folder' : entry.link ? 'link' : 'file'} className={entry.dir ? 'workspace-files__folder' : undefined} />
                        <span>{entry.name}</span>
                      </button>
                    </td>
                    <td className="workspace-files__modified" title={entry.modified}>{entry.modified}</td>
                    <td className="workspace-files__size">{entry.dir ? '—' : formatSize(entry.size)}</td>
                    <td className="workspace-files__download">
                      {!entry.dir && (
                        <button
                          type="button"
                          className="workspace-files__action workspace-files__action--icon"
                          onClick={() => void download(file)}
                          disabled={downloads.has(file)}
                          aria-label={`下载 ${entry.name}`}
                          title={`下载 ${entry.name}`}
                        >
                          <AppIcon
                            name={downloads.has(file) ? 'loading' : 'download'}
                            className={downloads.has(file) ? 'workspace-spinner' : undefined}
                            size={15}
                          />
                        </button>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      {fileName !== null && filePath !== null && (
        <section className="workspace-files__preview" aria-label="文件预览">
          <div className="workspace-files__preview-header">
            <div className="workspace-files__preview-info">
              <h3 ref={previewTitle} tabIndex={-1} title={fileName}><AppIcon name="file" /><span>{fileName}</span></h3>
              {preview?.data && <span className="workspace-files__size">{formatSize(preview.data.size)}</span>}
              {preview?.data?.truncated && <span className="workspace-files__tag workspace-files__tag--warn">已截断</span>}
              {preview?.data?.binary && <span className="workspace-files__tag">二进制</span>}
            </div>
            <div className="workspace-files__actions">
              {preview?.data && (
                <button
                  type="button"
                  className="workspace-files__action"
                  onClick={() => void download(filePath)}
                  disabled={downloads.has(filePath)}
                >
                  <AppIcon
                    name={downloads.has(filePath) ? 'loading' : 'download'}
                    className={downloads.has(filePath) ? 'workspace-spinner' : undefined}
                    size={15}
                  />下载
                </button>
              )}
              <button type="button" className="workspace-files__action workspace-files__action--icon" onClick={closePreview} aria-label="关闭预览" title="关闭预览">
                <AppIcon name="close" size={15} />
              </button>
            </div>
          </div>
          {preview === null && <p className="workspace-files__message" role="status">正在读取文件…</p>}
          {preview?.error && <p className="workspace-files__message workspace-files__message--error" role="alert">{preview.error}</p>}
          {preview?.data?.binary && <p className="workspace-files__message">下载二进制文件以查看内容。</p>}
          {preview?.data && !preview.data.binary && (
            preview.data.content ? (
              <pre className="workspace-files__code scrollbar-slim" aria-label={`${fileName} 文本内容`} tabIndex={0}>{preview.data.content}</pre>
            ) : <p className="workspace-files__message">此文件为空</p>
          )}
        </section>
      )}
    </section>
  )
}
