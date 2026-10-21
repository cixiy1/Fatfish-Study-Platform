/**
 * 学习节点的「参考来源」。
 *
 * 为什么要有这一层：模型写的课文再好也只是二手转述，学习者需要能点开官方文档、
 * 标准原文或同行评议的论文去核对。学 Java 就该给 Oracle 的 API 文档，想健身就该给
 * ACSM / WHO / PubMed，而不是随便丢一个博客。
 *
 * 风险是模型编链接（幻觉 URL 是 LLM 最常见的错误之一），所以这里做三道过滤：
 * 1. 形状过滤：必须 http(s)、有域名、不能是本机/内网/示例域名；
 * 2. 分类标注：按域名判断是官方文档 / 学术 / 标准 / 社区，让人一眼看出性质；
 * 3. 可达性探测：并发 HEAD 一次，把打不开的标出来（不删除——可能是临时抖动）。
 *
 * 探测不到外网时（评测机、离线演示）统一标「未校验」而不是「失效」，
 * 否则整页红叉会让人误以为内容有问题。
 */

export type ReferenceKind = "official" | "academic" | "standard" | "community" | "other"
export type ReferenceStatus = "ok" | "unreachable" | "unchecked"

export interface Reference {
	title: string
	url: string
	/** 站点/机构名，如 Oracle、MDN、PubMed */
	publisher: string
	kind: ReferenceKind
	/** 一句话说明这条链接对应文中的哪部分 */
	note: string
	status: ReferenceStatus
}

/* -------------------------------------------------------------------------- */
/* 域名分类                                                                    */
/* -------------------------------------------------------------------------- */

/** 同行评议 / 权威机构 / 医学与运动科学 */
const ACADEMIC_HOSTS = [
	"pubmed.ncbi.nlm.nih.gov",
	"ncbi.nlm.nih.gov",
	"nlm.nih.gov",
	"doi.org",
	"nature.com",
	"sciencedirect.com",
	"springer.com",
	"link.springer.com",
	"arxiv.org",
	"cochrane.org",
	"cochranelibrary.com",
	"bmj.com",
	"jamanetwork.com",
	"thelancet.com",
	"nejm.org",
	"cell.com",
	"science.org",
	"who.int",
	"cdc.gov",
	"nih.gov",
	"acsm.org",
	"nsca.com",
	"acefitness.org",
	"nasm.org",
	"mayoclinic.org",
	"clevelandclinic.org",
	"aap.org",
	"heart.org",
	"diabetes.org",
	"semanticscholar.org",
	"scholar.google.com",
	"researchgate.net",
	// 政府 / 大学 / 国际组织：默认按权威来源对待
	"gov",
	"gov.cn",
	"gov.uk",
	"edu",
	"edu.cn",
	"edu.hk",
	"ac.cn",
	"europa.eu",
	"un.org",
]

/** 标准组织 */
const STANDARD_HOSTS = [
	"w3.org",
	"ietf.org",
	"rfc-editor.org",
	"iso.org",
	"iec.ch",
	"ieee.org",
	"ecma-international.org",
	"whatwg.org",
	"khronos.org",
	"unicode.org",
	"oasis-open.org",
	"itu.int",
	"gb688.cn",
]

/** 官方产品/语言文档 */
const OFFICIAL_HOSTS = [
	"docs.oracle.com",
	"docs.python.org",
	"developer.mozilla.org",
	"devdocs.io",
	"docs.rs",
	"javadoc.io",
	"cppreference.com",
	"learn.microsoft.com",
	"developer.android.com",
	"developer.apple.com",
	"kubernetes.io",
	"docs.docker.com",
	"postgresql.org",
	"dev.mysql.com",
	"redis.io",
	"vuejs.org",
	"react.dev",
	"nuxt.com",
	"nodejs.org",
	"go.dev",
	"rust-lang.org",
	"typescriptlang.org",
	"vitejs.dev",
	"webpack.js.org",
	"tailwindcss.com",
	"angular.io",
	"svelte.dev",
	"dart.dev",
	"flutter.dev",
	"pytorch.org",
	"tensorflow.org",
	"scikit-learn.org",
	"numpy.org",
	"pandas.pydata.org",
	"docs.aws.amazon.com",
	"cloud.google.com",
	"readthedocs.io",
	"gnu.org",
	"kernel.org",
	"python.org",
	"java.com",
	"oracle.com",
	// 语言学习与考试：官方机构 / 权威词典
	"britishcouncil.org",
	"cambridge.org",
	"dictionary.cambridge.org",
	"cambridgeenglish.org",
	"ets.org",
	"ielts.org",
	"oxfordlearnersdictionaries.com",
	"oed.com",
	"merriam-webster.com",
	"collinsdictionary.com",
	"goethe.de",
	"delftmethod.eu",
]

/** 社区与教程站（可信度低于官方，但仍可参考） */
const COMMUNITY_HOSTS = [
	"stackoverflow.com",
	"github.com",
	"medium.com",
	"dev.to",
	"freecodecamp.org",
	"geeksforgeeks.org",
	"juejin.cn",
	"zhihu.com",
	"csdn.net",
	"reddit.com",
	"youtube.com",
	"bilibili.com",
]

