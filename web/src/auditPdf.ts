import type { ApplyResult } from '../../server/index.ts'

export type Audit = { appliedAt: string; source: string; target: string; items: ApplyResult[] }

// Monta o conteúdo do PDF de auditoria: por item, só as linhas que mudaram em cada campo,
// cortado num orçamento de linhas para o item caber numa página (o JSON baixado tem tudo).

// ponytail: 30 linhas ≈ 1 página A4 paisagem a 11px; ajuste se mudar fonte/papel
export const MAX_LINES = 30

const one = (v: unknown) => (typeof v === 'string' ? v : JSON.stringify(v))
// condição/ação do Zendesk vira "campo operador valor"; resto vira JSON compacto
// ponytail: linha cortada em 120 chars (≈ largura da coluna) para não quebrar em várias e estourar a página
const clip = (s: string) => (s.length > 120 ? s.slice(0, 119) + '…' : s)
const line = (el: any) => clip(el && typeof el === 'object' && 'field' in el ? `${el.field} ${el.operator ?? '='} ${one(el.value)}` : one(el))

export function toLines(v: unknown): string[] {
  if (v === undefined) return []
  if (Array.isArray(v)) return v.map(line)
  if (v && typeof v === 'object' && !('field' in v)) return Object.entries(v).flatMap(([k, x]) => toLines(x).map(l => `${k}: ${l}`))
  return [line(v)]
}

const cut = (list: string[], n: number) => (list.length > n ? [...list.slice(0, n), `… +${list.length - n} linha(s), ver JSON`] : list)

export function pdfItems(items: ApplyResult[]) {
  return items.map(i => {
    const b: Record<string, unknown> = i.before ?? {}, a: Record<string, unknown> = i.after ?? {}
    const keys = [...new Set([...Object.keys(b), ...Object.keys(a)])].filter(k => JSON.stringify(b[k]) !== JSON.stringify(a[k]))
    let budget = MAX_LINES
    const fields = keys.map(k => {
      const bl = toLines(b[k]), al = toLines(a[k])
      const bs = new Set(bl), as = new Set(al)
      let removed = bl.filter(l => !as.has(l)), added = al.filter(l => !bs.has(l))
      if (!removed.length && !added.length) removed = added = ['(mesmos valores, ordem diferente)']
      if (budget <= 0) return { field: k, removed: ['(omitido, ver JSON)'], added: [] }
      removed = cut(removed, budget)
      added = cut(added, budget)
      budget -= Math.max(removed.length, added.length)
      return { field: k, removed, added }
    })
    const dep = i.requiredBy ? ` · dependência de ${i.requiredBy.join(', ')}` : ''
    return { ...i, fields, status: (i.ok ? i.action : `erro: ${i.error}`) + dep }
  })
}
