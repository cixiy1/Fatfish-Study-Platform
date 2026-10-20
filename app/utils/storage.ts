/**
 * 安全获取 storage。
 *
 * 沙箱 iframe（内嵌预览）或部分隐私模式下，读 `window.localStorage` 会直接抛
 * SecurityError，连 `typeof sessionStorage` 都不安全，所以必须先 try/catch 再取。
 * 取不到就返回 null，调用方按「没有存储」降级即可。
 */
export function safeStorage(kind: "session" | "local" = "session"): Storage | null {
  try {
    return kind === "local" ? window.localStorage : window.sessionStorage
  } catch {
    return null
  }
}
