export interface DashboardNextItem {
  id: number
  index: number
  skillName: string
  resourceTitle: string | null
}

export interface DashboardData {
  hasPath: boolean
  pathName: string | null
  position: { id: number, name: string } | null
  total: number
  completed: number
  percent: number
  todayDone: number
  todayGoal: number
  dailyMinutes: number
  xp: number
  streak: number
  nextItem: DashboardNextItem | null
}

/**
 * 学习仪表盘数据的唯一来源。
 * Header、首页、关卡页共用同一份缓存（key 固定），完成关卡后调 refresh() 即可全站同步。
 * 未登录时不发请求，避免 401 噪声。
 */
export function useLearner() {
  const { user } = useAuthSession()

  // SSR 下必须用 useRequestFetch() 才会把原始请求的 cookie 转发给内部 API，
  // 否则 /api/dashboard 会拿到 401，首页在首屏就是空的。
  const fetcher = import.meta.server ? useRequestFetch() : $fetch

  const { data, pending, error, refresh } = useAsyncData<DashboardData | null>(
    "learner-dashboard",
    () => (user.value ? fetcher<DashboardData>("/api/dashboard") : Promise.resolve(null)),
    { default: () => null },
  )

  const dashboard = computed(() => data.value ?? null)

  return { dashboard, pending, error, refresh }
}
