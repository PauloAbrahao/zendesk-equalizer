import { test, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Zendesk falso em memória: nada sai para a rede real
Object.assign(process.env, {
  ENVIRONMENTS: 'orig,dest',
  PRODUCTION_ENV: 'dest',
  ORIG_SUBDOMAIN: 'orig', ORIG_EMAIL: 'a@b.c', ORIG_TOKEN: 'x',
  DEST_SUBDOMAIN: 'dest', DEST_EMAIL: 'a@b.c', DEST_TOKEN: 'x',
  MAPPINGS_FILE: join(tmpdir(), `zd-equalizer-mappings-${process.pid}.json`),
})

const empty = () => ({ brands: [], groups: [], ticket_fields: [], ticket_forms: [], triggers: [], automations: [] })
let db: any, writes: string[], nextId: number
const realFetch = globalThis.fetch

globalThis.fetch = (async (url: string, opts: RequestInit = {}) => {
  const m = /^https:\/\/(\w+)\.zendesk\.com\/api\/v2\/(\w+)(?:\/(\d+))?\.json/.exec(url)
  if (!m) return realFetch(url, opts)
  const [, env, path, id] = m
  const list = db[env][path]
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status })
  if (!opts.method) return json(200, { [path]: list, next_page: null })
  writes.push(`${opts.method} ${env} ${path}`)
  const obj: any = Object.values(JSON.parse(opts.body as string))[0]
  if ((obj.title ?? obj.name) === 'Ruim') return json(422, { error: 'RecordInvalid' })
  if (opts.method === 'POST') list.push({ ...obj, id: nextId++ })
  else Object.assign(list.find((o: any) => o.id === Number(id)), obj)
  return json(200, {})
}) as typeof fetch

let server: Server, base: string
before(async () => {
  const { app } = await import('./index.ts')
  server = app.listen(0)
  base = `http://localhost:${(server.address() as AddressInfo).port}`
})
after(() => {
  server.close()
  rmSync(process.env.MAPPINGS_FILE!, { force: true })
})

beforeEach(() => {
  writes = []
  nextId = 9000
  db = { orig: empty(), dest: empty() }
  db.orig.groups.push({ id: 111, name: 'G1' })
  db.orig.triggers.push(
    { id: 1, title: 'Usa G1', conditions: { all: [{ field: 'group_id', operator: 'is', value: '111' }], any: [] }, actions: [] },
    { id: 2, title: 'Ruim', conditions: { all: [], any: [] }, actions: [] },
    { id: 3, title: 'Simples', conditions: { all: [], any: [] }, actions: [{ field: 'status', value: 'open' }] },
  )
})

const apply = (items: object[], confirm = 'dest') =>
  realFetch(`${base}/api/apply`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ source: 'orig', target: 'dest', items, confirm }),
  }).then(async r => ({ status: r.status, body: (await r.json()) as any }))

test('dependência não selecionada é criada antes, auditada e remapeada', async () => {
  const r = await apply([{ type: 'triggers', title: 'Usa G1' }])
  assert.equal(r.status, 200)
  assert.deepEqual(writes, ['POST dest groups', 'POST dest triggers'])
  const [g, t] = r.body
  assert.deepEqual([g.title, g.ok, g.action, g.requiredBy], ['G1', true, 'criado', ['Usa G1']])
  assert.equal(t.requiredBy, undefined)
  // auditoria registra o id real, não o marcador <novo:...>
  assert.equal(t.after.conditions.all[0].value, String(db.dest.groups[0].id))
})

test('dependência existente no destino nunca é sobrescrita', async () => {
  db.dest.groups.push({ id: 500, name: 'G1', description: 'diferente' })
  const r = await apply([{ type: 'triggers', title: 'Usa G1' }])
  assert.deepEqual(writes, ['POST dest triggers'])
  assert.equal(db.dest.triggers[0].conditions.all[0].value, '500')
  assert.equal(r.body.length, 1)
})

test('falha ao criar dependência impede o item que depende dela', async () => {
  db.orig.groups[0].name = 'Ruim'
  const r = await apply([{ type: 'triggers', title: 'Usa G1' }])
  const [g, t] = r.body
  assert.equal(g.ok, false)
  assert.equal(t.ok, false)
  assert.match(t.error, /dependências ausentes/)
  assert.deepEqual(writes, ['POST dest groups'])
})

