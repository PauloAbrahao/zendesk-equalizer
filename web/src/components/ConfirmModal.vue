<script setup>
import { ref, computed, onMounted } from 'vue'

const props = defineProps({ items: Array, source: String, target: String, isProd: Boolean, labels: Object })
const emit = defineEmits(['confirm', 'cancel'])

const dlg = ref()
const typed = ref('')
const ok = computed(() => !props.isProd || typed.value === props.target)
const count = s => props.items.filter(i => i.status === s).length

onMounted(() => dlg.value.showModal())
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
      <ul class="list">
        <li v-for="i in items" :key="i.type + i.title">
          <span :class="['label', i.status]">{{ i.status === 'novo' ? 'Criar' : 'Substituir' }}</span>
          <span><span class="muted">{{ labels[i.type] }}</span> {{ i.title }}</span>
          <small v-if="i.missing.length" class="warn">Requer: {{ i.missing.join(', ') }}</small>
        </li>
      </ul>
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
.list li { display: flex; flex-wrap: wrap; gap: 4px 10px; align-items: baseline; padding: 8px 12px; border-top: 1px solid var(--border-muted); }
.list li:first-child { border-top: 0; }
.list small { flex-basis: 100%; }
.type-confirm { display: block; margin-top: 16px; }
.type-confirm input { display: block; width: 100%; margin-top: 6px; padding: 5px 12px; font: 14px/20px var(--mono); color: var(--fg); background: var(--canvas); border: 1px solid var(--border); border-radius: 6px; }
.type-confirm input:focus { outline: 2px solid var(--danger); outline-offset: -1px; }
.dlg-foot { display: flex; justify-content: flex-end; gap: 8px; padding: 16px; border-top: 1px solid var(--border-muted); }
</style>
