<script setup lang="ts">

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

const route = useRoute()
const loading = ref(true)
const position = ref<{ id: number, name: string, category: string, description: string | null } | null>(null)
const skills = ref<Skill[]>([])
const userSkillMap = ref<Map<number, string>>(new Map())
const updating = ref<number | null>(null)

const analyzing = ref(false)
const streamText = ref("")
const analysisResult = ref<{ summary: string, recommendations: { skillName: string, status: string, reason: string }[] } | null>(null)

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

onMounted(loadData)

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
    const response = await fetch(`/api/positions/${route.params.id}/analyze`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    })

    if (!response.ok || !response.body) {
      throw new Error(`请求失败: ${response.status}`)
    }

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ""

    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const blocks = buffer.split("\n\n")
      buffer = blocks.pop() ?? ""

      for (const block of blocks) {
        const eventMatch = block.match(/^event: (.+)$/m)
        const dataMatch = block.match(/^data: (.+)$/m)
        if (!eventMatch || !dataMatch) continue

        const eventType = eventMatch[1]
        const data = JSON.parse(dataMatch[1])

        if (eventType === "chunk") {
          streamText.value += data.text
        } else if (eventType === "done") {
          analysisResult.value = data.analysis
          if (data.updated) {
            await loadData()
          }
        } else if (eventType === "error") {
          throw new Error(data.message)
        }
      }
    }
  } catch {
    // 忽略
  } finally {
    analyzing.value = false
  }
}

const streamingDisplay = computed(() => {
  const text = streamText.value
  const jsonStart = text.indexOf("```json")
  if (jsonStart >= 0) return text.slice(0, jsonStart).trim()
  const braceStart = text.indexOf("{")
  if (braceStart >= 0) return text.slice(0, braceStart).trim()
  return text.trim()
})

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
      <UButton
        v-if="!loading && skills.length > 0"
        icon="i-lucide-sparkles"
        color="primary"
        variant="soft"
        :loading="analyzing"
        label="AI 分析"
        @click="aiAnalyze"
      />
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