test('cadeia gatilho -> form -> marca: cria marca com subdomínio do destino', async () => {
  db.orig.brands.push({ id: 7, name: 'Marca X', subdomain: 'orig-x', host_mapping: 'x.com' })
  db.orig.ticket_forms.push({ id: 70, name: 'Form', ticket_field_ids: [], in_all_brands: false, restricted_brand_ids: [7] })
  db.orig.triggers.push({ id: 71, title: 'Usa form', conditions: { all: [{ field: 'ticket_form_id', operator: 'is', value: '70' }], any: [] }, actions: [] })
  const r = await apply([{ type: 'triggers', title: 'Usa form' }])
  assert.equal(r.status, 200)
  assert.deepEqual(writes, ['POST dest brands', 'POST dest ticket_forms', 'POST dest triggers'])
  const [b] = db.dest.brands
  assert.equal(b.subdomain, 'dest-marca-x')
  assert.equal(b.host_mapping, undefined)
  assert.deepEqual(db.dest.ticket_forms[0].restricted_brand_ids, [b.id])
  assert.equal(db.dest.triggers[0].conditions.all[0].value, String(db.dest.ticket_forms[0].id))
})

test('atualizar marca existente nunca mexe no subdomínio', async () => {
  db.orig.brands.push({ id: 7, name: 'M', subdomain: 'orig-m', signature_template: 'nova' })
  db.dest.brands.push({ id: 70, name: 'M', subdomain: 'dest-m', signature_template: 'velha' })
  await apply([{ type: 'brands', title: 'M' }])
  assert.deepEqual(writes, ['PUT dest brands'])
  assert.deepEqual([db.dest.brands[0].subdomain, db.dest.brands[0].signature_template], ['dest-m', 'nova'])
})

test('dependência impossível aborta antes de qualquer escrita', async () => {
  db.orig.ticket_forms.push({ id: 70, name: 'Form', ticket_field_ids: [999] })
  db.orig.triggers.push({ id: 71, title: 'Usa form', conditions: { all: [{ field: 'ticket_form_id', operator: 'is', value: '70' }], any: [] }, actions: [] })
  const r = await apply([{ type: 'triggers', title: 'Usa form' }, { type: 'triggers', title: 'Simples' }])
  assert.equal(r.status, 400)
  assert.match(r.body.error, /campo id 999/)
  assert.deepEqual(writes, [])
})

test('produção sem confirmação não escreve', async () => {
  const r = await apply([{ type: 'triggers', title: 'Simples' }], '')
  assert.equal(r.status, 400)
  assert.deepEqual(writes, [])
})

test('cria grupo antes do gatilho e remapeia o id', async () => {
  const r = await apply([{ type: 'triggers', title: 'Usa G1' }, { type: 'groups', title: 'G1' }])
  assert.equal(r.status, 200)
  assert.deepEqual(writes, ['POST dest groups', 'POST dest triggers'])
  const g = db.dest.groups.find((g: any) => g.name === 'G1')
  assert.equal(db.dest.triggers[0].conditions.all[0].value, String(g.id))
})

test('falha de um item não impede os outros', async () => {
  const r = await apply([{ type: 'triggers', title: 'Ruim' }, { type: 'triggers', title: 'Simples' }])
  const by = Object.fromEntries(r.body.map((x: any) => [x.title, x]))
  assert.equal(by.Ruim.ok, false)
  assert.match(by.Ruim.error, /422/)
  assert.equal(by.Simples.ok, true)
  assert.equal(by.Simples.action, 'criado')
})

test('vínculo manual faz o apply atualizar o par escolhido em vez de criar', async () => {
  const post = (path: string, body: object) =>
    realFetch(`${base}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  db.dest.groups.push({ id: 500, name: 'Grupo um' })
  const link = { source: 'orig', target: 'dest', type: 'groups', sourceId: 111 }
  assert.equal((await post('/api/mappings', { ...link, targetId: '500' })).status, 400)
  assert.equal((await post('/api/mappings', { ...link, targetId: 500 })).status, 200)
  await apply([{ type: 'triggers', title: 'Usa G1' }])
  assert.deepEqual(writes, ['POST dest triggers'])
  assert.equal(db.dest.triggers[0].conditions.all[0].value, '500')
  assert.equal((await post('/api/mappings', { ...link, targetId: null })).status, 200)
})

test('corpo malformado devolve 400, não 500', async () => {
  for (const body of ['', '{"source":"orig","target":"dest","items":"x"}', '{"source":"orig","target":"dest","types":"groups"}']) {
    for (const path of ['/api/apply', '/api/compare']) {
      const r = await realFetch(`${base}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body })
      assert.equal(r.status, 400, `${path} ${body}`)
    }
  }
})
