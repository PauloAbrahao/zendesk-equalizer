<script setup>
import { ref, computed, watch, onMounted } from 'vue'
import DiffView from './components/DiffView.vue'
import ConfirmModal from './components/ConfirmModal.vue'
import AuditDrawer from './components/AuditDrawer.vue'

const TYPES = { groups: 'Grupos', ticket_fields: 'Campos de ticket', ticket_forms: 'Formulários', triggers: 'Gatilhos', automations: 'Automações' }
const STATUS = { novo: 'Novo', alterado: 'Alterado', igual: 'Igual', so_no_destino: 'Só no destino', bloqueado: 'Bloqueado' }
const APPLICABLE = ['novo', 'alterado']

const envs = ref([])
const source = ref('')
const target = ref('')
const types = ref(Object.keys(TYPES))
const items = ref([])
const selected = ref(new Set())
const open = ref(new Set())
const collapsed = ref(new Set())
const loading = ref(false)
const applying = ref(false)
const error = ref('')
const audit = ref(null)
const drawerOpen = ref(false)
const modal = ref(false)

const key = i => `${i.type}:${i.title}`
const isProd = computed(() => envs.value.find(e => e.name === target.value)?.isProduction)
const canCompare = computed(() => source.value && target.value && source.value !== target.value && types.value.length)
// trocar os tipos marcados só filtra a comparação já feita; itens de tipos desmarcados não entram no aplicar
const visible = computed(() => items.value.filter(i => types.value.includes(i.type)))
const chosen = computed(() => visible.value.filter(i => selected.value.has(key(i))))
const groups = computed(() =>
  types.value
    .map(t => ({ type: t, items: visible.value.filter(i => i.type === t && i.status !== 'igual') }))
    .filter(g => visible.value.some(i => i.type === g.type)),
)
const applicable = computed(() => visible.value.filter(i => APPLICABLE.includes(i.status)).map(key))
const allSelected = computed(() => applicable.value.length > 0 && applicable.value.every(k => selected.value.has(k)))
const selectAll = on => {
  const s = new Set(selected.value)
  applicable.value.forEach(k => (on ? s.add(k) : s.delete(k)))
  selected.value = s
}
const summary = computed(() => Object.fromEntries(Object.keys(STATUS).map(s => [s, visible.value.filter(i => i.status === s).length])))

async function api(path, body) {
  const r = await fetch(path, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : undefined)
  // corpo vazio/HTML = backend fora do ar ou caiu no meio da requisição (proxy do vite devolve 500 sem corpo)
  const text = await r.text()
  let d
  try {
    d = JSON.parse(text)
  } catch {
    throw new Error(`${r.status} ${r.statusText}: backend não respondeu JSON${text ? ` (${text.slice(0, 200)})` : ' (resposta vazia — o servidor está rodando?)'}`)
  }
  if (!r.ok) throw new Error(d.error)
  return d
}

async function run(fn) {
  loading.value = true
  error.value = ''
  try {
    await fn()
  } catch (e) {
    error.value = e.message
  } finally {
    loading.value = false
  }
}

const fetchItems = async () => {
  items.value = await api('/api/compare', { source: source.value, target: target.value, types: types.value })
  return new Set(items.value.filter(i => APPLICABLE.includes(i.status)).map(key))
}

const compare = () =>
  run(async () => {
    selected.value = await fetchItems()
    open.value = new Set()
  })

const apply = confirm =>
  run(async () => {
    modal.value = false
    const snapshot = chosen.value.map(i => ({ type: i.type, title: i.title, status: i.status, before: i.target, after: i.source }))
    const payload = snapshot.map(({ type, title }) => ({ type, title }))
    applying.value = true
    try {
      const res = await api('/api/apply', { source: source.value, target: target.value, items: payload, confirm })
      audit.value = {
        appliedAt: new Date().toISOString(),
        source: source.value,
        target: target.value,
        items: res.map(r => ({ ...snapshot.find(i => i.type === r.type && i.title === r.title), ...r })),
      }
      drawerOpen.value = true
      // atualiza só os diffs: seleção e itens abertos ficam como estavam (menos o que deixou de ser aplicável)
      const still = await fetchItems()
      selected.value = new Set([...selected.value].filter(k => still.has(k)))
    } finally {
      applying.value = false
    }
  })

