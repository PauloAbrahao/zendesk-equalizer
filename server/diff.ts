import { TYPES, ORDER, type Obj, type Type, type Snapshot } from './zendesk.ts'

export type Status = 'novo' | 'alterado' | 'igual' | 'so_no_destino' | 'bloqueado'
export type Ref = { type: Type; title: string; label: string }
export type Item = {
  type: Type
  title: string
  status: Status
  missing: Ref[]
  blocked: string[]
  targetId: number | null
  source: Obj | null
  target: Obj | null
  sourceId?: number
  // como origem e destino foram casados; ausente = sem par no destino
  matchedBy?: MatchBy
  // par provável pelo nome, só aplicado se o usuário vincular
  suggestion?: { targetId: number; title: string; score: number }
  // título repetido no destino: usuário escolhe qual é o par
  candidates?: { id: number; title: string }[]
}
export type CompareItem = Item & { requires: Ref[]; requiresErrors: string[] }
export type MatchBy = 'manual' | 'nome' | 'conteudo'
// vínculos manuais por tipo: id na origem -> id no destino
export type Mappings = Partial<Record<Type, Record<string, number>>>
type Kind = 'fields' | 'forms' | 'groups' | 'brands'
// só traduzidos, nunca criados: status personalizado e opção de campo (vem junto com o campo)
type Lookup = 'statuses' | 'options'
type IdMap = Map<string, { name: string; tgt?: number }>
type Match = { s: Obj; srcDup: number[]; t?: Obj; by?: MatchBy; candidates?: Obj[]; suggestion?: Item['suggestion'] }
type Matches = { list: Match[]; onlyT: Obj[] }
export type Ctx = { usedS: Set<string>; usedT: Set<string>; targetSubdomain?: string; matches: Partial<Record<Type, Matches>> } & Record<Kind, IdMap>
  & Record<Lookup, Map<string, { name: string; tgt?: number; fieldTgt?: number }>>

// chaves de topo que variam por ambiente ou são geradas pelo Zendesk
const DROP_TOP = new Set([
  'id', 'position', 'category_id', 'creator_user_id', 'creator_app_name',
  'system_field_options', 'custom_statuses', 'sub_type_id',
])
const DROP_ANY = new Set(['url', 'created_at', 'updated_at'])

// ações/condições que apontam para IDs que não migramos (usuários, organizações, webhooks...)
const ALWAYS_BLOCK = new Set(['notification_webhook', 'notification_target'])
const NUMERIC_BLOCK = new Set(['assignee_id', 'requester_id', 'organization_id', 'notification_user', 'set_schedule', 'schedule_id'])

const LABEL = { fields: 'campo', forms: 'formulário', groups: 'grupo', brands: 'marca' }
const KIND_TYPE: Record<Kind, Type> = { fields: 'ticket_fields', forms: 'ticket_forms', groups: 'groups', brands: 'brands' }
const KIND_OF = Object.fromEntries(Object.entries(KIND_TYPE).map(([k, t]) => [t, k])) as Partial<Record<Type, Kind>>

// marca: subdomínio, domínio, logo, central de ajuda e marca padrão são de cada ambiente; nunca comparados nem sobrescritos.
// ticket_form_ids fica de fora: quem define a ligação é restricted_brand_ids do form
const BRAND_DROP = ['subdomain', 'host_mapping', 'brand_url', 'logo', 'has_help_center', 'help_center_state', 'default', 'is_deleted', 'ticket_form_ids']

