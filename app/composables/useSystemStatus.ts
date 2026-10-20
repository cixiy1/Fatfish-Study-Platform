/**
 * 平台运行状态（目前只有大模型就绪度）。
 *
 * 大模型是强依赖：未配置时引导页、关卡页都要把用户挡在门外并指向配置入口，
 * 所以这里做一份全局缓存的读取，避免每个页面重复请求。
 */

export type LlmReason = "not-configured" | "key-unreadable" | "incomplete" | null

export interface LlmStatusPayload {
  ready: boolean
  configured: boolean
  reason: LlmReason
  provider: string | null
  model: string | null
  mockForced: boolean
}

export interface SystemStatusPayload {
  llm: LlmStatusPayload
  setupPath: string
}

export function describeLlmReason(reason: LlmReason): string {
  switch (reason) {
    case "not-configured":
      return "平台未配置大模型，无法生成学习方向与关卡资料。"
    case "key-unreadable":
      return "API Key 无法解密（站点密钥已变更），请重新保存。"
    case "incomplete":
      return "配置不完整：Base URL 或模型名称为空。"
    default:
      return "大模型接口暂不可用。"
  }
}

export function useSystemStatus() {
  const status = useState<SystemStatusPayload | null>("system:status", () => null)
  const pending = useState<boolean>("system:pending", () => false)

  const fetcher = import.meta.server ? useRequestFetch() : $fetch

  async function load(force = false): Promise<SystemStatusPayload | null> {
    if (!force && status.value) return status.value
    if (pending.value) return status.value

    pending.value = true
    try {
      status.value = await fetcher<SystemStatusPayload>("/api/system/status")
    } catch {
      // 探测失败不阻塞页面：按未知处理，页面维持可用状态
    } finally {
      pending.value = false
    }
    return status.value
  }

  const llm = computed(() => status.value?.llm ?? null)
  /** 状态未知时按「可用」处理，避免因为一次探测失败把全站锁死 */
  const llmReady = computed(() => status.value?.llm.ready ?? true)
  const llmReasonText = computed(() => {
    const value = status.value?.llm
    if (!value || value.ready) return ""
    return describeLlmReason(value.reason)
  })
  const setupPath = computed(() => status.value?.setupPath ?? "/admin/llm")

  return { status, llm, llmReady, llmReasonText, setupPath, load }
}
