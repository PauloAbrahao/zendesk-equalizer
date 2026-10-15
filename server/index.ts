import express from 'express'
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { client, snapshot, ORDER, type Obj, type Type, type Snapshot } from './zendesk.ts'
import { compareAll, duplicates, type Status, type Mappings } from './diff.ts'

export type ApplyResult = {
  type: Type | '-'
  title: string
  ok: boolean
  status?: Status
  action?: 'criado' | 'substituído' | 'já existia'
  error?: string
  before?: Obj | null
  after?: Obj | null
  requiredBy?: string[]
}

const ENVS = (process.env.ENVIRONMENTS ?? '').split(',').map(s => s.trim()).filter(Boolean)
const PROD = process.env.PRODUCTION_ENV

const app = express()
app.use(express.json({ limit: '5mb' }))
app.use(express.static(fileURLToPath(new URL('../web/dist', import.meta.url))))

// body vem undefined sem JSON; types/items podem vir com qualquer formato
function invalid({ source, target, types }: any = {}) {
  if (!ENVS.includes(source) || !ENVS.includes(target)) return 'Ambiente inválido'
  if (source === target) return 'Origem e destino devem ser diferentes'
  if (!Array.isArray(types) || !types.length || types.some(t => !ORDER.includes(t))) return 'Tipos inválidos'
}

// vínculos manuais origem -> destino, por par de ambientes: { "qa->prod": { ticket_fields: { "<idOrigem>": <idDestino> } } }
// ponytail: arquivo JSON local sem lock; trocar por banco se mais de uma pessoa vincular ao mesmo tempo
const MAPPINGS = process.env.MAPPINGS_FILE ?? fileURLToPath(new URL('../mappings.json', import.meta.url))
const pairKey = (source: string, target: string) => `${source}->${target}`
function readMappings(): Record<string, Mappings> {
  try {
    return JSON.parse(readFileSync(MAPPINGS, 'utf8'))
  } catch {
    return {}
  }
}

// S = snapshot da origem já baixado (o apply reaproveita: só o destino muda entre um tipo e outro)
async function load(source: string, target: string, types: Type[], S?: Snapshot) {
  const [src, tgt] = await Promise.all([S ?? snapshot(client(source), types), snapshot(client(target), types)])
  return compareAll(src, tgt, types, process.env[`${target.toUpperCase()}_SUBDOMAIN`], readMappings()[pairKey(source, target)])
}

app.get('/api/environments', (req, res) => {
  // order = ordem real de aplicação, para o front não repetir ORDER
  res.json({ environments: ENVS.map(name => ({ name, isProduction: name === PROD })), order: ORDER })
})

app.post('/api/compare', async (req, res) => {
  const err = invalid(req.body)
  if (err) return res.status(400).json({ error: err })
  try {
    res.json(await load(req.body.source, req.body.target, req.body.types))
  } catch (e) {
    res.status(502).json({ error: (e as Error).message })
  }
})

// itens com o mesmo nome dentro de um ambiente; só leitura
app.post('/api/duplicates', async (req, res) => {
  const { env, types } = req.body ?? {}
  if (!ENVS.includes(env)) return res.status(400).json({ error: 'Ambiente inválido' })
  if (!Array.isArray(types) || !types.length || types.some(t => !ORDER.includes(t))) return res.status(400).json({ error: 'Tipos inválidos' })
  try {
    res.json(duplicates(await snapshot(client(env), types), types))
  } catch (e) {
    res.status(502).json({ error: (e as Error).message })
  }
})

// targetId null desfaz o vínculo
app.post('/api/mappings', (req, res) => {
  const { source, target, type, sourceId, targetId } = req.body ?? {}
  const err = invalid({ source, target, types: [type] })
  if (err) return res.status(400).json({ error: err })
  if (!Number.isSafeInteger(sourceId) || (targetId !== null && !Number.isSafeInteger(targetId))) return res.status(400).json({ error: 'IDs inválidos' })
  const all = readMappings()
  const byType = ((all[pairKey(source, target)] ??= {})[type as Type] ??= {})
  if (targetId === null) delete byType[sourceId]
  else byType[sourceId] = targetId
  writeFileSync(MAPPINGS, JSON.stringify(all, null, 2))
  res.json({ ok: true })
})

