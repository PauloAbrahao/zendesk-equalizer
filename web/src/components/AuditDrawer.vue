<script setup lang="ts">
import { computed } from 'vue'
import { pdfItems, type Audit } from '../auditPdf.ts'

const props = defineProps<{ audit: Audit; labels: Record<string, string>; open: boolean }>()
const emit = defineEmits<{ 'update:open': [open: boolean] }>()

const failed = computed(() => props.audit.items.filter(i => !i.ok).length)
const when = computed(() => new Date(props.audit.appliedAt).toLocaleString('pt-BR'))
const printItems = computed(() => pdfItems(props.audit.items))
const fileName = computed(() => `equalizer_${props.audit.source}_para_${props.audit.target}_${props.audit.appliedAt.replace(/[:.]/g, '-')}`)

function download() {
  const blob = new Blob([JSON.stringify(props.audit, null, 2)], { type: 'application/json' })
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `${fileName.value}.json` })
  a.click()
  URL.revokeObjectURL(a.href)
}

// ponytail: PDF pelo "Salvar como PDF" do navegador; lib de PDF só se precisar gerar sem diálogo
function pdf() {
  const title = document.title
  document.title = fileName.value
  window.print()
  document.title = title
}
</script>

<template>
  <aside v-if="open" class="audit" aria-label="Auditoria da aplicação">
    <header class="audit-head">
      <div>
        <h2>Aplicação concluída</h2>
        <p class="muted"><code>{{ audit.source }}</code> → <code>{{ audit.target }}</code> em {{ when }}</p>
      </div>
      <button class="close" aria-label="Recolher painel" @click="emit('update:open', false)">✕</button>
    </header>

    <p class="audit-sum">
      <span class="counter ok">{{ audit.items.length - failed }}</span> aplicados
      <span class="counter fail" :class="{ zero: !failed }">{{ failed }}</span> com erro
    </p>

    <ul class="audit-list">
      <li v-for="i in audit.items" :key="i.type + i.title" :class="i.ok ? 'ok' : 'fail'">
        <span class="mark" aria-hidden="true">{{ i.ok ? '✔' : '✖' }}</span>
        <div>
          <span class="muted">{{ labels[i.type] ?? i.type }}</span>
          <div class="name">{{ i.title }}</div>
          <small v-if="i.requiredBy" class="muted">dependência de {{ i.requiredBy.join(', ') }}</small>
          <small v-if="!i.ok" class="error">{{ i.error }}</small>
        </div>
        <span v-if="i.ok" :class="['label', i.action === 'criado' ? 'novo' : 'alterado']">{{ i.action }}</span>
      </li>
    </ul>

    <footer class="audit-foot">
      <button class="btn" @click="download">Baixar JSON</button>
      <button class="btn" @click="pdf">Salvar PDF</button>
    </footer>
  </aside>

  <button v-else class="audit-tab" @click="emit('update:open', true)">
    Auditoria <span class="counter">{{ audit.items.length }}</span>
  </button>

  <div class="audit-print">
    <h1>Equalizer — {{ audit.source }} → {{ audit.target }}</h1>
    <p>{{ when }} · {{ audit.items.length - failed }} aplicados, {{ failed }} com erro · só as linhas alteradas; valores completos no JSON</p>

    <section v-for="i in printItems" :key="i.type + i.title" :class="{ fail: !i.ok }">
      <table>
        <colgroup><col style="width: 18%" /><col /><col /></colgroup>
        <thead>
          <tr class="item">
            <th colspan="3">
              <span>{{ labels[i.type] ?? i.type }}</span> <b>{{ i.title }}</b>
              <span class="envs">origem <code>{{ audit.source }}</code> → destino <code>{{ audit.target }}</code></span>
              <span class="status">{{ i.status }}</span>
            </th>
          </tr>
          <tr><th>Campo</th><th>Antes (destino)</th><th>Depois (origem)</th></tr>
        </thead>
        <tbody>
          <tr v-for="f in i.fields" :key="f.field">
            <td><code>{{ f.field }}</code></td>
            <td class="del"><div v-for="(l, n) in f.removed" :key="n">{{ l }}</div></td>
            <td class="add"><div v-for="(l, n) in f.added" :key="n">{{ l }}</div></td>
          </tr>
        </tbody>
      </table>
    </section>
  </div>
