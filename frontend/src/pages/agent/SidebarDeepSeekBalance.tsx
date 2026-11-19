import { useEffect, useState } from 'react'
import { loginUrlOf, requestJson, type SettingsView } from '../../api/client'
import { isOfficialDeepSeek } from '../../api/deepseekBalance'
import DeepSeekBalance from '../../components/DeepSeekBalance'

type SearchConfig = { baseUrl: string; hasApiKey: boolean }
const searchPath = '/api/settings/deepseek-web'

export default function SidebarDeepSeekBalance({ settings }: { settings: SettingsView | null | undefined }) {
  const models = settings?.models.filter(model => model.apiKey?.trim() && isOfficialDeepSeek(model.baseUrl)) ?? []
  const model = models.find(model => model.id === settings?.defaultModelId) ?? models[0]
  const [search, setSearch] = useState<SearchConfig | null>(null)
  const checkSearch = settings !== undefined && !model

  useEffect(() => {
    if (!checkSearch) return
    const controller = new AbortController()
    void requestJson<SearchConfig>(searchPath, { signal: controller.signal }).then(config => {
      if (!controller.signal.aborted) setSearch(config)
    }).catch(error => {
      if (controller.signal.aborted) return
      const login = loginUrlOf(error)
      if (login) window.location.assign(login)
    })
    return () => controller.abort()
  }, [checkSearch])

  if (model) return <DeepSeekBalance compact path={`/api/settings/models/${encodeURIComponent(model.id)}/balance`} revision={model} />
  if (checkSearch && search?.hasApiKey && isOfficialDeepSeek(search.baseUrl)) {
    return <DeepSeekBalance compact path={`${searchPath}/balance`} revision={search} />
  }
  return null
}
