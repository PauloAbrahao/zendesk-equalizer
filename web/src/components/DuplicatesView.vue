<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { api } from '../api.ts'
import type { Duplicate, Usage } from '../../../server/diff.ts'
import type { Type } from '../../../server/zendesk.ts'

const props = defineProps<{ envs: { name: string; isProduction: boolean }[]; labels: Record<Type, string> }>()

const env = ref('')
const types = ref(Object.keys(props.labels) as Type[])
const result = ref<Duplicate[] | null>(null)
const collapsed = ref(new Set<string>())
const loading = ref(false)
const error = ref('')

const groups = computed(() =>
  types.value
    .map(t => ({ type: t, dups: (result.value ?? []).filter(d => d.type === t) }))
    .filter(g => g.dups.length),
)

async function check() {
  loading.value = true
  error.value = ''
  try {
    result.value = await api('/api/duplicates', { env: env.value, types: types.value })
    collapsed.value = new Set(types.value)
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    loading.value = false
  }
}

const toggle = (t: string) => {
  const s = new Set(collapsed.value)
  s.has(t) ? s.delete(t) : s.add(t)
  collapsed.value = s
}
const byType = (list: Usage[]) => {
  const m: Partial<Record<Type, Usage[]>> = {}
  for (const u of list) (m[u.type] ??= []).push(u)
  return m
}
const date = (s?: string) => (s ? new Date(s).toLocaleDateString('pt-BR') : '')

watch(env, () => (result.value = null))
</script>

<template>
  <main>
    <div class="pagehead">
      <h1>Verificar duplicados</h1>
      <p class="muted">Itens com o mesmo nome dentro de um ambiente (ignora maiúsculas, acentos, espaços e pontuação). Duplicados impedem o vínculo automático ao equalizar.</p>
    </div>

    <section class="box compare">
      <div class="range">
        <label class="branch">
          <span class="muted">ambiente:</span>
          <select v-model="env">
            <option value="" disabled>escolha</option>
            <option v-for="e in envs" :key="e.name" :value="e.name">{{ e.name }}{{ e.isProduction ? ' (produção)' : '' }}</option>
          </select>
        </label>
      </div>
      <div class="scope">
        <fieldset>
          <legend class="sr-only">O que verificar</legend>
          <label v-for="(label, t) in labels" :key="t" class="toggle-btn">
            <input type="checkbox" :value="t" v-model="types" />
            <span>{{ label }}</span>
          </label>
        </fieldset>
        <button class="btn primary" :disabled="!env || !types.length || loading" :aria-busy="loading" @click="check">
          <span v-if="loading" class="spinner" aria-hidden="true"></span>
          <span class="label-text">Verificar</span>
        </button>
      </div>
    </section>

    <p v-if="error" class="flash-error" role="alert">{{ error }}</p>

    <p v-if="result && !groups.length" class="box box-row muted">Nenhum nome repetido em <code>{{ env }}</code>.</p>

    <section v-for="g in groups" :key="g.type" :class="['box', 'group', { collapsed: collapsed.has(g.type) }]">
      <h2 class="box-header">
        <button class="group-toggle" :aria-expanded="!collapsed.has(g.type)" @click="toggle(g.type)">
          <svg class="caret" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M6.22 3.22a.75.75 0 0 1 1.06 0l4.25 4.25a.75.75 0 0 1 0 1.06l-4.25 4.25a.751.751 0 0 1-1.042-.018.751.751 0 0 1-.018-1.042L9.94 8 6.22 4.28a.75.75 0 0 1 0-1.06Z"/></svg>
          {{ labels[g.type] }}
          <span class="counter">{{ g.dups.length }}</span>
        </button>
      </h2>
      <template v-if="!collapsed.has(g.type)">
        <div v-for="d in g.dups" :key="d.items[0]!.id" class="box-row dup">
          <b>{{ d.items[0]!.title }}</b> <span class="muted">· {{ d.items.length }} itens</span>
          <ul>
            <li v-for="i in d.items" :key="i.id">
              <div class="head">
                <span>{{ i.title }} - {{ i.id }}</span>
                <span v-if="!i.usedBy.length" class="label" title="Nenhum formulário, gatilho ou automação referencia este item">sem uso</span>
                <span v-if="!i.active" class="label">inativo</span>
                <span v-if="i.updated_at" class="muted">atualizado em {{ date(i.updated_at) }}</span>
              </div>
              <dl v-if="i.usedBy.length" class="uses">
                <template v-for="(list, t) in byType(i.usedBy)" :key="t">
                  <dt>{{ labels[t] }}</dt>
                  <dd>{{ list!.map(u => `${u.title} - ${u.id}`).join(', ') }}</dd>
                </template>
              </dl>
            </li>
          </ul>
        </div>
      </template>
    </section>
  </main>
</template>

<style scoped>
.dup ul { list-style: none; margin: 6px 0 0; padding: 0 0 0 16px; }
.dup li { padding: 4px 0; }
.dup .head { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; font-family: var(--mono); font-size: 13px; }
.dup .head .muted { font-family: var(--sans); font-size: 12px; }
.uses { display: grid; grid-template-columns: max-content 1fr; gap: 2px 12px; margin: 4px 0 0 16px; font-size: 12px; }
.uses dt { color: var(--muted); }
.uses dd { margin: 0; overflow-wrap: anywhere; }
</style>
