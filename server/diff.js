import { TYPES } from './zendesk.js'

// chaves de topo que variam por ambiente ou são geradas pelo Zendesk
const DROP_TOP = new Set([
  'id', 'position', 'category_id', 'restricted_brand_ids', 'creator_user_id', 'creator_app_name',
  'system_field_options', 'custom_statuses', 'sub_type_id',
])
const DROP_ANY = new Set(['url', 'created_at', 'updated_at'])

// ações/condições que apontam para IDs que não migramos (usuários, marcas, webhooks...)
const ALWAYS_BLOCK = new Set(['notification_webhook', 'notification_target'])
const NUMERIC_BLOCK = new Set(['assignee_id', 'requester_id', 'organization_id', 'brand_id', 'notification_user', 'set_schedule', 'schedule_id'])

const LABEL = { fields: 'campo', forms: 'formulário', groups: 'grupo' }

// só campos customizados são migráveis; os de sistema entram apenas no mapa de IDs
const INCLUDE = { ticket_fields: f => f.removable !== false, groups: g => !g.deleted }

function clean(v, top = true) {
  if (Array.isArray(v)) return v.map(x => clean(x, false))
  if (!v || typeof v !== 'object') return v
  const out = {}
  for (const [k, x] of Object.entries(v)) {
    if (k.startsWith('raw_') || DROP_ANY.has(k) || (top && DROP_TOP.has(k))) continue
    out[k] = clean(x, false)
  }
  return out
}

function cleanFor(type, obj) {
  const o = clean(obj)
  // grupo padrão é escolha de cada ambiente
  if (type === 'groups') delete o.default, delete o.deleted
  if (o.custom_field_options) o.custom_field_options = o.custom_field_options.map(({ id, ...r }) => r)
  if (o.conditions && (type === 'triggers' || type === 'automations'))
    o.conditions = { all: o.conditions.all ?? [], any: o.conditions.any ?? [] }
  return o
}

export function sortKeys(v) {
  if (Array.isArray(v)) return v.map(sortKeys)
  if (!v || typeof v !== 'object') return v
  return Object.fromEntries(Object.keys(v).sort().map(k => [k, sortKeys(v[k])]))
}

const same = (a, b) => JSON.stringify(sortKeys(a)) === JSON.stringify(sortKeys(b))
const pick = (o, keys) => Object.fromEntries(keys.filter(k => k in o).map(k => [k, o[k]]))
const isNum = v => /^\d+$/.test(String(v))

// srcId -> { name, tgt } casando pelo título/nome
function idMap(src, tgt, key) {
  const byName = new Map()
  for (const o of tgt) if (!byName.has(o[key])) byName.set(o[key], o.id)
  return new Map(src.map(o => [String(o.id), { name: o[key], tgt: byName.get(o[key]) }]))
}

export function buildCtx(S, T) {
  return {
    fields: idMap(S.ticket_fields, T.ticket_fields, 'title'),
    forms: idMap(S.ticket_forms, T.ticket_forms, 'name'),
    groups: idMap(S.groups, T.groups, 'name'),
  }
}

// traduz IDs da origem para IDs do destino.
// missing = dependência que existe na origem mas ainda não no destino (resolvível migrando-a junto)
// blocked = referência impossível de mapear
export function resolve(type, obj, ctx) {
  const missing = []
  const blocked = []
  const ref = (kind, id) => {
    const m = ctx[kind].get(String(id))
    if (!m) {
      blocked.push(`${LABEL[kind]} id ${id} não encontrado na origem`)
      return id
    }
    if (m.tgt != null) return typeof id === 'string' ? String(m.tgt) : m.tgt
    missing.push(`${LABEL[kind]} "${m.name}"`)
    return `<novo: ${m.name}>`
  }

  const p = cleanFor(type, obj)

  if (type === 'ticket_forms') {
    if (p.ticket_field_ids) p.ticket_field_ids = p.ticket_field_ids.map(id => ref('fields', id))
    for (const k of ['agent_conditions', 'end_user_conditions']) {
      if (!p[k]) continue
      p[k] = p[k].map(c => ({
        ...c,
        parent_field_id: ref('fields', c.parent_field_id),
        child_fields: c.child_fields?.map(f => ({ ...f, id: ref('fields', f.id) })),
      }))
    }
  }

  if (type === 'triggers' || type === 'automations') {
    const rule = r => {
      let { field, value } = r
      const first = Array.isArray(value) ? value[0] : value
      const cf = /^custom_fields_(\d+)$/.exec(field)
      if (cf) field = `custom_fields_${ref('fields', cf[1])}`
      else if (field === 'ticket_form_id' && isNum(value)) value = ref('forms', value)
      else if (field === 'group_id' && isNum(value)) value = ref('groups', value)
      else if (field === 'notification_group' && isNum(first)) value = [ref('groups', first), ...value.slice(1)]
      else if (ALWAYS_BLOCK.has(field) || (NUMERIC_BLOCK.has(field) && isNum(first)))
        blocked.push(`${field} referencia ID específico do ambiente (${first})`)
      return { ...r, field, value }
    }
    if (p.conditions) p.conditions = { all: p.conditions.all.map(rule), any: p.conditions.any.map(rule) }
    if (p.actions) p.actions = p.actions.map(rule)
  }

  return { payload: p, missing, blocked }
}

export function compare(type, src, tgt, ctx) {
  const key = TYPES[type].title
  const include = INCLUDE[type] ?? (() => true)
  src = src.filter(include)
  tgt = tgt.filter(include)
  const tgtByTitle = new Map()
  for (const o of tgt) if (!tgtByTitle.has(o[key])) tgtByTitle.set(o[key], o)

  const items = src.map(s => {
    const t = tgtByTitle.get(s[key])
    const { payload, missing, blocked } = resolve(type, s, ctx)
    const target = t ? pick(cleanFor(type, t), Object.keys(payload)) : null
    const status = blocked.length ? 'bloqueado' : !t ? 'novo' : same(payload, target) ? 'igual' : 'alterado'
    return { type, title: s[key], status, missing, blocked, targetId: t?.id ?? null, source: sortKeys(payload), target: sortKeys(target) }
  })

  const srcTitles = new Set(src.map(o => o[key]))
  for (const t of tgt) {
    if (!srcTitles.has(t[key]))
      items.push({ type, title: t[key], status: 'so_no_destino', missing: [], blocked: [], targetId: t.id, source: null, target: sortKeys(cleanFor(type, t)) })
  }
  return items
}

export function compareAll(S, T, types) {
  const ctx = buildCtx(S, T)
  return types.flatMap(type => compare(type, S[type], T[type], ctx))
}