function hostMatches(host: string, list: string[]): boolean {
	return list.some((item) => host === item || host.endsWith(`.${item}`))
}

/** 按域名判断链接性质；不在任何名单里也不代表不可信，只是无法分类 */
export function classifyHost(host: string): ReferenceKind {
	const normalized = host.toLowerCase()
	if (hostMatches(normalized, ACADEMIC_HOSTS)) return "academic"
	if (hostMatches(normalized, STANDARD_HOSTS)) return "standard"
	if (hostMatches(normalized, OFFICIAL_HOSTS)) return "official"
	if (hostMatches(normalized, COMMUNITY_HOSTS)) return "community"
	return "other"
}

/** 明显不能作为学习来源的主机：本机、内网、示例域名、无点域名 */
function isBlockedHost(host: string): boolean {
	const h = host.toLowerCase()
	if (!h || !h.includes(".")) return true
	if (h === "localhost" || h.endsWith(".localhost")) return true
	if (h.endsWith(".local") || h.endsWith(".test") || h.endsWith(".invalid") || h.endsWith(".example") || h.endsWith(".internal")) return true
	if (/^\d{1,3}(\.\d{1,3}){3}$/.test(h)) {
		// IPv4 字面量：只允许公网地址
		const first = Number(h.split(".")[0])
		return first === 10 || first === 127 || first === 0 || first === 192 || first === 172
	}
	if (h.startsWith("[")) return true // IPv6 字面量
	if (["example.com", "example.org", "example.net", "domain.com", "your-domain.com", "website.com", "url.com"].includes(h)) return true
	return false
}

/** 从 host 推一个像样的机构名：docs.oracle.com → Oracle */
function derivePublisher(host: string): string {
	const clean = host.replace(/^www\./, "")
	const parts = clean.split(".")
	const main = parts.length >= 2 ? parts[parts.length - 2] : clean
	const known: Record<string, string> = {
		oracle: "Oracle",
		mozilla: "MDN",
		python: "Python",
		nodejs: "Node.js",
		golang: "Go",
		go: "Go",
		rust: "Rust",
		typescriptlang: "TypeScript",
		github: "GitHub",
		stackoverflow: "Stack Overflow",
		ncbi: "NCBI",
		nih: "NIH",
		who: "WHO",
		cdc: "CDC",
		acsm: "ACSM",
		nature: "Nature",
		doi: "DOI",
		w3: "W3C",
		ietf: "IETF",
		iso: "ISO",
		ieee: "IEEE",
		baidu: "百度",
		zhihu: "知乎",
		juejin: "掘金",
		csdn: "CSDN",
	}
	if (known[main]) return known[main]
	return main.charAt(0).toUpperCase() + main.slice(1)
}

/* -------------------------------------------------------------------------- */
/* 解析与清洗                                                                  */
/* -------------------------------------------------------------------------- */

const MAX_REFERENCES = 4
const MAX_TITLE = 80
const MAX_NOTE = 60

function text(value: unknown, maxLen: number): string {
	return typeof value === "string" ? value.trim().slice(0, maxLen) : ""
}

/**
 * 把模型给的 URL 规整成可点击链接；非法就返回 null。
 *
 * 模型常见毛病：省掉协议头、给相对路径、给 example.com 占位符。
 * 前两种能救就救，占位符一律丢弃。
 */
export function normalizeReferenceUrl(raw: unknown): string | null {
	let value = text(raw, 500)
	if (!value) return null
	if (!/^https?:\/\//i.test(value)) {
		if (!/^[\w.-]+\.[a-z]{2,}/i.test(value)) return null
		value = `https://${value.replace(/^\/+/, "")}`
	}
	try {
		const url = new URL(value)
		if (url.protocol !== "http:" && url.protocol !== "https:") return null
		if (isBlockedHost(url.hostname)) return null
		url.hash = ""
		return url.toString()
	} catch {
		return null
	}
}

/**
 * 清洗模型给出的 references 字段。
 *
 * 容忍三种形态：字符串数组、对象数组、单个对象。
 * 任何一条不合格就丢掉那一条，不影响整个学习节点——引用是加分项，不该拖垮主流程。
 */