const toggle = (set, k) => (set.has(k) ? set.delete(k) : set.add(k))

// trocar de ambiente invalida a comparação anterior
watch([source, target], () => {
  items.value = []
})

onMounted(() => run(async () => (envs.value = await api('/api/environments'))))
</script>


<template>
  <header class="appheader">
    <svg class="logo" viewBox="0 0 16 16" width="24" height="24" aria-hidden="true">
      <path fill="currentColor" d="M2 3h2v10H2zM7 6h2v7H7zM12 1h2v12h-2zM1 14h14v1H1z" />
    </svg>
    <span class="appname">Zendesk Equalizer</span>
  </header>

  <div v-if="isProd" class="flash-prod" role="alert">
    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M6.457 1.047c.659-1.234 2.427-1.234 3.086 0l6.082 11.378A1.75 1.75 0 0 1 14.082 15H1.918a1.75 1.75 0 0 1-1.543-2.575ZM8 5a.75.75 0 0 0-.75.75v2.5a.75.75 0 0 0 1.5 0v-2.5A.75.75 0 0 0 8 5Zm1 6a1 1 0 1 0-2 0 1 1 0 0 0 2 0Z"/></svg>
    O destino é <b>produção</b> (<code>{{ target }}</code>). Toda alteração afeta o atendimento real.
  </div>

  <main :class="{ 'with-drawer': audit && drawerOpen }">
    <div class="pagehead">
      <h1>Comparar ambientes</h1>
      <p class="muted">Escolha a origem e o destino, revise as diferenças e aplique só o que quiser.</p>
    </div>

    <section class="box compare" :class="{ prod: isProd }">
      <div class="range">
        <label class="branch">
          <span class="muted">origem:</span>
          <select v-model="source">
            <option value="" disabled>escolha</option>
            <option v-for="e in envs" :key="e.name" :value="e.name">{{ e.name }}</option>
          </select>
        </label>
        <svg class="range-arrow" :class="{ busy: loading }" viewBox="0 0 16 16" width="16" height="16" aria-label="para">
          <path fill="currentColor" d="M8.22 2.97a.75.75 0 0 1 1.06 0l4.25 4.25a.75.75 0 0 1 0 1.06l-4.25 4.25a.749.749 0 0 1-1.275-.326.749.749 0 0 1 .215-.734l2.97-2.97H2.75a.75.75 0 0 1 0-1.5h8.44L8.22 4.03a.75.75 0 0 1 0-1.06Z"/>
        </svg>
        <label class="branch target">
          <span class="muted">destino:</span>
          <select v-model="target">
            <option value="" disabled>escolha</option>
            <option v-for="e in envs" :key="e.name" :value="e.name" :disabled="e.name === source">
              {{ e.name }}{{ e.isProduction ? ' (produção)' : '' }}
            </option>
          </select>
        </label>
      </div>
      <div class="scope">
        <fieldset>
          <legend class="sr-only">O que comparar</legend>
          <label v-for="(label, t) in TYPES" :key="t" class="toggle-btn">
            <input type="checkbox" :value="t" v-model="types" />
            <span>{{ label }}</span>
          </label>
        </fieldset>
        <button class="btn primary" :disabled="!canCompare || loading" @click="compare">
          {{ loading ? 'Comparando…' : 'Comparar' }}
        </button>
      </div>
    </section>

    <p v-if="error" class="flash-error" role="alert">{{ error }}</p>


    <template v-if="visible.length">
      <div class="toolbar">
        <ul class="tally">
          <li v-for="(n, s) in summary" :key="s" :class="[s, { zero: !n }]"><span class="counter">{{ n }}</span> {{ STATUS[s] }}</li>
        </ul>
        <label class="check">
          <input
            type="checkbox"
            :checked="allSelected"
            :disabled="!applicable.length"
            @change="selectAll($event.target.checked)"
          />
          {{ allSelected ? 'Desmarcar todos' : 'Marcar todos' }}
        </label>
      </div>

      <section v-for="g in groups" :key="g.type" :class="['box', 'group', { collapsed: collapsed.has(g.type) }]">
        <h2 class="box-header">
          <button class="group-toggle" :aria-expanded="!collapsed.has(g.type)" @click="toggle(collapsed, g.type)">
            <svg class="caret" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M6.22 3.22a.75.75 0 0 1 1.06 0l4.25 4.25a.75.75 0 0 1 0 1.06l-4.25 4.25a.751.751 0 0 1-1.042-.018.751.751 0 0 1-.018-1.042L9.94 8 6.22 4.28a.75.75 0 0 1 0-1.06Z"/></svg>
            {{ TYPES[g.type] }}
            <span class="counter">{{ g.items.length }}</span>
          </button>
        </h2>
        <template v-if="!collapsed.has(g.type)">
        <p v-if="!g.items.length" class="box-row muted">Nenhuma diferença entre os ambientes.</p>
        <div v-for="i in g.items" :key="key(i)" :class="['box-row', 'item', { open: open.has(key(i)) }]">
          <div class="item-row">
            <button class="title" :aria-expanded="open.has(key(i))" @click="toggle(open, key(i))">
              <svg class="caret" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M6.22 3.22a.75.75 0 0 1 1.06 0l4.25 4.25a.75.75 0 0 1 0 1.06l-4.25 4.25a.751.751 0 0 1-1.042-.018.751.751 0 0 1-.018-1.042L9.94 8 6.22 4.28a.75.75 0 0 1 0-1.06Z"/></svg>
              <span>{{ i.title }}</span>
            </button>
            <span :class="['label', i.status]">{{ STATUS[i.status] }}</span>
            <label class="include" :class="{ on: selected.has(key(i)) }">
              <input
                type="checkbox"
                :disabled="!APPLICABLE.includes(i.status)"
                :checked="selected.has(key(i))"
                @change="toggle(selected, key(i))"
              />
              Incluir
            </label>
          </div>
          <small v-if="i.missing.length" class="note warn">Requer migrar também: {{ i.missing.join(', ') }}</small>
          <small v-for="b in i.blocked" :key="b" class="note error">{{ b }}</small>
          <DiffView v-if="open.has(key(i))" :before="i.target" :after="i.source" />
        </div>
        </template>
      </section>

      <div class="actionbar">
        <span class="muted">
          {{ chosen.length }} {{ chosen.length === 1 ? 'item selecionado' : 'itens selecionados' }}
        </span>
        <button class="btn" :class="isProd ? 'danger' : 'primary'" :disabled="!chosen.length || loading" :aria-busy="applying" @click="modal = true">
          <span v-if="applying" class="spinner" aria-hidden="true"></span>
          {{ applying ? `Aplicando em ${target}…` : `Aplicar em ${target}` }}
        </button>
      </div>
    </template>
  </main>

  <ConfirmModal
    v-if="modal"
    :items="chosen"
    :source="source"
    :target="target"
    :is-prod="isProd"
    :labels="TYPES"
    @cancel="modal = false"
    @confirm="apply"
  />

  <AuditDrawer v-if="audit" v-model:open="drawerOpen" :audit="audit" :labels="TYPES" />
