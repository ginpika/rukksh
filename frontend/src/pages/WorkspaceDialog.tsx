import { useId, useState } from 'react'
import { BRAND } from '../branding'
import type { TerminalTarget, TerminalTargetRequest } from '../api/client'
import { AppIcon } from '../components/AppIcon'
import FloatWindow from '../components/FloatWindow'
import { Field, INPUT, Select, linesToPatterns } from '../components/formKit'
import './workspaceDialog.css'

const MONO_INPUT = `${INPUT} workspace-dialog__mono`

const DOCKER_IMAGES = [
  { name: 'Ubuntu', image: 'ubuntu:24.04', desc: '通用开发 · apt' },
  { name: 'Debian', image: 'debian:bookworm-slim', desc: '精简稳定 · apt' },
  { name: 'Alpine', image: 'alpine:latest', desc: '轻量环境 · apk' },
  { name: 'Arch Linux', image: 'archlinux:latest', desc: '滚动更新 · pacman' },
] as const

export default function WorkspaceDialog({
  initial,
  localAvailable,
  localUnavailableReason,
  busy,
  onClose,
  onSubmit,
}: {
  initial: TerminalTarget | null
  localAvailable: boolean
  localUnavailableReason: string
  busy: boolean
  onClose: () => void
  onSubmit: (req: TerminalTargetRequest) => void
}) {
  const localReasonId = useId()
  const [name, setName] = useState(initial?.name ?? '')
  const [localName, setLocalName] = useState(initial?.kind === 'local' ? initial.name : '')
  const [remoteKind, setRemoteKind] = useState<'docker' | 'ssh'>(initial?.kind === 'ssh' ? 'ssh' : 'docker')
  const [local, setLocal] = useState(initial?.kind === 'local')
  const [enabled, setEnabled] = useState(initial?.enabled ?? true)
  const [workdir, setWorkdir] = useState(initial?.workdir ?? (initial ? '' : '/workspace'))
  const [localEnabled, setLocalEnabled] = useState(initial?.kind === 'local' && initial.enabled)
  const [localWorkdir, setLocalWorkdir] = useState(initial?.kind === 'local' ? initial.workdir ?? '' : '')
  const [hostWorkdir, setHostWorkdir] = useState(initial?.hostWorkdir ?? '')
  const [writePaths, setWritePaths] = useState((initial?.writePaths ?? []).join('\n'))
  const [dockerMode, setDockerMode] = useState<'image' | 'container'>(initial?.container ? 'container' : 'image')
  const [timeoutMs, setTimeoutMs] = useState(
    initial?.timeoutMs != null ? String(initial.timeoutMs) : '',
  )
  const [maxOutput, setMaxOutput] = useState(
    initial?.maxOutput != null ? String(initial.maxOutput) : '',
  )
  const [allow, setAllow] = useState((initial?.allowPatterns ?? []).join('\n'))
  const [deny, setDeny] = useState((initial?.denyPatterns ?? []).join('\n'))
  const [note, setNote] = useState(initial?.note ?? '')
  const [dockerHost, setDockerHost] = useState(initial?.dockerHost ?? '')
  const [image, setImage] = useState(initial?.image ?? DOCKER_IMAGES[0].image)
  const [customImage, setCustomImage] = useState(!!initial?.image && !DOCKER_IMAGES.some(p => p.image === initial.image))
  const [container, setContainer] = useState(initial?.container ?? '')
  const [sshHost, setSshHost] = useState(initial?.sshHost ?? '')
  const [sshPort, setSshPort] = useState(initial?.sshPort != null ? String(initial.sshPort) : '')
  const [sshUser, setSshUser] = useState(initial?.sshUser ?? '')
  const [sshAuth, setSshAuth] = useState<'password' | 'key'>(initial?.sshAuth ?? 'password')
  const [sshPassword, setSshPassword] = useState(initial?.sshPassword ?? '')
  const [sshPrivateKey, setSshPrivateKey] = useState(initial?.sshPrivateKey ?? '')
  const [sshPassphrase, setSshPassphrase] = useState(initial?.sshPassphrase ?? '')
  const [hostKeyCheck, setHostKeyCheck] = useState<'known_hosts' | 'accept-all'>(
    initial?.hostKeyCheck ?? 'known_hosts',
  )

  const positive = (s: string): number | null => {
    const n = Number(s.trim())
    return s.trim() && Number.isFinite(n) && n > 0 ? n : null
  }
  const kind = local ? 'local' : remoteKind
  const docker = kind === 'docker'
  const ssh = kind === 'ssh'
  const dockerOk = dockerMode === 'container' ? !!container.trim() : !!image.trim()
  const sshOk = !!sshHost.trim() && (sshAuth === 'key' ? !!sshPrivateKey.trim() : !!sshPassword.trim())
  const valid = local ? localAvailable && !!localName.trim() && !!localWorkdir.trim() : docker ? dockerOk : !!name.trim() && sshOk
  const localReason = initial && initial.kind !== 'local'
    ? '切换到本机环境需要新建工作空间。'
    : localAvailable ? null : localUnavailableReason
  const localDisabled = !local && localReason !== null

  const submit = () => {
    if (!valid || busy) return
    onSubmit({
      name: local ? localName.trim() : name.trim() || initial?.name || '',
      kind,
      enabled: local ? localEnabled : enabled,
      workdir: (local ? localWorkdir : workdir).trim() || null,
      hostWorkdir: docker && dockerMode === 'image' ? hostWorkdir.trim() || null : null,
      timeoutMs: positive(timeoutMs),
      maxOutput: positive(maxOutput),
      allowPatterns: linesToPatterns(allow),
      denyPatterns: linesToPatterns(deny),
      writePaths: local ? linesToPatterns(writePaths) : undefined,
      dockerHost: docker ? dockerHost.trim() || null : null,
      image: docker && dockerMode === 'image' ? image.trim() || null : null,
      container: docker && dockerMode === 'container' ? container.trim() || null : null,
      sshHost: ssh ? sshHost.trim() : null,
      sshPort: ssh ? positive(sshPort) : null,
      sshUser: ssh ? sshUser.trim() || null : null,
      sshAuth,
      sshPassword: ssh ? sshPassword || null : null,
      sshPrivateKey: ssh ? sshPrivateKey || null : null,
      sshPassphrase: ssh ? sshPassphrase || null : null,
      hostKeyCheck,
      note: note.trim() || null,
    })
  }

  const selectKind = (next: TerminalTarget['kind']) => {
    setLocal(next === 'local')
    if (next === 'local' || next === remoteKind) return
    setRemoteKind(next)
    if (!initial) setWorkdir(next === 'docker' && dockerMode === 'image' ? '/workspace' : '')
  }

  const selectDockerMode = (next: 'image' | 'container') => {
    setDockerMode(next)
    if (!initial && dockerMode !== next) setWorkdir(next === 'image' ? '/workspace' : '')
  }

  return (
    <FloatWindow
      title={initial ? '编辑工作空间' : '新建工作空间'}
      onClose={onClose}
      width={600}
      contentClassName="workspace-dialog__content"
    >
      <form
        className="workspace-dialog"
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
      >
        <div className="workspace-dialog__body scrollbar-slim">
          <fieldset className="workspace-dialog__kind">
            <legend>环境类型</legend>
            <div className="workspace-dialog__segments">
              <button type="button" aria-pressed={docker} disabled={initial?.kind === 'local'} onClick={() => selectKind('docker')}>
                <AppIcon name="workspace" />
                Docker 容器
              </button>
              <button type="button" aria-pressed={ssh} disabled={initial?.kind === 'local'} onClick={() => selectKind('ssh')}>
                <AppIcon name="terminal" />
                SSH 服务器
              </button>
              <button
                type="button"
                aria-pressed={local}
                aria-disabled={localDisabled || undefined}
                aria-describedby={localReason ? localReasonId : undefined}
                onClick={() => { if (!localDisabled) selectKind('local') }}
              >
                <AppIcon name="system" />
                本机环境
              </button>
            </div>
            {localReason && (
              <p id={localReasonId} className="workspace-dialog__availability">{localReason}</p>
            )}
          </fieldset>

          {docker && (
            <>
              <fieldset>
                <legend>Docker 来源</legend>
                <div className="workspace-dialog__segments">
                  <button type="button" aria-pressed={dockerMode === 'image'} onClick={() => selectDockerMode('image')}>
                    从镜像新建
                  </button>
                  <button type="button" aria-pressed={dockerMode === 'container'} onClick={() => selectDockerMode('container')}>
                    接入已有容器
                  </button>
                </div>
              </fieldset>

              {dockerMode === 'container' ? (
                <Field label="容器名 / ID" hint="使用容器已有的目录挂载。容器停止时会自动启动。">
                  <input
                    value={container}
                    onChange={(e) => setContainer(e.target.value)}
                    className={MONO_INPUT}
                    placeholder={BRAND.backendContainer}
                    spellCheck={false}
                  />
                </Field>
              ) : (
                <>
                  <fieldset>
                    <legend>选择镜像</legend>
                    <div className="workspace-dialog__presets">
                      {DOCKER_IMAGES.map(preset => (
                        <label key={preset.image} className="workspace-dialog__preset">
                          <input
                            type="radio"
                            name="docker-image"
                            checked={!customImage && image === preset.image}
                            onChange={() => {
                              setCustomImage(false)
                              setImage(preset.image)
                            }}
                          />
                          <span>
                            <span className="workspace-dialog__preset-name">{preset.name}</span>
                            <code>{preset.image}</code>
                            <small>{preset.desc}</small>
                          </span>
                        </label>
                      ))}
                    </div>
                    <label className="workspace-dialog__custom">
                      <input
                        type="radio"
                        name="docker-image"
                        checked={customImage}
                        onChange={() => {
                          setCustomImage(true)
                          setImage('')
                        }}
                      />
                      自定义镜像
                    </label>
                  </fieldset>

                  {customImage && (
                    <Field label="镜像地址" hint="可填写本地镜像，或镜像仓库地址与标签。">
                      <input
                        value={image}
                        onChange={(e) => setImage(e.target.value)}
                        className={MONO_INPUT}
                        placeholder="ubuntu:24.04"
                        spellCheck={false}
                      />
                    </Field>
                  )}

                  <p className="workspace-dialog__hint">
                    首次打开 Shell 或执行命令时会拉取所需镜像并创建容器，之后复用同一容器。
                  </p>

                  <details open={!!initial?.hostWorkdir} className="workspace-dialog__disclosure">
                    <summary>
                      <AppIcon name="chevron-right" />
                      绑定工作目录
                      <span>可选</span>
                    </summary>
                    <div className="workspace-dialog__fields">
                      <Field label="宿主机目录" hint="填写 Docker 所在机器上的已有目录，容器内的文件改动会同步到这里。留空则不绑定。">
                        <input
                          value={hostWorkdir}
                          onChange={(e) => setHostWorkdir(e.target.value)}
                          className={MONO_INPUT}
                          placeholder="例如 D:\Projects\app 或 /home/user/app"
                          spellCheck={false}
                        />
                      </Field>
                      <Field label="容器内路径" hint="默认 /workspace，同时作为文件浏览与 Shell 的起始目录。">
                        <input
                          value={workdir}
                          onChange={(e) => setWorkdir(e.target.value)}
                          className={MONO_INPUT}
                          placeholder="/workspace"
                          spellCheck={false}
                        />
                      </Field>
                    </div>
                  </details>

                  {initial && (
                    <p className="workspace-dialog__hint">容器创建后，更换镜像或目录绑定需要新建工作空间，原容器和文件会保留。</p>
                  )}
                </>
              )}
            </>
          )}

          {ssh && (
            <>
              <Field label="工作空间名" hint="模型用这个名字指认环境。请使用唯一名称，例如 web-01 或 builder。">
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className={INPUT}
                  placeholder="web-01"
                  autoFocus
                />
              </Field>
              <div className="workspace-dialog__pair workspace-dialog__pair--host">
                <Field label="主机">
                  <input
                    value={sshHost}
                    onChange={(e) => setSshHost(e.target.value)}
                    className={MONO_INPUT}
                    placeholder="10.0.0.11 或 example.com"
                    spellCheck={false}
                  />
                </Field>
                <Field label="端口">
                  <input
                    value={sshPort}
                    onChange={(e) => setSshPort(e.target.value.replace(/[^\d]/g, ''))}
                    className={MONO_INPUT}
                    placeholder="22"
                    inputMode="numeric"
                    spellCheck={false}
                  />
                </Field>
              </div>
              <div className="workspace-dialog__pair">
                <Field label="用户名">
                  <input
                    value={sshUser}
                    onChange={(e) => setSshUser(e.target.value)}
                    className={MONO_INPUT}
                    placeholder="root"
                    spellCheck={false}
                  />
                </Field>
                <Field label="认证方式">
                  <Select
                    label="认证方式"
                    value={sshAuth}
                    onChange={(v) => setSshAuth(v as 'password' | 'key')}
                    menuClassName="workspace-dialog__menu"
                    options={[
                      { value: 'password', label: '密码' },
                      { value: 'key', label: '私钥' },
                    ]}
                  />
                </Field>
              </div>
              {sshAuth === 'password' ? (
                <Field label="密码">
                  <input
                    value={sshPassword}
                    onChange={(e) => setSshPassword(e.target.value)}
                    className={MONO_INPUT}
                    type="password"
                    autoComplete="off"
                  />
                </Field>
              ) : (
                <>
                  <Field label="私钥" hint="粘贴 PEM 内容，或填写服务器或本机上的私钥路径。">
                    <textarea
                      value={sshPrivateKey}
                      onChange={(e) => setSshPrivateKey(e.target.value)}
                      className={MONO_INPUT}
                      rows={4}
                      placeholder="-----BEGIN OPENSSH PRIVATE KEY----- …"
                      spellCheck={false}
                    />
                  </Field>
                  <Field label="私钥口令" hint="私钥未加密时留空。">
                    <input
                      value={sshPassphrase}
                      onChange={(e) => setSshPassphrase(e.target.value)}
                      className={MONO_INPUT}
                      type="password"
                      autoComplete="off"
                    />
                  </Field>
                </>
              )}
              <Field
                label="Host Key 校验"
                hint="known_hosts 首次连接时记录主机指纹，之后拒绝指纹变化的连接。accept-all 跳过校验，仅限自建内网。"
              >
                <Select
                  label="Host Key 校验"
                  value={hostKeyCheck}
                  onChange={(v) => setHostKeyCheck(v as 'known_hosts' | 'accept-all')}
                  menuClassName="workspace-dialog__menu"
                  options={[
                    { value: 'known_hosts', label: 'known_hosts（首次信任，推荐）' },
                    { value: 'accept-all', label: 'accept-all（不校验）' },
                  ]}
                />
              </Field>
            </>
          )}

          {local && (
            <>
              <Field label="工作空间名" hint="Agent 使用此名称选择本机环境。">
                <input value={localName} onChange={(e) => setLocalName(e.target.value)} className={INPUT} />
              </Field>
              <Field label="工作目录" hint="填写后端运行环境中已存在的绝对路径。如果后端运行在容器里，请填写容器内的路径。">
                <input
                  value={localWorkdir}
                  onChange={(e) => setLocalWorkdir(e.target.value)}
                  className={MONO_INPUT}
                  placeholder="/srv/workspaces/app"
                  spellCheck={false}
                />
              </Field>
              <Field label="写入白名单" hint="每行填写一个已存在目录的绝对路径。留空时为只读。填写后，Agent 可修改这些目录及其子目录中的文件。">
                <textarea
                  value={writePaths}
                  onChange={(e) => setWritePaths(e.target.value)}
                  className={MONO_INPUT}
                  placeholder="/srv/workspaces/app/src"
                  rows={4}
                  spellCheck={false}
                />
              </Field>
            </>
          )}

          {(ssh || (docker && dockerMode === 'container')) && (
            <Field label="工作目录" hint="文件浏览和 Shell 从此目录开始。留空使用环境的默认目录。">
              <input
                value={workdir}
                onChange={(e) => setWorkdir(e.target.value)}
                className={MONO_INPUT}
                placeholder="/srv/app"
                spellCheck={false}
              />
            </Field>
          )}

          <details className="workspace-dialog__disclosure">
            <summary>
              <AppIcon name="chevron-right" />
              高级设置
            </summary>
            <div className="workspace-dialog__fields">
              {docker && (
                <>
                  <Field label="工作空间名" hint={initial ? '留空保留当前名称。' : '留空自动生成唯一名称。'}>
                    <input
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      className={INPUT}
                      placeholder="自动生成"
                    />
                  </Field>
                  <Field label="Docker Host" hint="留空使用环境默认连接。连接远程 Docker 时，绑定目录填写远程机器上的路径。">
                    <input
                      value={dockerHost}
                      onChange={(e) => setDockerHost(e.target.value)}
                      className={MONO_INPUT}
                      placeholder="环境默认"
                      spellCheck={false}
                    />
                  </Field>
                </>
              )}
              <div className="workspace-dialog__pair">
                <Field label="命令超时（毫秒）" hint="留空使用全局默认。超时会终止命令。">
                  <input
                    value={timeoutMs}
                    onChange={(e) => setTimeoutMs(e.target.value.replace(/[^\d]/g, ''))}
                    className={MONO_INPUT}
                    placeholder="60000"
                    inputMode="numeric"
                    spellCheck={false}
                  />
                </Field>
                <Field label="输出上限（字符）" hint="留空使用全局默认。超出部分会截断并标注。">
                  <input
                    value={maxOutput}
                    onChange={(e) => setMaxOutput(e.target.value.replace(/[^\d]/g, ''))}
                    className={MONO_INPUT}
                    placeholder="20000"
                    inputMode="numeric"
                    spellCheck={false}
                  />
                </Field>
              </div>

              <Field label="命令白名单" hint="每行一条正则。填写后，模型只能执行命中至少一条规则的命令。">
                <textarea
                  value={allow}
                  onChange={(e) => setAllow(e.target.value)}
                  className={MONO_INPUT}
                  rows={3}
                  placeholder={'^\\s*(ls|cat|grep|df|docker ps)\\b'}
                  spellCheck={false}
                />
              </Field>
              <Field label="命令黑名单" hint="每行一条正则，命中即拒绝。黑名单优先于白名单。">
                <textarea
                  value={deny}
                  onChange={(e) => setDeny(e.target.value)}
                  className={MONO_INPUT}
                  rows={3}
                  placeholder={'rm\\s+-rf\\s+/'}
                  spellCheck={false}
                />
              </Field>
              <Field label="说明" hint="告诉模型这是一个什么环境，以及何时使用。">
                <input
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  className={INPUT}
                  placeholder="生产 Web 服务器，只读排查用"
                />
              </Field>
            </div>
          </details>

          <label className="workspace-dialog__enabled">
            <input
              type="checkbox"
              checked={local ? localEnabled : enabled}
              onChange={(e) => local ? setLocalEnabled(e.target.checked) : setEnabled(e.target.checked)}
            />
            <span>
              <strong>启用工作空间</strong>
              <small>{local ? '启用后，获授权的 Agent 可以在此环境中执行本机命令。' : '启用后，模型可以发现此环境并在其中执行命令。'}</small>
            </span>
          </label>
        </div>

        <footer className="workspace-dialog__footer">
          <button type="button" className="workspace-button" onClick={onClose}>取消</button>
          <button type="submit" className="workspace-button workspace-button--primary" disabled={!valid || busy}>
            {busy ? '保存中…' : initial ? '保存' : '创建工作空间'}
          </button>
        </footer>
      </form>
    </FloatWindow>
  )
}
