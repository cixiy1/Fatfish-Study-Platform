import type {
  DirectionCandidate,
  DirectionInterviewResponse,
  DirectionMessage,
  DirectionProfile,
} from "#shared/types/direction"

const DRAFT_KEY = "fsp:direction-draft"

/**
 * 方向访谈的状态机。
 *
 * 网络请求全部发生在事件回调里（不在 setup 顶层 await），
 * 否则 SSR 会等模型返回，首屏直接变慢。
 */
export function useDirectionInterview() {
  const history = ref<DirectionMessage[]>([])
  const question = ref("")
  const options = ref<string[]>([])
  const profile = ref<DirectionProfile>({ goal: null, level: null, timeBudget: null, preference: null })
  const directions = ref<DirectionCandidate[]>([])
  const token = ref("")
  const turn = ref(1)
  const finished = ref(false)
  const loading = ref(false)
  const mock = ref(false)
  const error = ref("")
  /** 服务端明确告知「未配置大模型」：界面要切到配置引导，而不是让用户一直重试 */
  const llmBlocked = ref(false)

  const hasStarted = computed(() => history.value.length > 0)

  function saveDraft() {
    if (!finished.value) return
    const store = safeStorage()
    if (!store) return
    try {
      store.setItem(DRAFT_KEY, JSON.stringify({
        directions: directions.value,
        token: token.value,
        profile: profile.value,
      }))
    } catch {
      // 隐私模式下写不进去，忽略
    }
  }

  function restoreDraft(): boolean {
    const store = safeStorage()
    if (!store) return false
    try {
      const raw = store.getItem(DRAFT_KEY)
      if (!raw) return false
      const data = JSON.parse(raw) as {
        directions?: DirectionCandidate[]
        token?: string
        profile?: DirectionProfile
      }
      if (!data.directions?.length || !data.token) return false
      directions.value = data.directions
      token.value = data.token
      if (data.profile) profile.value = data.profile
      finished.value = true
      return true
    } catch {
      return false
    }
  }

  function clearDraft() {
    const store = safeStorage()
    if (!store) return
    try {
      store.removeItem(DRAFT_KEY)
    } catch {
      // 忽略
    }
  }

  async function request() {
    loading.value = true
    error.value = ""

    try {
      const response = await $fetch<DirectionInterviewResponse>("/api/direction/interview", {
        method: "POST",
        body: { history: history.value },
        timeout: 45_000,
      })

      mock.value = response.mock
      profile.value = response.profile

      if (response.done) {
        directions.value = response.directions ?? []
        token.value = response.selectionToken ?? ""
        finished.value = true
        turn.value = response.turn
        question.value = ""
        options.value = []
        saveDraft()
        return
      }

      turn.value = response.turn
      question.value = response.question ?? ""
      options.value = response.options ?? []
      history.value.push({ role: "assistant", content: question.value })
    } catch (err) {
      const status = (err as { statusCode?: number }).statusCode
      const data = (err as { data?: { code?: string, message?: string } }).data

      // 未配置大模型：不是网络问题，重试没用，必须去配置
      if (status === 503 && data?.code === "LLM_NOT_CONFIGURED") {
        llmBlocked.value = true
        error.value = data.message || "尚未配置大模型接口"
        return
      }

      error.value = status === 429
        ? "操作过于频繁，请稍后再试"
        : data?.message || "网络异常，请重试"
    } finally {
      loading.value = false
    }
  }

  /** 开始访谈：问出第一个问题 */
  async function start() {
    if (hasStarted.value) return
    await request()
  }

  /** 回答当前问题 */
  async function answer(text: string) {
    const value = text.trim()
    if (!value) return

    history.value.push({ role: "user", content: value })
    await request()
  }

  /** 重新开始（清空历史与草稿） */
  function reset() {
    history.value = []
    question.value = ""
    options.value = []
    directions.value = []
    token.value = ""
    finished.value = false
    turn.value = 1
    mock.value = false
    error.value = ""
    llmBlocked.value = false
    profile.value = { goal: null, level: null, timeBudget: null, preference: null }
    clearDraft()
  }

  return {
    history,
    question,
    options,
    profile,
    directions,
    token,
    turn,
    finished,
    loading,
    mock,
    error,
    llmBlocked,
    hasStarted,
    start,
    answer,
    reset,
    restoreDraft,
    clearDraft,
  }
}
