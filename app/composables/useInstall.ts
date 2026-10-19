import type { InstallPayload, InstallStatusResponse } from "#shared/types/install"

/**
 * 安装向导相关逻辑（状态查询、连接测试、执行安装）。
 */
export function useInstall() {
	const state = useState<InstallStatusResponse>("fsp:install-status", () => ({
		installed: false,
		installedAt: null,
		siteName: "FSP",
	}))

	async function fetchStatus(): Promise<InstallStatusResponse> {
		const data = await $fetch<InstallStatusResponse>("/api/install/status")
		state.value = data
		return data
	}

	async function testConnection(file: string) {
		return await $fetch<{ ok: boolean, file: string }>("/api/install/test-connection", {
			method: "POST",
			body: { database: { file } },
		})
	}

	async function setup(payload: InstallPayload) {
		return await $fetch<{ installed: boolean, installedAt: string | null }>("/api/install/setup", {
			method: "POST",
			body: payload,
		})
	}

	return { state, fetchStatus, testConnection, setup }
}
