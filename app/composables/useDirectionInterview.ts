import type {
  DirectionCandidate,
  DirectionInterviewResponse,
  DirectionMessage,
  DirectionProfile,
} from "#shared/types/direction"
import type { AnswerValue, AssessmentQuestion } from "#shared/types/assessment"
import { describeAnswer, plainQuestion } from "#shared/utils/assessment"
import { postSse } from "~/composables/useSse"

const DRAFT_KEY = "fsp:direction-draft"

/**
 * 方向访谈的状态机。
 *
 * 网络请求全部发生在事件回调里（不在 setup 顶层 await），
 * 否则 SSR 会等模型返回，首屏直接变慢。
 */
export function useDirectionInterview() {
  const history = ref<DirectionMessage[]>([])
  /** 当前这道题：可能是单选、多选、填空、表单、自评或开放题 */
  const ask = ref<AssessmentQuestion | null>(null)
  /** 模型正在写的题干（流式），写完才变成 ask 卡片 */
  const streamText = ref("")
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

  /** 把服务端返回的一轮结果写进状态（流式与非流式共用） */
  function applyResponse(response: DirectionInterviewResponse) {
    mock.value = response.mock
    profile.value = response.profile

    if (response.done) {
      directions.value = response.directions ?? []
      token.value = response.selectionToken ?? ""
      finished.value = true
      turn.value = response.turn
      ask.value = null
      question.value = ""
      options.value = []
      saveDraft()
      return
    }

    turn.value = response.turn
    ask.value = response.ask ?? null
    question.value = response.question || (response.ask ? plainQuestion(response.ask) : "")
    options.value = response.options ?? []
    // 记录里只存题干纯文本：填空题的 [[1]] 标记不该出现在聊天气泡里
    history.value.push({ role: "assistant", content: question.value })
  }

  /**
   * 请求下一个问题（流式）。
   *
   * 模型先思考再动笔，所以先推 stage 让界面进入「正在思考」；
   * 一旦开始写题干就逐字追加，用户能看到问题是被一点点写出来的，
   * 而不是盯着一个跑得比模型还快的进度条。
   */
  async function request() {
    loading.value = true
    error.value = ""
    streamText.value = ""

    let settled = false
    let errorMessage = ""
    let errorStatus = 0

    try {
      await postSse("/api/direction/interview.stream", { history: history.value }, {
        stage: () => {
          streamText.value = ""
        },
        reset: () => {
          streamText.value = ""
        },
        delta: (data: { text?: string }) => {
          if (data?.text) streamText.value += data.text
        },
        question: (data: DirectionInterviewResponse) => {
          settled = true
          applyResponse(data)
        },
        error: (data: { status?: number, message?: string }) => {
          errorMessage = data?.message || "生成问题失败，请重试"
          errorStatus = data?.status ?? 502
        },
      }, { openTimeoutMs: 20_000, idleTimeoutMs: 90_000 })
    } catch (err) {
      const status = (err as { status?: number }).statusCode ?? (err as { status?: number }).status
      const data = (err as { data?: { code?: string, message?: string } }).data
      // 未配置大模型：不是网络问题，重试没用，必须去配置
      if (status === 503 || data?.code === "LLM_NOT_CONFIGURED") {
        llmBlocked.value = true
      }
      errorMessage = data?.message || (err instanceof Error ? err.message : "网络异常，请重试")
      errorStatus = status ?? 0
    } finally {
      loading.value = false
      streamText.value = ""
    }

    if (settled) return

    if (llmBlocked.value) {
      error.value = errorMessage || "尚未配置大模型接口"
      return
    }
    error.value = errorStatus === 429
      ? "操作过于频繁，请稍后再试"
      : errorMessage || "没有收到新问题，请重试"
  }

  /** 开始访谈：问出第一个问题 */
  async function start() {
    if (hasStarted.value) return
    await request()
  }

  /**
   * 回答当前问题。
   *
   * 值可能是选项下标、下标数组、填空数组、表单对象或一段文字，统一转成
   * 一句自然语言再进对话记录——服务端只看文本，不需要理解题型结构。
   * 用户用「自己说」绕开控件时传字符串，这里按原话透传。
   */
  async function answer(value: AnswerValue) {
    const current = ask.value
    const raw = typeof value === "string" ? value.trim() : ""
    const text = raw && current && current.kind !== "text"
      ? raw
      : current
        ? describeAnswer(current, value)
        : raw

    if (!text || text === "未作答") return

    history.value.push({ role: "user", content: text })
    await request()
  }

  /** 跳过当前题（开放题允许不答） */
  async function skip() {
    if (!ask.value || loading.value) return
    history.value.push({ role: "user", content: "这题先跳过，按你的建议安排" })
    ask.value = null
    await request()
  }

  /** 网络/模型出错后重试当前这一轮（不会重复写入回答） */
  async function retry() {
    if (loading.value) return
    error.value = ""
    await request()
  }

  /** 重新开始（清空历史与草稿） */
  function reset() {
    history.value = []
    ask.value = null
    streamText.value = ""
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
    ask,
    streamText,
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
    skip,
    retry,
    reset,
    restoreDraft,
    clearDraft,
  }
}
