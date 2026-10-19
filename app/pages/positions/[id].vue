<script setup lang="ts">
definePageMeta({ layout: 'learning' })

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
    </div>

    <div v-if="loading" class="py-20 text-center text-muted">加载中…</div>

    <div v-else class="space-y-3">
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
  </UContainer>
</template>
