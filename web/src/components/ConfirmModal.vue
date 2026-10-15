<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import type { CompareItem, Ref, Status } from '../../../server/diff.ts'
import type { Type } from '../../../server/zendesk.ts'

const props = defineProps<{ items: CompareItem[]; source: string; target: string; isProd: boolean; labels: Record<string, string>; order: Type[] }>()
const emit = defineEmits<{ confirm: [typed: string]; cancel: [] }>()

const dlg = ref<HTMLDialogElement>()
const typed = ref('')
const keyOf = (i: { type: string; title: string }) => `${i.type}:${i.title}`
// dependências não selecionadas que o servidor cria antes (requires já é transitivo, vem de server/diff.ts)
const auto = computed(() => {
  const sel = new Set(props.items.map(keyOf))
  const m = new Map<string, Ref & { status: Status; requiredBy: string[] }>()
  for (const i of props.items)
    for (const d of i.requires) {
      if (sel.has(keyOf(d))) continue
      if (!m.has(keyOf(d))) m.set(keyOf(d), { ...d, status: 'novo', requiredBy: [] })
      m.get(keyOf(d))!.requiredBy.push(i.title)
    }
  return [...m.values()]
})
const all = computed<{ type: Type; title: string; status: Status; requiredBy?: string[]; requiresErrors?: string[] }[]>(() => [...props.items, ...auto.value])
// o servidor também barra: dependência que não dá para criar aborta antes de qualquer escrita
const errors = computed(() => props.items.flatMap(i => i.requiresErrors.map(e => `${i.title}: ${e}`)))
const ok = computed(() => !errors.value.length && (!props.isProd || typed.value === props.target))
const count = (s: Status) => all.value.filter(i => i.status === s).length
// order vem do servidor (ORDER em server/zendesk.ts), que é a ordem real de execução
const steps = computed(() =>
  props.order
    .map(type => ({ type, items: all.value.filter(i => i.type === type) }))
    .filter(s => s.items.length),
)

onMounted(() => dlg.value!.showModal())
</script>

<template>
  <dialog ref="dlg" @cancel.prevent="emit('cancel')">
    <header class="dlg-head">
      <h2>Confirmar equalização</h2>
      <button class="close" aria-label="Fechar" @click="emit('cancel')">✕</button>
    </header>
    <div class="dlg-body">
      <p v-if="isProd" class="prod-warning">O destino é <b>produção</b>. As alterações abaixo afetam o atendimento real.</p>
      <p>
        <code>{{ source }}</code> → <code>{{ target }}</code>:
        {{ count('novo') }} item(ns) serão <b>criados</b> e {{ count('alterado') }} serão <b>substituídos</b>.
      </p>
      <p v-if="auto.length">
        {{ auto.length }} dependência(s) não selecionada(s) serão <b>criadas antes</b>, automaticamente. Nada que já existe em <code>{{ target }}</code> é alterado por elas.
      </p>
      <div v-if="errors.length" class="unmet-warning" role="alert">
        Migração bloqueada: há dependências que não podem ser criadas em <code>{{ target }}</code>.
        <ul><li v-for="e in errors" :key="e">{{ e }}</li></ul>
      </div>
      <ol class="list">
        <li v-for="(s, n) in steps" :key="s.type" class="step">
          <h3 class="step-head"><span class="step-num">{{ n + 1 }}</span> {{ labels[s.type] }} <span class="muted">({{ s.items.length }})</span></h3>
          <ul>
            <li v-for="i in s.items" :key="i.type + i.title">
              <span :class="['label', i.status]">{{ i.status === 'novo' ? 'Criar' : 'Substituir' }}</span>
              <span>{{ i.title }}</span>
              <span v-if="i.requiredBy" class="label auto">Dependência</span>
              <small v-if="i.requiredBy" class="muted">Necessário para: {{ i.requiredBy.join(', ') }}</small>
              <small v-for="e in i.requiresErrors" :key="e" class="error">{{ e }}</small>
            </li>
          </ul>
        </li>
      </ol>
      <label v-if="isProd" class="type-confirm">
        Para confirmar, digite <b>{{ target }}</b>:
        <input v-model="typed" autofocus autocomplete="off" spellcheck="false" />
      </label>
    </div>
    <footer class="dlg-foot">
      <button class="btn" @click="emit('cancel')">Cancelar</button>
      <button class="btn" :class="isProd ? 'danger' : 'primary'" :disabled="!ok" @click="emit('confirm', typed)">Aplicar em {{ target }}</button>
    </footer>
  </dialog>
</template>

<style scoped>
dialog { padding: 0; border: 1px solid var(--border); border-radius: 12px; max-width: 640px; width: calc(100% - 32px); background: var(--surface); color: var(--fg); box-shadow: 0 0 0 1px var(--border-muted), 0 24px 48px rgb(1 4 9 / 0.85); }
dialog::backdrop { background: rgb(1 4 9 / 0.7); }
.dlg-head { display: flex; align-items: center; justify-content: space-between; padding: 16px; border-bottom: 1px solid var(--border-muted); }
.close { border: 0; background: none; color: var(--muted); font-size: 14px; padding: 4px 8px; border-radius: 6px; cursor: pointer; }
.close:hover { background: var(--overlay); color: var(--fg); }
.dlg-body { padding: 16px; }
.dlg-body > p { margin: 0 0 12px; }
.prod-warning { padding: 12px 16px; border: 1px solid rgb(248 81 73 / 0.4); border-radius: 6px; background: rgb(248 81 73 / 0.1); }
.list { max-height: 300px; overflow: auto; padding: 0; margin: 0; list-style: none; border: 1px solid var(--border); border-radius: 6px; }
.list ul { padding: 0; margin: 0; list-style: none; }
.list ul li { display: flex; flex-wrap: wrap; gap: 4px 10px; align-items: baseline; padding: 8px 12px 8px 44px; border-top: 1px solid var(--border-muted); }
.list small { flex-basis: 100%; }
.step + .step { border-top: 1px solid var(--border); }
.step-head { display: flex; align-items: center; gap: 8px; margin: 0; padding: 8px 12px; font-size: 14px; font-weight: 600; background: var(--overlay); }
.step-num { display: inline-grid; place-items: center; width: 22px; height: 22px; border-radius: 50%; font-size: 12px; background: var(--accent); color: #fff; }
.list small.error { color: var(--danger); }
.unmet-warning ul { margin: 6px 0 0; padding-left: 20px; }
.label.auto { color: var(--muted); border-color: var(--border); }
.unmet-warning { margin: 0 0 12px; padding: 12px 16px; border: 1px solid rgb(248 81 73 / 0.4); border-radius: 6px; background: rgb(248 81 73 / 0.1); }
.type-confirm { display: block; margin-top: 16px; }
.type-confirm input { display: block; width: 100%; margin-top: 6px; padding: 5px 12px; font: 14px/20px var(--mono); color: var(--fg); background: var(--canvas); border: 1px solid var(--border); border-radius: 6px; }
.type-confirm input:focus { outline: 2px solid var(--danger); outline-offset: -1px; }
.dlg-foot { display: flex; justify-content: flex-end; gap: 8px; padding: 16px; border-top: 1px solid var(--border-muted); }
</style>
