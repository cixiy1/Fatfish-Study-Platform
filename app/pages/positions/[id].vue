<script setup lang="ts">
import { postSse } from "~/composables/useSse"

useHead({ title: "技能图谱 · FSP" })

interface Skill {
  id: number
  name: string
  category: string
  parent_id: number | null
  level: number
  description: string | null
  required_level: number
}

interface EvolveResult {
  applied: boolean
  summary: string
  added: { skillId: number, name: string }[]
  releveled: { skillId: number, name: string, requiredLevel: number }[]
  reordered: number
  pruned: { skillId: number, name: string }[]
}

const route = useRoute()
const loading = ref(true)
const position = ref<{ id: number, name: string, category: string, description: string | null } | null>(null)
const skills = ref<Skill[]>([])
const userSkillMap = ref<Map<number, string>>(new Map())
const updating = ref<number | null>(null)

const analyzing = ref(false)
const streamText = ref("")
const analysisResult = ref<{ summary: string, recommendations: { skillName: string, status: string, reason: string }[] } | null>(null)
const analyzeError = ref<string | null>(null)

// 图谱演进：模型先给结构化 diff（proposal），落库后再回传实际改动（done）
const evolving = ref(false)
const evolveText = ref("")
const evolveResult = ref<EvolveResult | null>(null)
const evolveError = ref<string | null>(null)

async function loadData() {
  loading.value = true
  try {
    const data = await $fetch<{ position: typeof position.value, skills: Skill[], userSkills: { skill_id: number, status: string }[] }>(`/api/positions/${route.params.id}`)
    position.value = data.position
    skills.value = data.skills
    userSkillMap.value = new Map(data.userSkills.map((s) => [s.skill_id, s.status]))
  } catch {

    // 忽略

  } finally {
    loading.value = false
  }
}

onMounted(async () => {
  await loadData()
  // 从测评结果页带过来的：直接替用户点一次 AI 分析，把测评结论落回图谱
  if (route.query.autoAnalyze === "1") {
    await aiAnalyze()
  }
})

async function toggleSkill(skill: Skill, status: string) {
  updating.value = skill.id
  try {
    await $fetch("/api/skills/user", {
      method: "POST",
      body: { skill_id: skill.id, status, level: skill.required_level },
    })
    userSkillMap.value.set(skill.id, status)
  } catch {

    // 忽略

  } finally {
    updating.value = null
  }
}

async function aiAnalyze() {
  analyzing.value = true
  streamText.value = ""
  analysisResult.value = null

  try {
    await postSse(`/api/positions/${route.params.id}/analyze`, {}, {
      chunk: (data) => { streamText.value += data.text },
      done: async (data) => {
        analysisResult.value = data.analysis
        if (data.updated) {
          await loadData()
        }
      },
      error: (data) => {
        analyzeError.value = data.message ?? "分析失败"
      },
    })
  } catch (e) {
    analyzeError.value = e instanceof Error ? e.message : "分析失败"
  } finally {
    analyzing.value = false
  }
}

/** 流式面板只显示模型的自然语言部分，JSON 块不展示给用户 */
function stripJsonBlock(text: string) {
  const jsonStart = text.indexOf("```json")
  if (jsonStart >= 0) return text.slice(0, jsonStart).trim()
  const braceStart = text.indexOf("{")
  if (braceStart >= 0) return text.slice(0, braceStart).trim()
  return text.trim()
}

const streamingDisplay = computed(() => stripJsonBlock(streamText.value))
const evolveDisplay = computed(() => stripJsonBlock(evolveText.value))

async function aiEvolve() {
  evolving.value = true
  evolveText.value = ""
  evolveResult.value = null
  evolveError.value = null

  try {
    await postSse(`/api/positions/${route.params.id}/evolve.stream`, {}, {
      chunk: (data) => { evolveText.value += data.text ?? "" },
      done: async (data) => {
        evolveResult.value = data as EvolveResult
        if (data.applied) {
          await loadData()
        }
      },
      error: (data) => {
        evolveError.value = data.message ?? "演进失败"
      },
    })
  } catch (e) {
    evolveError.value = e instanceof Error ? e.message : "演进失败"
  } finally {
    evolving.value = false
  }
}

