/**
 * 页面 Kit 入口：优先使用页面指定的 Kit，其余页面按当前主题从注册表取渲染包。
 *
 * 「主题 → kit」的映射已收口到 theme/registry.tsx（THEMES），页面统一经
 * usePageKit() 读取，因此 kit 的选用对页面是透明的。
 */
import { createContext, useContext } from 'react'
import { THEMES } from '../theme/registry'
import { useThemeState } from '../theme/store'
import type { PageKit } from './types'

const PageKitContext = createContext<PageKit | null>(null)

export const PageKitProvider = PageKitContext.Provider

export function usePageKit(): PageKit {
  const pageKit = useContext(PageKitContext)
  const { themeId } = useThemeState()
  return pageKit ?? THEMES[themeId].kit
}

export type { PageKit } from './types'