</template>

<style>
:root {
  --canvas: #0d1117; --inset: #010409; --surface: #151b23; --overlay: #212830;
  --fg: #f0f6fc; --muted: #9198a1; --border: #3d444d; --border-muted: #2f353d;
  --accent: #4493f8; --btn-primary: #238636; --btn-primary-hover: #29903b;
  --success: #3fb950; --attention: #d29922; --danger: #f85149; --danger-emphasis: #da3633;
  --add-bg: rgb(46 160 67 / 0.15); --add-sign: rgb(63 185 80 / 0.3);
  --del-bg: rgb(248 81 73 / 0.1); --del-sign: rgb(248 81 73 / 0.25);
  --sans: -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans", Helvetica, Arial, sans-serif;
  --mono: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
  color-scheme: dark;
}
* { box-sizing: border-box; }
html { scrollbar-gutter: stable; }
body { margin: 0; background: var(--canvas); color: var(--fg); font: 14px/1.5 var(--sans); }
main { max-width: 1012px; margin: 0 auto; padding: 24px 16px 0; }
h1 { font-size: 24px; font-weight: 600; margin: 0 0 4px; }
h2 { font-size: 14px; font-weight: 600; margin: 0; }
code { font: 12px var(--mono); padding: 2px 6px; border-radius: 6px; background: rgb(101 108 118 / 0.2); }
.muted { color: var(--muted); }
.warn { color: var(--attention); }
.error { color: var(--danger); }
.sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
input[type=checkbox] { accent-color: var(--accent); margin: 0; }