const fold = (s: unknown) => String(s ?? '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
// chave de matching entre ambientes: sem caixa, acentos ou espaços; pontuação/símbolos contam ('**Banco' != 'Banco')
export const norm = (s: unknown) => fold(s).replace(/\s+/g, '')

// subdomínio é único no Zendesk inteiro: marca nova ganha "<subdomínio do destino>-<nome>"
// ponytail: sem checar se já está em uso; colisão volta como erro do Zendesk e as dependentes não são criadas
export const brandSubdomain = (account: string, name: string) =>
  `${account}-${fold(name).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`.slice(0, 63)

const keyOf = (i: { type: string; title: string }) => `${i.type}:${i.title}`

// dependências ausentes no destino, de forma transitiva (gatilho -> form -> campos).
// requires = itens que o apply cria antes; requiresErrors = dependência que não dá para criar
export function depsOf(item: Item, all: Item[]) {
  const byKey = new Map(all.map(i => [keyOf(i), i]))
  const deps = new Map<string, Ref>()
  const errors: string[] = []
  const visit = (it: Item) => {
    for (const d of it.missing) {
      const k = keyOf(d)
      if (deps.has(k)) continue
      const dep = byKey.get(k)
      if (dep?.status !== 'novo') {
        errors.push(`${d.label} não pode ser criado: ${dep ? dep.blocked.join('; ') || `status ${dep.status}` : 'não migrável'}`)
        continue
      }
      deps.set(k, { type: d.type, title: d.title, label: d.label })
      visit(dep)
    }
  }
  visit(item)
  return { requires: [...deps.values()], requiresErrors: errors }
}

// só campos customizados são migráveis; os de sistema entram apenas no mapa de IDs
const INCLUDE: Partial<Record<Type, (o: Obj) => boolean>> = { ticket_fields: f => f.removable !== false, groups: g => !g.deleted, brands: b => !b.is_deleted }
// comparação só enxerga ativos; inativos entram só no mapa de IDs (ativo que referencia inativo ainda remapeia)
const comparable = (type: Type) => (o: Obj) => (INCLUDE[type]?.(o) ?? true) && o.active !== false

function clean(v: any, top = true): any {
  if (Array.isArray(v)) return v.map(x => clean(x, false))
  if (!v || typeof v !== 'object') return v
  const out: Obj = {}
  for (const [k, x] of Object.entries(v)) {
    if (k.startsWith('raw_') || DROP_ANY.has(k) || (top && DROP_TOP.has(k))) continue
    out[k] = clean(x, false)
  }
  return out
}

function cleanFor(type: Type, obj: Obj): Obj {
  const o = clean(obj)
  // grupo padrão é escolha de cada ambiente
  if (type === 'groups') {
    delete o.default
    delete o.deleted
  }
  if (type === 'brands') for (const k of BRAND_DROP) delete o[k]
  // conjunto de marcas: ordem não importa, ordena para não acusar diferença falsa
  if (o.restricted_brand_ids) o.restricted_brand_ids = [...o.restricted_brand_ids].sort((a: number, b: number) => a - b)
  if (o.custom_field_options) o.custom_field_options = o.custom_field_options.map(({ id, ...r }: Obj) => r)
  if (o.conditions && (type === 'triggers' || type === 'automations'))
    o.conditions = { all: o.conditions.all ?? [], any: o.conditions.any ?? [] }
  if (o.filter && type === 'sla_policies') o.filter = { all: o.filter.all ?? [], any: o.filter.any ?? [] }
  return o
}

export function sortKeys(v: any): any {
  if (Array.isArray(v)) return v.map(sortKeys)
  if (!v || typeof v !== 'object') return v
  return Object.fromEntries(Object.keys(v).sort().map(k => [k, sortKeys(v[k])]))
}

const same = (a: unknown, b: unknown) => JSON.stringify(sortKeys(a)) === JSON.stringify(sortKeys(b))
const pick = (o: Obj, keys: string[]) => Object.fromEntries(keys.filter(k => k in o).map(k => [k, o[k]]))
const isNum = (v: unknown) => /^\d+$/.test(String(v))

// ids citados por forms/gatilhos/automações
const usedIds = (snap: Snapshot) => new Set([...usages(snap).keys()].map(k => k.split(':')[1]!))

// título normalizado -> objeto; com títulos repetidos vence o usado em forms/gatilhos/automações, depois o updated_at mais recente
function byTitle(list: Obj[], key: string, used: Set<string>) {
  const better = (a: Obj, b: Obj) => {
    const u = Number(used.has(String(a.id))) - Number(used.has(String(b.id)))
    return u ? u > 0 : (a.updated_at ?? '') > (b.updated_at ?? '')
  }
  const m = new Map<string, Obj>()
  for (const o of list) {
    const k = norm(o[key])
    if (!m.has(k) || better(o, m.get(k)!)) m.set(k, o)
  }
  return m
}

function group<T>(list: T[], key: (x: T) => string | null) {
  const m = new Map<string, T[]>()
  for (const x of list) {
    const k = key(x)
    if (k != null) m.set(k, [...(m.get(k) ?? []), x])
  }
  return m
}

const newest = (c: Obj[]) => c.reduce((a, b) => ((b.updated_at ?? '') > (a.updated_at ?? '') ? b : a))

// similaridade (Dice de bigramas) entre títulos normalizados, 0..1
const bigrams = (s: string) => new Set(Array.from({ length: Math.max(s.length - 1, 0) }, (_, i) => s.slice(i, i + 2)))
export function similarity(a: string, b: string) {
  const A = bigrams(a)
  const B = bigrams(b)
  if (!A.size || !B.size) return a === b ? 1 : 0
  let n = 0
  for (const x of A) if (B.has(x)) n++
  return (2 * n) / (A.size + B.size)
}
const SUGGEST_MIN = 0.7

// assinatura de conteúdo que independe de ID e de título; null = tipo/objeto sem conteúdo distintivo
function signature(type: Type, p: Obj): string | null {
  if (type === 'ticket_fields') {
    // tags das opções (dropdown/multiselect) ou do checkbox costumam ser iguais entre ambientes
    const opts = (p.custom_field_options ?? []).map((o: Obj) => o.value).sort()
    return opts.length ? `${p.type}:${opts.join(',')}` : p.tag ? `${p.type}:tag:${p.tag}` : null
  }
  if (type === 'ticket_forms') return p.ticket_field_ids?.length ? JSON.stringify([...p.ticket_field_ids].sort()) : null
  if (type === 'triggers' || type === 'automations')
    return p.actions?.length ? JSON.stringify(sortKeys({ conditions: p.conditions, actions: p.actions })) : null
  if (type === 'sla_policies') return p.policy_metrics?.length ? JSON.stringify(sortKeys({ filter: p.filter, policy_metrics: p.policy_metrics })) : null
  return null
}

// casa origem x destino em cascata: vínculo manual > título normalizado único > assinatura de conteúdo única.
// fora disso só sugere (similaridade de título), nunca casa sozinho.
// título repetido: prefere os migráveis, depois os usados em forms/gatilhos/automações; sobrou mais de um = ambíguo
function matchType(type: Type, S: Obj[], T: Obj[], ctx: Ctx, manual: Record<string, number>): Matches {
  const key = TYPES[type].title
  const inc = comparable(type)
  const narrow = (c: Obj[], used: Set<string>) => {
    if (c.some(inc)) c = c.filter(inc)
    const u = c.filter(o => used.has(String(o.id)))
    return u.length ? u : c
  }
  const tById = new Map(T.map(t => [String(t.id), t]))
  const taken = new Set<Obj>()
  const list: Match[] = [...group(S, o => norm(o[key])).values()].map(g => {
    const c = narrow(g, ctx.usedS)
    return { s: newest(c), srcDup: c.length > 1 ? c.map(o => o.id) : [] }
  })

  for (const m of list) {
    const t = tById.get(String(manual[m.s.id]))
    // vínculo de ativo para inativo é ignorado: mesma regra do casamento por nome
    if (!t || taken.has(t) || (inc(m.s) && !inc(t))) continue
    Object.assign(m, { t, by: 'manual' })
    taken.add(t)
  }

  const tByName = group(T, o => norm(o[key]))
  for (const m of list) {
    if (m.t) continue
    // ativo nunca casa com inativo do destino; inativo da origem casa só para o mapa de IDs e não esconde o par do destino
    const c = narrow((tByName.get(norm(m.s[key])) ?? []).filter(t => !taken.has(t) && (!inc(m.s) || inc(t))), ctx.usedT)
    if (c.length === 1) Object.assign(m, { t: c[0], by: 'nome' })
    else if (c.length > 1) m.candidates = c
    if (inc(m.s)) c.forEach(t => taken.add(t))
  }

  const free = () => list.filter(m => !m.t && !m.candidates && inc(m.s))
  const freeT = () => T.filter(t => inc(t) && !taken.has(t))
  const srcSig = (m: Match) => {
    const r = resolve(type, m.s, ctx)
    return r.missing.length || r.blocked.length ? null : signature(type, r.payload)
  }
  const sigT = group(freeT(), t => signature(type, cleanFor(type, t)))
  for (const [k, [m, ...rest]] of group(free(), srcSig)) {
    const ts = sigT.get(k)
    if (rest.length || ts?.length !== 1) continue
    Object.assign(m!, { t: ts[0], by: 'conteudo' })
    taken.add(ts[0]!)
  }

  // ponytail: O(sobras origem x sobras destino); indexar bigramas se as sobras passarem de alguns milhares
  const leftT = freeT()
  for (const m of free()) {
    for (const t of leftT) {
      const score = Math.round(similarity(norm(m.s[key]), norm(t[key])) * 100) / 100
      if (score >= SUGGEST_MIN && score > (m.suggestion?.score ?? 0)) m.suggestion = { targetId: t.id, title: t[key], score }
    }
  }

  return { list, onlyT: [...byTitle(leftT, key, ctx.usedT).values()] }
}

export function buildCtx(S: Snapshot, T: Snapshot, targetSubdomain?: string, mappings: Mappings = {}): Ctx {
  const ctx: Ctx = {
    usedS: usedIds(S),
    usedT: usedIds(T),
    targetSubdomain,
    matches: {},
    fields: new Map(), forms: new Map(), groups: new Map(), brands: new Map(),
    statuses: new Map(), options: new Map(),
  }
  // status personalizado casa por categoria + rótulo (IDs mudam por ambiente)
  const stKey = (s: Obj) => `${s.status_category}:${norm(s.agent_label)}`
  const tSt = new Map((T.custom_statuses ?? []).map(s => [stKey(s), s.id]))
  for (const s of S.custom_statuses ?? []) ctx.statuses.set(String(s.id), { name: s.agent_label, tgt: tSt.get(stKey(s)) })
  // ORDER já vem com dependências primeiro: assinatura de forms/gatilhos usa os IDs casados antes
  for (const type of ORDER) {
    const m = (ctx.matches[type] = matchType(type, S[type] ?? [], T[type] ?? [], ctx, mappings[type] ?? {}))
    const kind = KIND_OF[type]
    if (!kind) continue
    // id da origem -> par do seu grupo de título; vínculo manual direto no id vence
    const key = TYPES[type].title
    const byName = new Map(m.list.map(x => [norm(x.s[key]), x.t?.id]))
    const tById = new Map((T[type] ?? []).map(t => [String(t.id), t]))
    const manual = mappings[type] ?? {}
    const inc = comparable(type)
    ctx[kind] = new Map((S[type] ?? []).map(o => {
      const t = tById.get(String(manual[o.id]))
      return [String(o.id), { name: o[key], tgt: t && (!inc(o) || inc(t)) ? t.id : byName.get(norm(o[key])) }]
    }))
    // opção de campo casa pela tag dentro do campo par; precisa existir antes do match de SLA
    if (type === 'ticket_fields') {
      const tById = new Map((T.ticket_fields ?? []).map(f => [f.id, f]))
      for (const f of S.ticket_fields ?? []) {
        const fieldTgt = ctx.fields.get(String(f.id))?.tgt
        for (const o of f.custom_field_options ?? [])
          ctx.options.set(String(o.id), {
            name: `opção "${o.name}" do campo "${f.title}"`,
            fieldTgt,
            tgt: tById.get(fieldTgt!)?.custom_field_options?.find((x: Obj) => x.value === o.value)?.id,
          })
      }
    }
  }
  return ctx
}

// traduz IDs da origem para IDs do destino.
// missing = dependência que existe na origem mas ainda não no destino (resolvível migrando-a junto)
// blocked = referência impossível de mapear
export function resolve(type: Type, obj: Obj, ctx: Ctx) {
  const missing: Ref[] = []
  const blocked: string[] = []
  const ref = (kind: Kind | Lookup, id: any): any => {
    if (kind === 'statuses' || kind === 'options') {
      const m = ctx[kind].get(String(id))
      if (m?.tgt != null) return typeof id === 'string' ? String(m.tgt) : m.tgt
      // opção de campo ainda não migrado: vem junto com ele (o campo já entrou em missing)
      if (kind === 'options' && m && m.fieldTgt == null) return `<novo: ${m.name}>`
      blocked.push(m ? `${m.name} não existe no destino` : `${kind === 'statuses' ? 'status' : 'opção de campo'} id ${id} não encontrado na origem`)
      return id
    }
    const m = ctx[kind].get(String(id))
    if (!m) {
      blocked.push(`${LABEL[kind]} id ${id} não encontrado na origem`)
      return id
    }
    if (m.tgt != null) return typeof id === 'string' ? String(m.tgt) : m.tgt
    missing.push({ type: KIND_TYPE[kind], title: m.name, label: `${LABEL[kind]} "${m.name}"` })
    return `<novo: ${m.name}>`
  }

  const p = mapRefs(type, cleanFor(type, obj), ref, msg => blocked.push(msg))
  return { payload: p, missing, blocked }
}

// percorre toda referência a campo/form/grupo/marca do objeto (já limpo); ref devolve o valor que fica no lugar.
// onBlocked = referência a algo que não migramos (usuário, webhook...)
function mapRefs(type: Type, p: Obj, ref: (kind: Kind | Lookup, id: any) => any, onBlocked: (msg: string) => void = () => {}) {
  if (p.restricted_brand_ids) p.restricted_brand_ids = p.restricted_brand_ids.map((id: number) => ref('brands', id)).sort((a: number, b: number) => a - b)

  if (type === 'ticket_forms') {
    if (p.ticket_field_ids) p.ticket_field_ids = p.ticket_field_ids.map((id: number) => ref('fields', id))
    for (const k of ['agent_conditions', 'end_user_conditions'] as const) {
      if (!p[k]) continue
      p[k] = p[k].map((c: Obj) => ({
        ...c,
        parent_field_id: ref('fields', c.parent_field_id),
        child_fields: c.child_fields?.map((f: Obj) => ({ ...f, id: ref('fields', f.id) })),
      }))
    }
  }

  // filtro do SLA tem o mesmo formato das condições de gatilho
  if (type === 'triggers' || type === 'automations' || type === 'sla_policies') {
    const rule = (r: Obj) => {
      let { field, value } = r
      const first = Array.isArray(value) ? value[0] : value
      // gatilho: custom_fields_<id> com a tag (igual entre ambientes); SLA: ticket_fields_<id> com o id da opção
      const cf = /^(custom_fields|ticket_fields)_(\d+)$/.exec(field)
      if (cf) {
        field = `${cf[1]}_${ref('fields', cf[2])}`
        if (cf[1] === 'ticket_fields' && isNum(value)) value = ref('options', value)
      } else if (field === 'custom_status_id' && isNum(first))
        value = Array.isArray(value) ? value.map(v => ref('statuses', v)) : ref('statuses', value)
      else if (field === 'ticket_form_id' && isNum(value)) value = ref('forms', value)
      else if (field === 'group_id' && isNum(value)) value = ref('groups', value)
      else if (field === 'brand_id' && isNum(value)) value = ref('brands', value)
      else if (field === 'notification_group' && isNum(first)) value = [ref('groups', first), ...value.slice(1)]
      else if (ALWAYS_BLOCK.has(field) || (NUMERIC_BLOCK.has(field) && isNum(first)))
        onBlocked(`${field} referencia ID específico do ambiente (${first})`)
      return { ...r, field, value }
    }
    if (p.conditions) p.conditions = { all: p.conditions.all.map(rule), any: p.conditions.any.map(rule) }
    if (p.actions) p.actions = p.actions.map(rule)
    if (p.filter) p.filter = { all: p.filter.all.map(rule), any: p.filter.any.map(rule) }
  }
  return p
}

export type Usage = { type: Type; id: number; title: string }

// "tipo:id" -> quem referencia (forms, gatilhos, automações) no mesmo ambiente
export function usages(snap: Snapshot) {
  const out = new Map<string, Usage[]>()
  for (const type of ['ticket_forms', 'triggers', 'automations'] as const)
    for (const o of snap[type] ?? []) {
      const seen = new Set<string>()
      mapRefs(type, cleanFor(type, o), (kind, id) => {
        if (kind === 'statuses' || kind === 'options') return id
        const k = `${KIND_TYPE[kind]}:${id}`
        if (id != null && !seen.has(k)) {
          seen.add(k)
          out.set(k, [...(out.get(k) ?? []), { type, id: o.id, title: o[TYPES[type].title] }])
        }
        return id
      })
    }
  return out
}

export function compare(type: Type, ctx: Ctx): Item[] {
  const key = TYPES[type].title
  const include = comparable(type)
  const { list, onlyT } = ctx.matches[type]!

  const items = list.filter(m => include(m.s)).map((m): Item => {
    const { s, t } = m
    const { payload, missing, blocked } = resolve(type, s, ctx)
    if (m.srcDup.length) blocked.push(`título repetido na origem (ids ${m.srcDup.join(', ')}): renomeie ou apague o duplicado`)
    if (m.candidates) blocked.push(`título repetido no destino (ids ${m.candidates.map(c => c.id).join(', ')}): vincule manualmente`)
    if (type === 'brands' && !t && ctx.targetSubdomain) payload.subdomain = brandSubdomain(ctx.targetSubdomain, s[key])
    const target = t ? pick(cleanFor(type, t), Object.keys(payload)) : null
    const status: Status = blocked.length ? 'bloqueado' : !t ? 'novo' : same(payload, target) ? 'igual' : 'alterado'
    return {
      type, title: s[key], status, missing, blocked, targetId: t?.id ?? null, source: sortKeys(payload), target: sortKeys(target),
      sourceId: s.id, matchedBy: m.by, suggestion: m.suggestion, candidates: m.candidates?.map(c => ({ id: c.id, title: c[key] })),
    }
  })

  // ponytail: sobra do destino com título idêntico a um item da origem vinculado a outro par repete a chave tipo:título na UI
  for (const t of onlyT)
    items.push({ type, title: t[key], status: 'so_no_destino', missing: [], blocked: [], targetId: t.id, source: null, target: sortKeys(cleanFor(type, t)) })
  return items
}

export type Duplicate = { type: Type; items: { id: number; title: string; usedBy: Usage[]; active: boolean; updated_at?: string }[] }

// nomes repetidos dentro de um mesmo ambiente (mesma normalização do matching); só o que é migrável
export function duplicates(snap: Snapshot, types: Type[]): Duplicate[] {
  const used = usages(snap)
  return types.flatMap(type => {
    const key = TYPES[type].title
    const list = (snap[type] ?? []).filter(INCLUDE[type] ?? (() => true))
    return [...group(list, o => norm(o[key])).values()]
      .filter(g => g.length > 1)
      .map(g => ({
        type,
        items: g.map(o => ({ id: o.id, title: o[key], usedBy: used.get(`${type}:${o.id}`) ?? [], active: o.active !== false, updated_at: o.updated_at })),
      }))
  })
}

export function compareAll(S: Snapshot, T: Snapshot, types: Type[], targetSubdomain?: string, mappings?: Mappings): CompareItem[] {
  const ctx = buildCtx(S, T, targetSubdomain, mappings)
  // compara todos os tipos: dependência pode ser de um tipo que não foi pedido
  const all = ORDER.flatMap(type => compare(type, ctx))
  return all.filter(i => types.includes(i.type)).map(i => ({ ...i, ...depsOf(i, all) }))
}
