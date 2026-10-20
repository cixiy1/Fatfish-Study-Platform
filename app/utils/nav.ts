/**
 * 全站导航数据：顶部、抽屉、移动端共用这一份，避免多处复制。
 * 分组逻辑对应「渐进式推进」——主线常显，其余功能收进「更多功能」。
 */
export interface NavItem {
  icon: string
  label: string
  to: string
  /** 仅管理员可见 */
  adminOnly?: boolean
}

export interface NavGroup {
  title: string
  items: NavItem[]
}

export const NAV_GROUPS: NavGroup[] = [
  {
    title: "学习主线",
    items: [
      { icon: "i-lucide-home", label: "今日", to: "/" },
      { icon: "i-lucide-route", label: "关卡路径", to: "/learning" },
      { icon: "i-lucide-clipboard-check", label: "能力测评", to: "/assessment" },
    ],
  },
  {
    title: "更多功能",
    items: [
      { icon: "i-lucide-network", label: "技能图谱", to: "/positions" },
      { icon: "i-lucide-message-circle-question", label: "智能答疑", to: "/qa" },
      { icon: "i-lucide-chart-line", label: "学习复盘", to: "/reports" },
      { icon: "i-lucide-settings", label: "计划设置", to: "/plan" },
      { icon: "i-lucide-user", label: "个人中心", to: "/account" },
    ],
  },
]

/** 顶部导航只放主线三项，其余走抽屉 */
export const PRIMARY_NAV: NavItem[] = NAV_GROUPS[0]!.items