</template>

<style scoped>
.audit { position: fixed; top: 0; right: 0; bottom: 0; z-index: 20; width: min(400px, 100vw); display: flex; flex-direction: column; background: var(--surface); border-left: 1px solid var(--border); box-shadow: -16px 0 32px rgb(1 4 9 / 0.5); }
.audit-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; padding: 16px; border-bottom: 1px solid var(--border-muted); }
.audit-head h2 { font-size: 16px; }
.audit-head p { margin: 4px 0 0; font-size: 12px; }
.close { border: 0; background: none; color: var(--muted); padding: 4px 8px; border-radius: 6px; cursor: pointer; }
.close:hover { background: var(--overlay); color: var(--fg); }
.audit-sum { display: flex; align-items: center; gap: 6px; margin: 0; padding: 12px 16px; border-bottom: 1px solid var(--border-muted); }
.audit-sum .fail { margin-left: 10px; }
.counter.ok { background: rgb(46 160 67 / 0.25); color: var(--success); }
.counter.fail:not(.zero) { background: rgb(248 81 73 / 0.2); color: var(--danger); }
.audit-list { flex: 1; overflow: auto; list-style: none; margin: 0; padding: 0; }
.audit-list li { display: grid; grid-template-columns: 16px 1fr auto; gap: 8px; align-items: start; padding: 10px 16px; border-bottom: 1px solid var(--border-muted); font-size: 13px; }
.audit-list .muted { font-size: 12px; }
.name { font-weight: 600; overflow-wrap: anywhere; }
.ok .mark { color: var(--success); }
.fail .mark { color: var(--danger); }
.audit-foot { display: flex; gap: 8px; padding: 12px 16px; border-top: 1px solid var(--border); }
.audit-foot .btn { flex: 1; justify-content: center; }
/* topo direito, sobre o espaço vazio do appheader */
.audit-tab { position: fixed; right: 32px; top: 12px; z-index: 20; display: flex; align-items: center; gap: 8px; padding: 5px 14px; font: 600 13px var(--sans); color: #fff; background: #8957e5; border: 1px solid rgb(240 246 252 / 0.1); border-radius: 6px; cursor: pointer; }
.audit-tab:hover { background: #9a6ff0; }
.audit-tab .counter { background: rgb(255 255 255 / 0.2); color: #fff; }
</style>

<style>
/* PDF: imprime só a tabela de campos alterados, em paisagem e cores claras */
.audit-print { display: none; }
@media print {
  @page { size: landscape; margin: 12mm; }
  #app > :not(.audit-print) { display: none !important; }
  body { background: #fff; color: #1f2328; }
  .audit-print { display: block; color: #1f2328; font: 11px/1.4 var(--sans, sans-serif); }
  .audit-print h1 { font-size: 16px; margin: 0; }
  .audit-print > p { margin: 2px 0 12px; color: #59636e; }
  /* um item nunca se divide entre páginas; o corte em auditPdf.ts garante que cabe em uma */
  .audit-print section { break-inside: avoid; margin-bottom: 12px; }
  .audit-print table { width: 100%; table-layout: fixed; border-collapse: collapse; }
  .audit-print th, .audit-print td { border: 1px solid #d1d9e0; padding: 4px 8px; text-align: left; vertical-align: top; overflow-wrap: anywhere; }
  .audit-print th { background: #f6f8fa; font-weight: 600; }
  .audit-print .item th { background: #eaeef2; font-weight: 400; }
  .audit-print .item b { font-size: 12px; margin: 0 8px; }
  .audit-print .envs { color: #59636e; }
  .audit-print .status { float: right; font-weight: 600; color: #1a7f37; }
  .audit-print .fail .status { color: #d1242f; }
  .audit-print td div { font: 10px/1.5 var(--mono, monospace); }
  .audit-print .del { background: #ffebe9; }
  .audit-print .add { background: #dafbe1; }
}
</style>
