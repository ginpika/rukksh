/**
 * 桌面框架 —— 无边框窗口的自绘外壳
 *
 * 只在桌面壳里渲染（见 App.tsx 的 isDesktopShell() 判断）：窗口已去掉系统装饰，
 * 标题栏、拖拽区、窗口按钮、窗缘缩放都要页面自己给。
 *
 * 两种形态：
 * - hideRail=false（兼容页 /search、/memory/ops）：外层 12px 窗缘 + 88px 菜单栏 + 48px 标题栏 + 主视图容器
 * - hideRail=true（对话首页与 Dashboard 等独立内容页）：无外框、无独立标题栏，内容直接铺满窗口，
 *   只保留叠在页面顶栏上的拖拽区、窗口按钮与窗缘缩放热区。
 *
 * Vite 入口 index.html 提供同尺寸、同配色的首帧占位，调整外壳视觉时需同步其骨架样式。
 */
import { AppIcon } from '../components/AppIcon'
import { AstrolabeLogo } from '../components/AstrolabeLogo'
import { useThemeState } from '../theme/store'
import { useEffect, useLayoutEffect, useState, type ReactNode } from 'react'
import {
  closeWindow,
  isWindowFullscreen,
  isWindowMaximized,
  minimizeWindow,
  resizeWindow,
  setWindowTheme,
  toggleMaximizeWindow,
} from '../api/desktop'
import { BRAND } from '../branding'
import { ShellIcon } from './icons'
import { NAV } from './nav'
import './desktopFrame.css'

/** 窗缘热区方位，取值与 plugin:window|start_resize_dragging 的 ResizeDirection 一致 */
const EDGES = [
  'North',
  'South',
  'West',
  'East',
  'NorthWest',
  'NorthEast',
  'SouthWest',
  'SouthEast',
] as const

export function DesktopFrame({
  activePath,
  userSlot,
  toolsSlot,
  homeSlot,
  hideRail = false,
  children,
}: {
  activePath: string
  /** 隐藏左侧菜单轨与外层窗框：独立内容页与对话首页铺满窗口，仅保留叠层窗口控件。 */
  hideRail?: boolean
  /** 身份胶囊：状态与用户逻辑由 App 持有（见 App.tsx 的 UserMenu），框架只给位置 */
  userSlot?: ReactNode
  /** 标题栏工具位（主题按钮）：隐藏顶栏时由 App 挪到这里，位于身份胶囊左侧 */
  toolsSlot?: ReactNode
  /** 标题栏首页入口（回引导页，见 App.tsx）：紧邻身份胶囊左侧 */
  homeSlot?: ReactNode
  children: ReactNode
}) {
  const [maximized, setMaximized] = useState(false)
  const [fullscreen, setFullscreen] = useState(false)
  const { themeId, scheme } = useThemeState()
  const frameless = hideRail
  const mac = typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform)

  /* 页面整体让出底色（见 desktopFrame.css 的 body[data-df]）：窗口是透明的，桌面要从
     外壳的圆角外透出来。用 layout effect 赶在首帧前挂上，
     免得先闪一帧不透明的 --c-bg */
  useLayoutEffect(() => {
    document.body.dataset.df = 'on'
    /* 首帧骨架（index.html 预置）到位即撤：形状与外壳一致，撤下时看不出变化。
       先挂 data-df 把底让给桌面、再撤骨架，中间不会闪出一帧不透明底 */
    document.getElementById('minis-df-skeleton')?.remove()
    document.documentElement.classList.remove(
      'minis-df-skeleton',
      'minis-df-conversation',
      'minis-df-frameless',
      'minis-df-mac',
    )
    return () => {
      delete document.body.dataset.df
    }
  }, [])

  /* macOS 原生窗口外观跟随应用明暗档同步，保证失焦灰态与系统边框配色一致 */
  useEffect(() => {
    if (mac) setWindowTheme(scheme)
  }, [mac, scheme])

  /* 最大化 / macOS 全屏状态可能被系统拖拽 / 双击 / 贴边 / 原生绿灯改变，靠 resize 事件回读 */
  useEffect(() => {
    let alive = true
    const sync = () => {
      if (!mac) {
        isWindowMaximized().then((next) => {
          if (alive) setMaximized(next)
        })
        return
      }
      isWindowFullscreen().then((next) => {
        if (alive) setFullscreen(next)
      })
    }
    sync()
    window.addEventListener('resize', sync)
    return () => {
      alive = false
      window.removeEventListener('resize', sync)
    }
  }, [mac])

  return (
    <div
      className={`df${frameless ? ' df--frameless' : ''}${maximized ? ' df--maximized' : ''}${fullscreen ? ' df--fullscreen' : ''}${mac ? ' df--mac' : ''}`}
    >
      {!frameless && <div className="df__acrylic" aria-hidden="true" />}

      {/* -------------------------------------------- 左：菜单栏 */}
      {!frameless && <aside className="df__rail" data-tauri-drag-region>
        {/* 品牌位也当拖拽区（整块含内边距都能拖，故用 deep） */}
        <div className="df__brand" data-tauri-drag-region="deep" title={BRAND.name} role="img" aria-label={BRAND.name}>
          {themeId === 'astrolabe' ? <AstrolabeLogo /> : <img src="/icon-64x64.png" alt="" draggable={false} />}
        </div>

        <nav className="df__menu scrollbar-hide" aria-label="主导航">
          {NAV.map((item) => {
            const on = item.path === activePath
            return (
              <a
                key={item.path}
                href={`#${item.path}`}
                title={item.label}
                aria-label={item.label}
                aria-current={on ? 'page' : undefined}
                className="df__item"
              >
                <ShellIcon name={item.icon} className="df__icon" />
              </a>
            )
          })}
        </nav>
      </aside>}

      {/* -------------------------------------------- 右：主视图 */}
      <div className="df__stage">
        {/* 标题栏：一行 = 左段拖拽区 + 身份胶囊 + 窗口按钮。
            拖拽区是按钮的同层前兄弟，不覆盖按钮 */}
        <div className="df__titlebar">
          <div className="df__drag" data-tauri-drag-region />
          {!frameless && toolsSlot}
          {!frameless && homeSlot}
          {!frameless && userSlot}
          {!mac && (
            <div className="df__win">
              <button
                type="button"
                className="df__wbtn df__wbtn--minimize"
                title="最小化"
                aria-label="最小化"
                onClick={minimizeWindow}
              >
                <AppIcon name="minimize" />
              </button>
              <button
                type="button"
                className="df__wbtn df__wbtn--maximize"
                title={maximized ? '还原' : '最大化'}
                aria-label={maximized ? '还原' : '最大化'}
                onClick={() => toggleMaximizeWindow().then(setMaximized)}
              >
                {maximized ? (
                  <AppIcon name="restore" />
                ) : (
                  <AppIcon name="square" />
                )}
              </button>
              <button
                type="button"
                className="df__wbtn df__wbtn--close"
                title="关闭"
                aria-label="关闭"
                onClick={closeWindow}
              >
                <AppIcon name="close" />
              </button>
            </div>
          )}
        </div>

        <div className="df__view">{children}</div>
      </div>

      {/* 窗缘热区：非 macOS 无边框窗口系统不再给缩放热区，这里补一圈透明热区；macOS 由原生窗口负责 */}
      {!mac && (
        <div className="df__resize" aria-hidden="true">
          {EDGES.map((dir) => (
            <i
              key={dir}
              data-dir={dir}
              onPointerDown={(e) => {
                if (e.button !== 0) return
                e.preventDefault()
                resizeWindow(dir)
              }}
            />
          ))}
        </div>
      )}
    </div>
  )
}
