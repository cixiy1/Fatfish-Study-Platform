import { describe, expect, it } from "vitest"
import {
	validateAdminInput,
	validateDatabaseInput,
	validateInstallPayload,
	validateLlmInput,
	validateOAuthInput,
	validateSmtpInput,
} from "../../shared/utils/validate-install"

describe("validate-install", () => {
	it("数据库文件路径为空则失败", () => {
		expect(validateDatabaseInput({ file: "" }).ok).toBe(false)
		expect(validateDatabaseInput({ file: "   " }).ok).toBe(false)
		expect(validateDatabaseInput({ file: "data/fsp.db" }).ok).toBe(true)
	})

	it("管理员账号过短失败", () => {
		expect(validateAdminInput({ account: "ab", password: "Abcd1234" }).ok).toBe(false)
		expect(validateAdminInput({ account: "admin", password: "Abcd1234" }).ok).toBe(true)
	})

	it("弱密码失败", () => {
		expect(validateAdminInput({ account: "admin", password: "12345678" }).ok).toBe(false)
		expect(validateAdminInput({ account: "admin", password: "abcdefgh" }).ok).toBe(false)
		expect(validateAdminInput({ account: "admin", password: "Abcd1234" }).ok).toBe(true)
	})

	it("邮箱格式非法失败", () => {
		expect(validateAdminInput({ account: "admin", password: "Abcd1234", email: "bad" }).ok).toBe(false)
		expect(validateAdminInput({ account: "admin", password: "Abcd1234", email: "a@b.com" }).ok).toBe(true)
	})

	it("整体校验：数据库错误优先返回", () => {
		const result = validateInstallPayload({
			database: { file: "" },
			admin: { account: "admin", password: "Abcd1234" },
		})
		expect(result.ok).toBe(false)
		expect(result.message).toContain("数据库")
	})

	it("缺大模型配置失败（必填）", () => {
		const result = validateInstallPayload({
			database: { file: "data/fsp.db" },
			admin: { account: "admin", password: "Abcd1234" },
		})
		expect(result.ok).toBe(false)
		expect(result.message).toContain("大模型")
	})

	it("完整合法载荷通过", () => {
		const result = validateInstallPayload({
			database: { file: "data/fsp.db" },
			admin: { account: "admin", password: "Abcd1234" },
			llm: { provider: "openai", apiKey: "sk-test", model: "gpt-4o" },
		})
		expect(result.ok).toBe(true)
	})
})

describe("validate-smtp", () => {
	it("未提供时放行", () => {
		expect(validateSmtpInput(undefined).ok).toBe(true)
	})

	it("Gmail 预设合法配置通过", () => {
		expect(
			validateSmtpInput({
				preset: "gmail",
				user: "user@gmail.com",
				pass: "app-password",
				from: "noreply@gmail.com",
			}).ok,
		).toBe(true)
	})

	it("自定义预设缺主机失败", () => {
		expect(
			validateSmtpInput({
				preset: "custom",
				user: "user",
				pass: "pass",
				from: "a@b.com",
			}).ok,
		).toBe(false)
	})

	it("自定义预设合法配置通过", () => {
		expect(
			validateSmtpInput({
				preset: "custom",
				host: "smtp.example.com",
				port: 465,
				user: "user",
				pass: "pass",
				from: "noreply@example.com",
			}).ok,
		).toBe(true)
	})

	it("发件人邮箱格式错误失败", () => {
		expect(
			validateSmtpInput({
				preset: "gmail",
				user: "user",
				pass: "pass",
				from: "not-an-email",
			}).ok,
		).toBe(false)
	})

	it("密码为空失败", () => {
		expect(
			validateSmtpInput({
				preset: "gmail",
				user: "user",
				pass: "",
				from: "a@b.com",
			}).ok,
		).toBe(false)
	})

	it("端口越界失败", () => {
		expect(
			validateSmtpInput({
				preset: "custom",
				host: "smtp.example.com",
				port: 99999,
				user: "user",
				pass: "pass",
				from: "a@b.com",
			}).ok,
		).toBe(false)
	})
})

describe("validate-oauth", () => {
	it("未提供时放行", () => {
		expect(validateOAuthInput(undefined).ok).toBe(true)
	})

	it("空对象放行", () => {
		expect(validateOAuthInput({}).ok).toBe(true)
	})

	it("GitHub 合法凭证通过", () => {
		expect(
			validateOAuthInput({
				github: { clientId: "id", clientSecret: "secret" },
			}).ok,
		).toBe(true)
	})

	it("GitHub 缺 Client ID 失败", () => {
		expect(
			validateOAuthInput({
				github: { clientId: "", clientSecret: "secret" },
			}).ok,
		).toBe(false)
	})

	it("GitHub 缺 Secret 失败", () => {
		expect(
			validateOAuthInput({
				github: { clientId: "id", clientSecret: "" },
			}).ok,
		).toBe(false)
	})
})

describe("validate-llm", () => {
	it("未提供时失败（大模型是必填依赖）", () => {
		expect(validateLlmInput(undefined).ok).toBe(false)
	})

	it("缺 API Key 失败", () => {
		expect(
			validateLlmInput({ provider: "openai", apiKey: "", model: "gpt-4o" }).ok,
		).toBe(false)
	})

	it("缺模型名称失败", () => {
		expect(
			validateLlmInput({ provider: "openai", apiKey: "sk-test", model: "" }).ok,
		).toBe(false)
	})

	it("自定义提供商缺 Base URL 失败", () => {
		expect(
			validateLlmInput({ provider: "custom", apiKey: "sk-test", model: "my-model" }).ok,
		).toBe(false)
	})

	it("预设提供商合法配置通过", () => {
		expect(
			validateLlmInput({ provider: "anthropic", apiKey: "sk-ant", model: "claude-3-5-sonnet" }).ok,
		).toBe(true)
	})

	it("自定义提供商填全通过", () => {
		expect(
			validateLlmInput({
				provider: "custom",
				baseUrl: "https://maas.example.com/v1",
				apiKey: "sk-test",
				model: "pangu",
			}).ok,
		).toBe(true)
	})
})
