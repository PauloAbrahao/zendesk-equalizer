import { test } from 'node:test'
import assert from 'node:assert/strict'
import { compareAll } from './diff.js'

const S = {
  ticket_fields: [
    { id: 1, title: 'Assunto', removable: false, type: 'subject' },
    { id: 10, title: 'Produto', removable: true, type: 'tagger', custom_field_options: [{ id: 99, name: 'A', value: 'a' }] },
    { id: 11, title: 'Novo campo', removable: true, type: 'text' },
  ],
  ticket_forms: [{ id: 50, name: 'Suporte', ticket_field_ids: [1, 10, 11] }],
  groups: [{ id: 7, name: 'N1', default: true }, { id: 8, name: 'Só origem' }, { id: 9, name: 'Apagado', deleted: true }],
  triggers: [
    { id: 100, title: 'Roteia', updated_at: 'x', conditions: { all: [{ field: 'custom_fields_10', operator: 'is', value: 'a' }, { field: 'ticket_form_id', operator: 'is', value: '50' }] }, actions: [{ field: 'group_id', value: '7' }] },
    { id: 101, title: 'Grupo faltando', conditions: { all: [] }, actions: [{ field: 'group_id', value: '8' }] },
    { id: 102, title: 'Usuário', conditions: { all: [] }, actions: [{ field: 'assignee_id', value: '12345' }] },
    { id: 103, title: 'Campo novo', conditions: { all: [{ field: 'custom_fields_11', operator: 'present', value: null }] }, actions: [] },
  ],
}

const T = {
  ticket_fields: [
    { id: 2, title: 'Assunto', removable: false, type: 'subject' },
    { id: 20, title: 'Produto', removable: true, type: 'tagger', custom_field_options: [{ id: 555, name: 'A', value: 'a' }] },
    { id: 21, title: 'Só destino', removable: true, type: 'text' },
  ],
  ticket_forms: [{ id: 60, name: 'Suporte', ticket_field_ids: [2, 20] }],
  groups: [{ id: 70, name: 'N1', default: false }],
  triggers: [
    { id: 200, title: 'Roteia', updated_at: 'y', conditions: { all: [{ field: 'custom_fields_20', operator: 'is', value: 'a' }, { field: 'ticket_form_id', operator: 'is', value: '60' }] }, actions: [{ field: 'group_id', value: '70' }] },
  ],
}

const items = compareAll(S, T, ['groups', 'ticket_fields', 'ticket_forms', 'triggers'])
const get = (type, title) => items.find(i => i.type === type && i.title === title)

test('campos: sistema ignorado, opções sem id, status', () => {
  assert.equal(get('ticket_fields', 'Assunto'), undefined)
  assert.equal(get('ticket_fields', 'Produto').status, 'igual')
  assert.equal(get('ticket_fields', 'Novo campo').status, 'novo')
  assert.equal(get('ticket_fields', 'Só destino').status, 'so_no_destino')
})

test('formulário remapeia ids e aponta dependência nova', () => {
  const f = get('ticket_forms', 'Suporte')
  assert.deepEqual(f.source.ticket_field_ids, [2, 20, '<novo: Novo campo>'])
  assert.deepEqual(f.missing, ['campo "Novo campo"'])
  assert.equal(f.status, 'alterado')
  assert.equal(f.targetId, 60)
})

test('gatilho remapeado fica igual mesmo com ids diferentes', () => {
  assert.equal(get('triggers', 'Roteia').status, 'igual')
})

test('bloqueio: id de usuário', () => {
  assert.equal(get('triggers', 'Usuário').status, 'bloqueado')
})

test('grupos: migráveis, ignora default e apagados; gatilho só marca missing', () => {
  assert.equal(get('groups', 'N1').status, 'igual')
  assert.equal(get('groups', 'Só origem').status, 'novo')
  assert.equal(get('groups', 'Apagado'), undefined)
  const t = get('triggers', 'Grupo faltando')
  assert.equal(t.status, 'novo')
  assert.deepEqual(t.missing, ['grupo "Só origem"'])
})

test('dependência de campo novo não bloqueia, só marca missing', () => {
  const t = get('triggers', 'Campo novo')
  assert.equal(t.status, 'novo')
  assert.deepEqual(t.missing, ['campo "Novo campo"'])
})