export function parseReferences(value: unknown, max = MAX_REFERENCES): Reference[] {
	const list = Array.isArray(value)
		? value
		: typeof value === "string" || (value && typeof value === "object")
			? [value]
			: []

	const result: Reference[] = []
	const seen = new Set<string>()

	for (const item of list) {
		if (result.length >= max) break

		let url: string | null = null
		let title = ""
		let publisher = ""
		let note = ""
		let kind: ReferenceKind | null = null
		let status: ReferenceStatus = "unchecked"

		if (typeof item === "string") {
			url = normalizeReferenceUrl(item)
		} else if (item && typeof item === "object") {
			const obj = item as Record<string, unknown>
			url = normalizeReferenceUrl(obj.url ?? obj.link ?? obj.href)
			title = text(obj.title ?? obj.name, MAX_TITLE)
			publisher = text(obj.publisher ?? obj.source ?? obj.site, 40)
			note = text(obj.note ?? obj.why ?? obj.reason ?? obj.desc, MAX_NOTE)
			const declared = text(obj.kind ?? obj.type, 20).toLowerCase()
			if (["official", "docs", "academic", "standard", "community", "other"].includes(declared)) {
				kind = declared === "docs" ? "official" : (declared as ReferenceKind)
			}
			// 从库里读回时要保留上次探测结果，不能一律重置成「未校验」
			const storedStatus = text(obj.status, 16)
			if (storedStatus === "ok" || storedStatus === "unreachable" || storedStatus === "unchecked") {
				status = storedStatus
			}
		}

		if (!url) continue

		// 同一页面的不同锚点算同一条
		let key = url
		try {
			const parsed = new URL(url)
			key = `${parsed.hostname}${parsed.pathname.replace(/\/+$/, "")}`
		} catch {
			// 保留原样
		}
		if (seen.has(key)) continue
		seen.add(key)

		let host = ""
		try {
			host = new URL(url).hostname
		} catch {
			continue
		}

		result.push({
			title: title || publisher || host.replace(/^www\./, ""),
			url,
			publisher: publisher || derivePublisher(host),
			kind: kind ?? classifyHost(host),
			note,
			status,
		})
	}

	return result
}

/** 从库里读回 JSON 字段，坏数据返回空数组 */
export function parseReferenceJson(raw: string | null): Reference[] {
	if (!raw) return []
	let parsed: Reference[] = []
	try {
		parsed = parseReferences(JSON.parse(raw), MAX_REFERENCES)
	} catch {
		return []
	}
	// 域名分类规则会随版本扩充，读回时用最新规则校准一遍，
	// 让历史数据里标成「其他」的官方站点也能正确显示
	return parsed.map((ref) => {
		try {
			const kind = classifyHost(new URL(ref.url).hostname)
			return kind === "other" ? ref : { ...ref, kind }
		} catch {
			return ref
		}
	})
}

/* -------------------------------------------------------------------------- */
/* 可达性探测                                                                  */
/* -------------------------------------------------------------------------- */

/** 探测超时：够慢站点响应，又不至于把整个生成流程拖住 */
const PROBE_TIMEOUT_MS = 4000
/** 用来判断「到底是我探测不到外网，还是这些链接真的坏了」 */
const CONTROL_URL = "https://www.baidu.com/favicon.ico"

async function probe(url: string, timeoutMs: number): Promise<ReferenceStatus> {
	const request = async (method: "HEAD" | "GET") => {
		const response = await fetch(url, {
			method,
			redirect: "follow",
			signal: AbortSignal.timeout(timeoutMs),
			headers: {
				// 部分站点直接拒绝无 UA 的请求
				"user-agent": "Mozilla/5.0 (compatible; FSP-LearningBot/1.0)",
				"accept": "text/html,application/xhtml+xml,*/*;q=0.8",
			},
		})
		// GET 只是兜底探测，正文不需要
		if (method === "GET") response.body?.cancel().catch(() => {})
		return response
	}

	try {
		let response = await request("HEAD")
		// 不少站点不支持 HEAD，或对 HEAD 直接 403
		if (response.status === 405 || response.status === 403 || response.status === 501) {
			response = await request("GET")
		}
		// 401/403/429 说明主机活着，只是不欢迎机器人——对人来说链接是好用的
		if (response.status < 400 || [401, 403, 405, 429].includes(response.status)) return "ok"
		return "unreachable"
	} catch {
		return "unreachable"
	}
}

/**
 * 并发探测所有引用，回填 status。
 *
 * 全部探测失败时先探一个对照组：对照组也打不通说明本机没外网，
 * 这时统一标「未校验」，避免把离线环境的限制误报成「链接全挂了」。
 */
export async function verifyReferences(
	refs: Reference[],
	timeoutMs = PROBE_TIMEOUT_MS,
): Promise<Reference[]> {
	if (refs.length === 0) return refs

	const statuses = await Promise.all(refs.map((ref) => probe(ref.url, timeoutMs)))
	const allFailed = statuses.every((status) => status === "unreachable")

	if (allFailed) {
		const online = await probe(CONTROL_URL, timeoutMs) === "ok"
		if (!online) {
			return refs.map((ref) => ({ ...ref, status: "unchecked" as const }))
		}
	}

	return refs.map((ref, index) => ({ ...ref, status: statuses[index] ?? "unchecked" }))
}

/** 只取域名，给生成中的卡片做小角标用（不必把整条链接塞进 SSE） */
export function referenceHosts(refs: Reference[]): string[] {
	const hosts: string[] = []
	for (const ref of refs) {
		try {
			const host = new URL(ref.url).hostname.replace(/^www\./, "")
			if (!hosts.includes(host)) hosts.push(host)
		} catch {
			// 忽略
		}
	}
	return hosts.slice(0, 3)
}
