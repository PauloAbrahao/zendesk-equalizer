<script setup lang="ts">
import { computed } from 'vue'
import { diffLines } from 'diff'
import type { Obj } from '../../../server/zendesk.ts'

// before = destino atual, after = como ficará (origem já remapeada)
const props = defineProps<{ before: Obj | null; after: Obj | null }>()

const fmt = (o: Obj | null) => (o ? JSON.stringify(o, null, 2) + '\n' : '')
const split = (s: string) => s.split('\n').slice(0, -1)

// ponytail: mostra o JSON inteiro; colapsar contexto inalterado se os objetos ficarem grandes demais
const lines = computed(() => {
  if (!props.after) return split(fmt(props.before)).map(text => ({ text, kind: ' ' }))
  return diffLines(fmt(props.before), fmt(props.after)).flatMap(p =>
    split(p.value).map(text => ({ text, kind: p.added ? '+' : p.removed ? '-' : ' ' })),
  )
})
</script>

<template>
  <div class="diff">
    <div class="diff-head">
      <span class="del">− destino atual</span>
      <span class="add">+ após aplicar</span>
    </div>
    <pre><div v-for="(l, i) in lines" :key="i" :class="{ add: l.kind === '+', del: l.kind === '-' }"><span class="sign">{{ l.kind }}</span>{{ l.text }}</div></pre>
  </div>
</template>

<style scoped>
.diff { border: 1px solid var(--border); border-radius: 6px; overflow: hidden; margin: 8px 0; background: var(--canvas); }
.diff-head { display: flex; gap: 16px; padding: 8px 16px; background: var(--surface); font-size: 12px; border-bottom: 1px solid var(--border); }
pre { margin: 0; font: 12px/20px var(--mono); max-height: 480px; overflow: auto; color: var(--fg); }
pre div { padding-right: 16px; white-space: pre; }
.sign { display: inline-block; width: 28px; text-align: center; margin-right: 8px; user-select: none; color: var(--muted); }
pre .add { background: var(--add-bg); }
pre .add .sign { background: var(--add-sign); color: var(--fg); }
pre .del { background: var(--del-bg); }
pre .del .sign { background: var(--del-sign); color: var(--fg); }
.diff-head .add { color: var(--success); }
.diff-head .del { color: var(--danger); }
</style>
