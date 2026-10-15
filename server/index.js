import express from 'express'
import { fileURLToPath } from 'node:url'
import { client, snapshot, ORDER } from './zendesk.js'
import { compareAll } from './diff.js'

const ENVS = (process.env.ENVIRONMENTS ?? '').split(',').map(s => s.trim()).filter(Boolean)
const PROD = process.env.PRODUCTION_ENV

const app = express()
app.use(express.json({ limit: '5mb' }))
app.use(express.static(fileURLToPath(new URL('../web/dist', import.meta.url))))

function invalid({ source, target, types }) {
  if (!ENVS.includes(source) || !ENVS.includes(target)) return 'Ambiente inválido'
  if (source === target) return 'Origem e destino devem ser diferentes'
  if (!types?.length || types.some(t => !ORDER.includes(t))) return 'Tipos inválidos'
}

async function load(source, target, types) {
  const [S, T] = await Promise.all([snapshot(client(source), types), snapshot(client(target), types)])
  return compareAll(S, T, types)
}

app.get('/api/environments', (req, res) => {
  res.json(ENVS.map(name => ({ name, isProduction: name === PROD })))
})

app.post('/api/compare', async (req, res) => {
  const err = invalid(req.body)
  if (err) return res.status(400).json({ error: err })
  try {
    res.json(await load(req.body.source, req.body.target, req.body.types))
  } catch (e) {
    res.status(502).json({ error: e.message })
  }
})

app.post('/api/apply', async (req, res) => {
  const { source, target, items = [], confirm } = req.body
  const types = ORDER.filter(t => items.some(i => i.type === t))
  const err = invalid({ source, target, types })
  if (err) return res.status(400).json({ error: err })
  if (target === PROD && confirm !== target)
    return res.status(400).json({ error: `Confirmação obrigatória: digite "${target}"` })

  const tgt = client(target)
  const results = []
  try {
    // um tipo por vez, recalculando o diff para que o remap enxergue o que acabou de ser criado
    for (const type of types) {
      const wanted = new Set(items.filter(i => i.type === type).map(i => i.title))
      const fresh = (await load(source, target, [type])).filter(i => i.type === type && wanted.has(i.title))
      for (const title of wanted)
        if (!fresh.some(i => i.title === title)) results.push({ type, title, ok: false, error: 'Item não encontrado' })
      for (const it of fresh) {
        const base = { type, title: it.title }
        if (it.status !== 'novo' && it.status !== 'alterado') {
          results.push({ ...base, ok: false, error: `Status atual "${it.status}", nada aplicado` })
        } else if (it.missing.length) {
          results.push({ ...base, ok: false, error: `Dependências ausentes no destino: ${it.missing.join(', ')}` })
        } else {
          try {
            if (it.targetId) await tgt.update(type, it.targetId, it.source)
            else await tgt.create(type, it.source)
            results.push({ ...base, ok: true, action: it.targetId ? 'substituído' : 'criado' })
          } catch (e) {
            results.push({ ...base, ok: false, error: e.message })
          }
        }
      }
    }
  } catch (e) {
    results.push({ type: '-', title: '-', ok: false, error: e.message })
  }
  console.log(`[apply] ${source} -> ${target}`, JSON.stringify(results))
  res.json(results)
})

const port = process.env.PORT || 3001
app.listen(port, () => console.log(`API em http://localhost:${port} | ambientes: ${ENVS.join(', ')} | produção: ${PROD}`))