app.post('/api/apply', async (req, res) => {
  const { source, target, items, confirm } = req.body ?? {}
  if (!Array.isArray(items) || items.some(i => !i || typeof i !== 'object')) return res.status(400).json({ error: 'Itens inválidos' })
  const types = ORDER.filter(t => items.some((i: Obj) => i.type === t))
  const err = invalid({ source, target, types })
  if (err) return res.status(400).json({ error: err })
  if (target === PROD && confirm !== target)
    return res.status(400).json({ error: `Confirmação obrigatória: digite "${target}"` })

  // plano = escolhidos + dependências ausentes no destino (transitivas), criadas por baixo dos panos.
  // dependência impossível de criar aborta tudo antes de qualquer escrita
  const keyOf = (i: { type: string; title: string }) => `${i.type}:${i.title}`
  const userKeys = new Set(items.map(keyOf))
  const autoDeps = new Map<string, { type: Type; title: string; requiredBy: string[] }>()
  let S: Snapshot
  try {
    S = await snapshot(client(source), types)
    const chosen = (await load(source, target, types, S)).filter(i => userKeys.has(keyOf(i)))
    const errors = chosen.flatMap(i => i.requiresErrors.map(e => `"${i.title}": ${e}`))
    if (errors.length) return res.status(400).json({ error: `Migração não executada. ${errors.join('; ')}` })
    for (const i of chosen)
      for (const d of i.requires) {
        if (userKeys.has(keyOf(d))) continue
        const a = autoDeps.get(keyOf(d)) ?? autoDeps.set(keyOf(d), { type: d.type, title: d.title, requiredBy: [] }).get(keyOf(d))!
        a.requiredBy.push(i.title)
      }
  } catch (e) {
    return res.status(502).json({ error: (e as Error).message })
  }
  const plan: { type: Type; title: string }[] = [...items, ...autoDeps.values()]

  const tgt = client(target)
  const results: ApplyResult[] = []
  try {
    // um tipo por vez (dependências primeiro), recalculando o diff para que o remap enxergue o que acabou de ser criado
    for (const type of ORDER.filter(t => plan.some(i => i.type === t))) {
      const wanted = new Set(plan.filter(i => i.type === type).map(i => i.title))
      const fresh = (await load(source, target, [type], S)).filter(i => i.type === type && wanted.has(i.title))
      for (const title of wanted)
        if (!fresh.some(i => i.title === title)) results.push({ type, title, ok: false, error: 'Item não encontrado' })
      for (const it of fresh) {
        const auto = autoDeps.get(keyOf(it))?.requiredBy
        const base: ApplyResult = { ok: false, type, title: it.title, status: it.status, before: it.target, after: it.source, ...(auto && { requiredBy: auto }) }
        if (auto && it.status !== 'novo' && it.targetId) {
          // dependência automática nunca sobrescreve o que já existe no destino
          results.push({ ...base, ok: true, action: 'já existia' })
        } else if (it.status !== 'novo' && (auto || it.status !== 'alterado')) {
          results.push({ ...base, ok: false, error: `Status atual "${it.status}", nada aplicado` })
        } else if (it.missing.length) {
          // dependência falhou antes: não cria o item que apontaria para ela
          results.push({ ...base, ok: false, error: `Não aplicado, dependências ausentes no destino: ${it.missing.map(d => d.label).join(', ')}` })
        } else {
          try {
            if (it.targetId) await tgt.update(type, it.targetId, it.source!)
            else await tgt.create(type, it.source!)
            results.push({ ...base, ok: true, action: it.targetId ? 'substituído' : 'criado' })
          } catch (e) {
            results.push({ ...base, ok: false, error: (e as Error).message })
          }
        }
      }
    }
  } catch (e) {
    results.push({ type: '-', title: '-', ok: false, error: (e as Error).message })
  }
  console.log(`[apply] ${source} -> ${target}`, JSON.stringify(results))
  res.json(results)
})

export { app }

const port = process.env.PORT || 3001
if (import.meta.main) app.listen(port, () => console.log(`API em http://localhost:${port} | ambientes: ${ENVS.join(', ')} | produção: ${PROD}`))