.btn, select { font: 500 14px/20px var(--sans); color: var(--fg); background: var(--overlay); border: 1px solid var(--border); border-radius: 6px; padding: 5px 16px; cursor: pointer; }
.btn:hover:not(:disabled) { background: #262c36; }
.btn:disabled { opacity: 0.5; cursor: not-allowed; }
.btn[aria-busy=true] { opacity: 1; cursor: progress; }
.btn { display: inline-flex; align-items: center; gap: 8px; }
.spinner { width: 14px; height: 14px; border: 2px solid rgb(255 255 255 / 0.35); border-top-color: #fff; border-radius: 50%; animation: spin 0.7s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .spinner { animation-duration: 2s; } }
.btn.primary { background: var(--btn-primary); border-color: rgb(240 246 252 / 0.1); color: #fff; }
.btn.primary:hover:not(:disabled) { background: var(--btn-primary-hover); }
.btn.danger { background: var(--danger-emphasis); border-color: rgb(240 246 252 / 0.1); color: #fff; }
.btn.danger:hover:not(:disabled) { background: #e5534b; }

.appheader { display: flex; align-items: center; gap: 12px; padding: 14px 32px; background: var(--inset); border-bottom: 1px solid var(--border-muted); }
.appname { font-size: 15px; font-weight: 600; }

.flash-prod, .flash-error { display: flex; align-items: center; gap: 8px; padding: 12px 16px; border: 1px solid rgb(248 81 73 / 0.4); background: rgb(248 81 73 / 0.1); }
.flash-prod { position: sticky; top: 0; z-index: 10; justify-content: center; border-width: 0 0 1px; background: #25171c; }
.flash-prod svg { color: var(--danger); flex: none; }
.flash-error { border-radius: 6px; margin: 0 0 16px; }

.pagehead { padding-bottom: 16px; margin-bottom: 16px; border-bottom: 1px solid var(--border-muted); }
.pagehead p { margin: 0; }

.box { border: 1px solid var(--border); border-radius: 6px; margin-bottom: 16px; background: var(--canvas); }
.box-header { display: flex; align-items: center; gap: 8px; padding: 12px 16px; background: var(--surface); border-bottom: 1px solid var(--border); border-radius: 6px 6px 0 0; }
.box-row { padding: 12px 16px; margin: 0; border-top: 1px solid var(--border-muted); }
.box-header + .box-row { border-top: 0; }
.group .box-header { padding: 0; }
.group-toggle { display: flex; align-items: center; gap: 8px; width: 100%; padding: 12px 16px; border: 0; background: none; color: var(--fg); font: 600 14px var(--sans); text-align: left; cursor: pointer; border-radius: inherit; }
.group-toggle:hover { background: var(--overlay); }
.group:not(.collapsed) .group-toggle .caret { transform: rotate(90deg); }
.group.collapsed .box-header { border-bottom: 0; border-radius: 6px; }
.counter { display: inline-block; min-width: 20px; padding: 0 6px; font-size: 12px; font-weight: 500; line-height: 18px; text-align: center; border-radius: 2em; background: rgb(101 108 118 / 0.2); color: var(--fg); }

/* barra de comparação, como base...compare do GitHub */
.compare { background: var(--surface); }
.range { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; padding: 16px; border-bottom: 1px solid var(--border); }
.branch { display: inline-flex; align-items: center; border: 1px solid var(--border); border-radius: 6px; background: var(--overlay); padding-left: 12px; }
.branch select { border: 0; background: transparent; padding-left: 6px; font-family: var(--mono); font-size: 13px; }
.branch select option { background: var(--overlay); }
.compare.prod .branch.target { border-color: var(--danger); box-shadow: 0 0 0 3px rgb(248 81 73 / 0.2); }
.range-arrow { color: var(--muted); }
.range-arrow.busy { color: var(--accent); animation: nudge 0.8s ease-in-out infinite; }
@keyframes nudge { 50% { transform: translateX(3px); } }
@media (prefers-reduced-motion: reduce) { .range-arrow.busy { animation: none; } }
.scope { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 12px; padding: 12px 16px; }
.scope fieldset { display: flex; flex-wrap: wrap; border: 0; margin: 0; padding: 0; }
.toggle-btn { position: relative; }
.toggle-btn input { position: absolute; inset: 0; width: 100%; height: 100%; opacity: 0; cursor: pointer; }
.toggle-btn span { display: block; padding: 5px 12px; font-weight: 500; border: 1px solid var(--border); margin-left: -1px; background: var(--overlay); color: var(--muted); }
.toggle-btn:first-of-type span { border-radius: 6px 0 0 6px; margin-left: 0; }
.toggle-btn:last-of-type span { border-radius: 0 6px 6px 0; }
.toggle-btn input:checked + span { background: #2a313c; color: var(--fg); box-shadow: inset 0 -2px var(--accent); }
.toggle-btn input:focus-visible + span { outline: 2px solid var(--accent); outline-offset: -2px; position: relative; }


.toolbar { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px 16px; margin: 24px 0 12px; }
.tally { display: flex; flex-wrap: wrap; gap: 4px 16px; list-style: none; margin: 0; padding: 0; }
.tally .zero { color: var(--muted); }
.tally .novo .counter { background: rgb(46 160 67 / 0.25); color: var(--success); }
.tally .alterado .counter { background: rgb(187 128 9 / 0.25); color: var(--attention); }
.tally .bloqueado .counter { background: rgb(248 81 73 / 0.2); color: var(--danger); }
.check { display: inline-flex; align-items: center; gap: 6px; cursor: pointer; }

.item { padding: 8px 16px; }
.item.open { background: var(--surface); }
.item-row { display: flex; align-items: center; gap: 12px; }
.title { flex: 1; min-width: 0; display: flex; align-items: center; gap: 6px; padding: 4px 0; border: 0; background: none; color: var(--fg); font: 600 14px var(--sans); text-align: left; cursor: pointer; overflow-wrap: anywhere; }
.title:hover span { color: var(--accent); text-decoration: underline; }
.caret { flex: none; color: var(--muted); transition: transform 0.12s; }
.item.open .caret { transform: rotate(90deg); }
@media (prefers-reduced-motion: reduce) { .caret { transition: none; } }
.note { display: block; margin: 2px 0 0 22px; }
.label { font-size: 12px; font-weight: 500; line-height: 18px; padding: 0 7px; border: 1px solid var(--border); border-radius: 2em; white-space: nowrap; color: var(--muted); }
.label.novo { color: var(--success); border-color: rgb(63 185 80 / 0.5); }
.label.alterado { color: var(--attention); border-color: rgb(210 153 34 / 0.5); }
.label.bloqueado { color: var(--danger); border-color: rgb(248 81 73 / 0.5); }
.include { display: inline-flex; align-items: center; gap: 6px; padding: 2px 8px; font-size: 12px; color: var(--muted); border: 1px solid var(--border); border-radius: 6px; cursor: pointer; }
.include.on { color: var(--fg); background: rgb(56 139 253 / 0.15); border-color: rgb(56 139 253 / 0.4); }
.include:has(input:disabled) { opacity: 0.5; cursor: not-allowed; }

.actionbar { position: sticky; bottom: 0; z-index: 5; display: flex; align-items: center; justify-content: flex-end; gap: 16px; margin: 0 -16px; padding: 12px 16px; background: rgb(13 17 23 / 0.92); backdrop-filter: blur(6px); border-top: 1px solid var(--border); }

@media (min-width: 1200px) { main.with-drawer { margin-right: 400px; } }

@media (max-width: 640px) {
  .appheader { padding: 12px 16px; }
  .range-arrow { transform: rotate(90deg); }
  .range { flex-direction: column; align-items: flex-start; }
  .item-row { flex-wrap: wrap; }
  .title { flex-basis: 100%; }
  .actionbar { justify-content: space-between; }
}
</style>