const statusColor = (skillId: number) => {
  const s = userSkillMap.value.get(skillId)
  return s === "mastered" ? "success" : s === "learning" ? "warning" : "neutral"
}

const statusLabel = (skillId: number) => {
  const s = userSkillMap.value.get(skillId)
  return s === "mastered" ? "已掌握" : s === "learning" ? "学习中" : "未开始"
}
</script>

<template>
  <UContainer class="py-10">
    <div class="mb-8 flex items-center justify-between">
      <div>
        <UButton to="/positions" variant="ghost" icon="i-lucide-arrow-left" label="返回" class="mb-2" />
        <h1 class="text-2xl font-semibold tracking-tight">{{ position?.name }}</h1>
        <p class="mt-1 text-sm text-muted">{{ position?.description }}</p>
      </div>
      <div v-if="!loading && skills.length > 0" class="flex items-center gap-2">
        <UButton
          icon="i-lucide-sparkles"
          color="primary"
          variant="soft"
          :loading="analyzing"
          :disabled="evolving"
          label="AI 分析"
          @click="aiAnalyze"
        />
        <UButton
          icon="i-lucide-git-branch-plus"
          color="primary"
          :loading="evolving"
          :disabled="analyzing"
          label="AI 演进图谱"
          @click="aiEvolve"
        />
      </div>
    </div>

    <div v-if="loading" class="py-20 text-center text-muted">加载中…</div>

    <template v-else>
      <!-- AI 流式分析中 -->
      <div v-if="analyzing" class="mb-6 rounded-xl border border-primary/30 bg-primary/5 p-5">
        <div class="mb-3 flex items-center gap-2">
          <div class="size-2 animate-pulse rounded-full bg-primary" />
          <span class="text-sm font-medium">大模型正在分析技能掌握情况…</span>
        </div>
        <div v-if="streamingDisplay" class="whitespace-pre-wrap text-sm leading-relaxed text-muted">
          {{ streamingDisplay }}<span class="animate-pulse text-primary">▌</span>
        </div>
      </div>

      <!-- 分析失败：以前是被 catch{} 静默吞掉的，现在至少让用户知道原因 -->
      <UAlert
        v-if="analyzeError && !analyzing"
        color="error"
        variant="soft"
        title="AI 分析失败"
        :description="analyzeError"
        class="mb-6"
      />

      <!-- AI 分析结果 -->
      <div v-if="analysisResult && !analyzing" class="mb-6 rounded-xl border border-default p-5">
        <div class="mb-3 flex items-center gap-2">
          <UIcon name="i-lucide-sparkles" class="text-primary" />
          <span class="font-medium">AI 分析结果</span>
        </div>
        <p class="text-sm text-muted">{{ analysisResult.summary }}</p>
        <div v-if="analysisResult.recommendations.length > 0" class="mt-4 space-y-2">
          <div
            v-for="rec in analysisResult.recommendations"
            :key="rec.skillName"
            class="flex items-start gap-2 text-sm"
          >
            <UBadge
              :color="rec.status === 'mastered' ? 'success' : rec.status === 'learning' ? 'warning' : 'neutral'"
              variant="soft"
              size="sm"
            >
              {{ rec.skillName }}
            </UBadge>
            <span class="text-muted">{{ rec.reason }}</span>
          </div>
        </div>
      </div>

      <!-- 图谱演进：流式 -->
      <div v-if="evolving" class="mb-6 rounded-xl border border-primary/30 bg-primary/5 p-5">
        <div class="mb-3 flex items-center gap-2">
          <div class="size-2 animate-pulse rounded-full bg-primary" />
          <span class="text-sm font-medium">大模型正在演进技能图谱…</span>
        </div>
        <div v-if="evolveDisplay" class="whitespace-pre-wrap text-sm leading-relaxed text-muted">
          {{ evolveDisplay }}<span class="animate-pulse text-primary">▌</span>
        </div>
        <div v-else class="space-y-2">
          <USkeleton class="h-4 w-3/4" />
          <USkeleton class="h-4 w-1/2" />
        </div>
      </div>

      <UAlert
        v-if="evolveError && !evolving"
        color="error"
        variant="soft"
        title="图谱演进失败"
        :description="evolveError"
        class="mb-6"
      />

      <!-- 演进结果 -->
      <div v-if="evolveResult && !evolving" class="mb-6 rounded-xl border border-default p-5">
        <div class="mb-3 flex items-center gap-2">
          <UIcon name="i-lucide-git-branch-plus" class="text-primary" />
          <span class="font-medium">图谱演进结果</span>
          <UBadge :color="evolveResult.applied ? 'success' : 'neutral'" variant="soft" size="sm">
            {{ evolveResult.applied ? "已应用到图谱" : "未改动" }}
          </UBadge>
        </div>
        <p v-if="evolveResult.summary" class="text-sm text-muted">{{ evolveResult.summary }}</p>

        <div v-if="evolveResult.added.length > 0" class="mt-4">
          <p class="mb-2 text-xs text-muted">新增 {{ evolveResult.added.length }} 个节点</p>
          <div class="flex flex-wrap gap-2">
            <UBadge v-for="item in evolveResult.added" :key="item.skillId" color="success" variant="soft" size="sm">
              + {{ item.name }}
            </UBadge>
          </div>
        </div>

        <div v-if="evolveResult.releveled.length > 0" class="mt-4">
          <p class="mb-2 text-xs text-muted">调整 {{ evolveResult.releveled.length }} 个节点的要求等级</p>
          <div class="flex flex-wrap gap-2">
            <UBadge v-for="item in evolveResult.releveled" :key="item.skillId" color="warning" variant="soft" size="sm">
              {{ item.name }} → L{{ item.requiredLevel }}
            </UBadge>
          </div>
        </div>

        <div v-if="evolveResult.pruned.length > 0" class="mt-4">
          <p class="mb-2 text-xs text-muted">移除 {{ evolveResult.pruned.length }} 个无关节点</p>
          <div class="flex flex-wrap gap-2">
            <UBadge v-for="item in evolveResult.pruned" :key="item.skillId" color="error" variant="soft" size="sm">
              − {{ item.name }}
            </UBadge>
          </div>
        </div>

        <p v-if="evolveResult.reordered > 0" class="mt-4 text-xs text-muted">
          已按模型建议重排 {{ evolveResult.reordered }} 个节点的学习顺序
        </p>

        <p
          v-if="evolveResult.applied && evolveResult.added.length + evolveResult.releveled.length + evolveResult.pruned.length + evolveResult.reordered === 0"
          class="mt-3 text-sm text-muted"
        >
          模型认为当前图谱已经合理，没有提出改动。
        </p>
      </div>

      <!-- 技能列表 -->
      <div class="space-y-3">
        <UCard v-for="skill in skills" :key="skill.id">
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-3">
              <div class="flex size-8 items-center justify-center rounded-lg" :class="skill.level === 0 ? 'bg-primary-100' : 'bg-elevated'">
                <UIcon :name="skill.level === 0 ? 'i-lucide-folder' : 'i-lucide-file'" />
              </div>
              <div>
                <h3 class="font-medium" :class="skill.level > 0 ? 'pl-4' : ''">{{ skill.name }}</h3>
                <p class="text-xs text-muted">{{ skill.description }}</p>
              </div>
            </div>
            <div class="flex items-center gap-2">
              <UBadge :color="statusColor(skill.id)" variant="soft" size="sm">
                {{ statusLabel(skill.id) }}
              </UBadge>
              <UButton
                v-if="userSkillMap.get(skill.id) !== 'mastered'"
                size="xs"
                color="success"
                variant="soft"
                label="掌握"
                :loading="updating === skill.id"
                @click="toggleSkill(skill, 'mastered')"
              />
              <UButton
                v-if="userSkillMap.get(skill.id) === 'mastered'"
                size="xs"
                color="neutral"
                variant="soft"
                label="取消"
                :loading="updating === skill.id"
                @click="toggleSkill(skill, 'not_started')"
              />
            </div>
          </div>
        </UCard>
      </div>
    </template>
  </UContainer>
</template>
