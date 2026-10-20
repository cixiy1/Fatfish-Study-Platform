import { describe, expect, it } from "vitest"
import { renderMarkdown } from "../../app/utils/markdown"

/**
 * 正文来自模型，渲染器必须「先转义再上标签」，
 * 所以这里的重点不是排版好不好看，而是恶意/意外 HTML 不能穿透。
 */
describe("renderMarkdown", () => {
	it("空值返回空串", () => {
		expect(renderMarkdown(null)).toBe("")
		expect(renderMarkdown(undefined)).toBe("")
		expect(renderMarkdown("")).toBe("")
	})

	it("渲染二级标题、段落与有序列表", () => {
		const html = renderMarkdown("## 为什么学它\n这是第一段。\n\n1. 第一步\n2. 第二步")
		expect(html).toContain("<h2>为什么学它</h2>")
		expect(html).toContain("<p>这是第一段。</p>")
		expect(html).toContain("<ol><li>第一步</li><li>第二步</li></ol>")
	})

	it("渲染无序列表、引用与分隔线", () => {
		const html = renderMarkdown("- 甲\n- 乙\n\n> 提示\n\n---")
		expect(html).toContain("<ul><li>甲</li><li>乙</li></ul>")
		expect(html).toContain("<blockquote>提示</blockquote>")
		expect(html).toContain("<hr>")
	})

	it("代码块内保留内容且整体转义", () => {
		const html = renderMarkdown("```ts\nconst a = 1 < 2 && 3 > 2\n```")
		expect(html).toContain('<pre><code class="language-ts">')
		expect(html).toContain("const a = 1 &lt; 2 &amp;&amp; 3 &gt; 2")
		expect(html).not.toContain("<code class=\"language-ts\">const a = 1 <")
	})

	it("行内加粗与行内代码生效", () => {
		const html = renderMarkdown("用 **flex** 和 `gap` 排版")
		expect(html).toContain("<strong>flex</strong>")
		expect(html).toContain("<code>gap</code>")
	})

	it("注入的脚本标签被转义，不会变成真实标签", () => {
		const html = renderMarkdown('正常文字 <script>alert("x")</script> <img src=x onerror=alert(1)>')
		expect(html).not.toContain("<script>")
		expect(html).not.toContain("<img")
		expect(html).toContain("&lt;script&gt;")
	})

	it("一级标题降级为 h2，保证页面只有一个 h1", () => {
		expect(renderMarkdown("# 大标题")).toBe("<h2>大标题</h2>")
	})
})
