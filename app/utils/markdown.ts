/**
 * 极简 Markdown 渲染器（够用即止）。
 *
 * 为什么不用 marked / markdown-it：
 * 1. 正文来自模型，直接 v-html 有 XSS 风险，这里先转义再拼标签，天然安全；
 * 2. 只需要 h2/h3、段落、列表、引用、代码块、加粗、行内代码这几种语法，
 *    引一个通用库反而要额外配 sanitize。
 *
 * 支持的语法子集（遇到不认识的语法就当成普通段落文字，不会丢内容）。
 */

function escapeHtml(input: string): string {
	return input
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
}

/** 行内语法：先转义，再上标签，顺序不能反 */
function renderInline(text: string): string {
	return escapeHtml(text)
		.replace(/`([^`]+)`/g, "<code>$1</code>")
		.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
		// 链接只放行 http/https，避免模型或用户输入带出 javascript: 之类的协议
		.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')
}

const OL_RE = /^\d+[.、]\s+/
const UL_RE = /^[-*]\s+/

export function renderMarkdown(markdown: string | null | undefined): string {
	if (!markdown) return ""

	const lines = markdown.replace(/\r\n/g, "\n").split("\n")
	const html: string[] = []

	let paragraph: string[] = []
	let list: { ordered: boolean, items: string[] } | null = null
	/**
	 * 上一个非空行是否是列表项。
	 * 用来把「列表项 + 紧跟的说明行」当成同一项：
	 *
	 *   1. **单色明度阶**
	 *   只用一个色相，调出 5 档明度。
	 *
	 * 模型基本都这么写。若把说明行当独立段落，列表会被逐项切断，
	 * 渲染成多个 <ol>，编号全从 1 开始。
	 */
	let continueList = false

	function flushParagraph(): void {
		if (paragraph.length === 0) return
		html.push(`<p>${renderInline(paragraph.join(" "))}</p>`)
		paragraph = []
	}

	function flushList(): void {
		continueList = false
		if (!list) return
		const tag = list.ordered ? "ol" : "ul"
		html.push(`<${tag}>${list.items.map((item) => `<li>${renderInline(item)}</li>`).join("")}</${tag}>`)
		list = null
	}

	function flushAll(): void {
		flushParagraph()
		flushList()
	}

	for (let i = 0; i < lines.length; i++) {
		const line = (lines[i] ?? "").replace(/\s+$/, "")

		// 空行：结束当前段落。
		// 这里**不结束列表**：模型常用空行分隔列表项（`1. xxx` 之间空一行），
		// 一遇空行就 flush 会变成多个独立的 <ol>，渲染出来每项都从 1 开始编号。
		// 列表真正的结束交给后面的 flushList / flushAll（遇到非列表内容时触发）。
		if (line.trim() === "") {
			flushParagraph()
			continueList = false
			continue
		}

		// 代码块：原样保留缩进，内容整体转义
		if (line.trimStart().startsWith("```")) {
			flushAll()
			const lang = line.trimStart().slice(3).trim()
			const code: string[] = []

			for (i += 1; i < lines.length; i++) {
				if ((lines[i] ?? "").trimStart().startsWith("```")) break
				code.push(lines[i] ?? "")
			}

			const cls = lang ? ` class="language-${escapeHtml(lang)}"` : ""
			html.push(`<pre><code${cls}>${escapeHtml(code.join("\n"))}</code></pre>`)
			continue
		}

		// 标题：# 当二级用，页面本身已有 h1
		const heading = /^(#{1,4})\s+(.*)$/.exec(line)
		if (heading) {
			flushAll()
			const level = Math.min(3, Math.max(2, (heading[1] ?? "#").length))
			html.push(`<h${level}>${renderInline(heading[2] ?? "")}</h${level}>`)
			continue
		}

		// 分隔线
		if (/^(-{3,}|\*{3,})$/.test(line.trim())) {
			flushAll()
			html.push("<hr>")
			continue
		}

		// 引用
		if (line.startsWith(">")) {
			flushAll()
			html.push(`<blockquote>${renderInline(line.replace(/^>\s?/, ""))}</blockquote>`)
			continue
		}

		// 列表
		if (OL_RE.test(line) || UL_RE.test(line)) {
			flushParagraph()
			const ordered = OL_RE.test(line)
			const text = line.replace(ordered ? OL_RE : UL_RE, "")

			// 有序和无序混排时另起一个列表
			if (list && list.ordered !== ordered) flushList()
			if (!list) list = { ordered, items: [] }
			list.items.push(text)
			continueList = true
			continue
		}

		// 列表项的续行（说明文字）：紧跟在列表项之后、中间没有空行，并入上一项
		if (list && continueList) {
			const lastIndex = list.items.length - 1
			const last = list.items[lastIndex]
			if (last !== undefined) list.items[lastIndex] = `${last} ${line.trim()}`
			continue
		}

		// 普通段落行
		flushList()
		paragraph.push(line.trim())
	}

	flushAll()
	return html.join("\n")
}
