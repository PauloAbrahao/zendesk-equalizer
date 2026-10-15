import test from 'node:test'
import assert from 'node:assert'
import { pdfItems, MAX_LINES } from './auditPdf.js'

const cond = n => Array.from({ length: n }, (_, k) => ({ field: `f${k}`, operator: 'is', value: String(k) }))
test('pdf mostra só linhas alteradas e respeita o limite', () => {
const [upd, big, created] = pdfItems([
  { ok: true, action: 'atualizado', before: { title: 'X', conditions: { all: cond(3), any: [] } }, after: { title: 'X', conditions: { all: [...cond(2), { field: 'f2', operator: 'is', value: 'z' }], any: [] } } },
  { ok: true, action: 'atualizado', before: { actions: [] }, after: { actions: cond(100), description: 'd' } },
  { ok: false, error: 'boom', before: null, after: { title: 'N', active: true } },
])
assert.deepEqual(upd.fields, [{ field: 'conditions', removed: ['all: f2 is 2'], added: ['all: f2 is z'] }])
const rows = big.fields.reduce((s, f) => s + Math.max(f.removed.length, f.added.length), 0)
assert.ok(rows <= MAX_LINES + big.fields.length, `rows=${rows}`)
assert.match(big.fields[0].added.at(-1), /ver JSON/)
assert.equal(created.status, 'erro: boom')
assert.deepEqual(created.fields.map(f => f.added[0]), ['N', 'true'])
})
