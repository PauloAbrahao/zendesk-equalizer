import { test } from 'node:test'
import assert from 'node:assert/strict'
import { compareAll, brandSubdomain, duplicates } from './diff.ts'

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
const get = (type: string, title: string): any => items.find(i => i.type === type && i.title === title)

test('campos: sistema ignorado, opções sem id, status', () => {
  assert.equal(get('ticket_fields', 'Assunto'), undefined)
  assert.equal(get('ticket_fields', 'Produto').status, 'igual')
  assert.equal(get('ticket_fields', 'Novo campo').status, 'novo')
  assert.equal(get('ticket_fields', 'Só destino').status, 'so_no_destino')
})

test('formulário remapeia ids e aponta dependência nova', () => {
  const f = get('ticket_forms', 'Suporte')
  assert.deepEqual(f.source.ticket_field_ids, [2, 20, '<novo: Novo campo>'])
  assert.deepEqual(f.missing.map((d: any) => d.label), ['campo "Novo campo"'])
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
  assert.deepEqual(t.missing.map((d: any) => d.label), ['grupo "Só origem"'])
})

test('dependência de campo novo não bloqueia, só marca missing', () => {
  const t = get('triggers', 'Campo novo')
  assert.equal(t.status, 'novo')
  assert.deepEqual(t.missing.map((d: any) => d.label), ['campo "Novo campo"'])
})

test('requires: dependências transitivas mesmo de tipos não pedidos; impossível vira erro', () => {
  const S = {
    ticket_fields: [{ id: 1, title: 'F novo', removable: true, type: 'text' }],
    ticket_forms: [{ id: 2, name: 'Form novo', ticket_field_ids: [1], restricted_brand_ids: [9] }, { id: 3, name: 'Form quebrado', ticket_field_ids: [999] }],
    groups: [], brands: [{ id: 9, name: 'Só prod' }],
    triggers: [
      { id: 4, title: 'Usa form', conditions: { all: [{ field: 'ticket_form_id', operator: 'is', value: '2' }] }, actions: [] },
      { id: 5, title: 'Usa form bloqueado', conditions: { all: [{ field: 'ticket_form_id', operator: 'is', value: '3' }] }, actions: [] },
    ],
  }
  const T = { ticket_fields: [], ticket_forms: [], groups: [], brands: [], triggers: [] }
  const [ok, bad] = compareAll(S, T, ['triggers'])
  assert.deepEqual(ok.requires.map(d => d.label).sort(), ['campo "F novo"', 'formulário "Form novo"', 'marca "Só prod"'])
  assert.deepEqual(ok.requiresErrors, [])
  assert.match(bad.requiresErrors[0], /formulário "Form quebrado" não pode ser criado: campo id 999/)
})

test('marcas do form: remapeia pelo nome; marca ausente vira dependência', () => {
  const form = (id: number, name: string, brands: number[]) => ({ id, name, in_all_brands: false, restricted_brand_ids: brands, ticket_field_ids: [] })
  const S = { ticket_fields: [], groups: [], brands: [{ id: 5, name: 'A' }, { id: 6, name: 'B' }], ticket_forms: [form(1, 'Ok', [5]), form(2, 'Sem B', [5, 6])] }
  const T = { ticket_fields: [], groups: [], brands: [{ id: 50, name: 'A' }], ticket_forms: [form(9, 'Ok', [50])] }
  const [ok, semB] = compareAll(S, T, ['ticket_forms'])
  assert.equal(ok.status, 'igual')
  assert.deepEqual(ok!.source!.restricted_brand_ids, [50])
  assert.equal(semB.status, 'novo')
  assert.deepEqual(semB.requires.map(d => d.label), ['marca "B"'])
})

test('marcas: dados de ambiente nunca comparados; nova ganha subdomínio do destino', () => {
  const none = { ticket_fields: [], ticket_forms: [], groups: [] }
  const S = { ...none, brands: [{ id: 1, name: 'Ação Já', subdomain: 'prod-acao', host_mapping: 'acao.com', default: true, active: true }, { id: 2, name: 'Nova', subdomain: 'prod-nova', active: true }] }
  const T = { ...none, brands: [{ id: 10, name: 'Ação Já', subdomain: 'qa-acao', host_mapping: null, default: false, active: true }] }
  const [same, nova] = compareAll(S, T, ['brands'], 'qa')
  assert.equal(same.status, 'igual')
  assert.equal(nova.status, 'novo')
  assert.equal(nova!.source!.subdomain, 'qa-nova')
  assert.equal(brandSubdomain('qa', 'Ação Já!'), 'qa-acao-ja')
})

test('títulos repetidos: vence o usado; empate no destino bloqueia até vincular', () => {
  const S = {
    ticket_fields: [
      { id: 360041875752, title: 'Banco', removable: true, type: 'text', updated_at: '2023-01-01T00:00:00Z' },
      { id: 26968575235227, title: 'Banco', removable: true, type: 'tagger', updated_at: '2024-06-01T00:00:00Z' },
    ],
    ticket_forms: [{ id: 900, name: 'F', ticket_field_ids: [360041875752] }],
    groups: [],
  }
  const T = {
    ticket_fields: [
      { id: 17495801779483, title: 'Banco', removable: true, type: 'text', updated_at: '2024-01-01T00:00:00Z' },
      { id: 17495801779999, title: 'Banco', removable: true, type: 'text', updated_at: '2025-01-01T00:00:00Z' },
    ],
    ticket_forms: [],
    groups: [],
  }
  const out = compareAll(S, T, ['ticket_fields', 'ticket_forms'])
  const bancos = out.filter(i => i.type === 'ticket_fields')
  assert.equal(bancos.length, 1)
  assert.equal(bancos[0]!.source!.type, 'text') // o usado no form, mesmo sendo mais antigo
  // nenhum usado no destino: ambíguo, nada é escolhido sozinho
  assert.equal(bancos[0]!.status, 'bloqueado')
  assert.equal(bancos[0]!.targetId, null)
  assert.deepEqual(bancos[0]!.candidates!.map(c => c.id).sort(), [17495801779483, 17495801779999])
  const form = out.find(i => i.type === 'ticket_forms')!
  assert.match(form.requiresErrors[0]!, /campo "Banco" não pode ser criado: título repetido no destino/)

  // vínculo manual resolve, inclusive para o form que referencia o campo
  const linked = compareAll(S, T, ['ticket_fields', 'ticket_forms'], undefined, { ticket_fields: { '360041875752': 17495801779483 } })
  const b = linked.find(i => i.type === 'ticket_fields')!
  assert.equal(b.targetId, 17495801779483)
  assert.equal(b.matchedBy, 'manual')
  assert.deepEqual(linked.find(i => i.type === 'ticket_forms')!.source!.ticket_field_ids, [17495801779483])
})

test('renomeado com mesmo conteúdo: casa por conteúdo', () => {
  const S = {
    ticket_fields: [{ id: 1, title: 'Motivo contato', removable: true, type: 'tagger', custom_field_options: [{ id: 5, name: 'X', value: 'mot_x' }, { id: 6, name: 'Y', value: 'mot_y' }] }],
    ticket_forms: [], groups: [{ id: 7, name: 'N1' }],
    triggers: [{ id: 100, title: 'Roteia N1', conditions: { all: [{ field: 'custom_fields_1', operator: 'is', value: 'mot_x' }] }, actions: [{ field: 'group_id', value: '7' }] }],
  }
  const T = {
    ticket_fields: [{ id: 2, title: 'Motivo do contato', removable: true, type: 'tagger', custom_field_options: [{ id: 9, name: 'X', value: 'mot_x' }, { id: 8, name: 'Y', value: 'mot_y' }] }],
    ticket_forms: [], groups: [{ id: 70, name: 'N1' }],
    triggers: [{ id: 200, title: '[N1] roteamento', conditions: { all: [{ field: 'custom_fields_2', operator: 'is', value: 'mot_x' }] }, actions: [{ field: 'group_id', value: '70' }] }],
  }
  const out = compareAll(S, T, ['ticket_fields', 'triggers'])
  const f = out.find(i => i.type === 'ticket_fields')!
  assert.equal(f.matchedBy, 'conteudo')
  assert.equal(f.targetId, 2)
  assert.equal(f.status, 'alterado') // só o título muda
  const t = out.find(i => i.type === 'triggers')!
  assert.equal(t.matchedBy, 'conteudo')
  assert.equal(t.targetId, 200)
  assert.equal(out.filter(i => i.status === 'so_no_destino').length, 0)
})

test('título parecido sem conteúdo igual: só sugere', () => {
  const S = { ticket_fields: [{ id: 1, title: 'Motivo contato', removable: true, type: 'text' }], ticket_forms: [], groups: [] }
  const T = { ticket_fields: [{ id: 2, title: 'Motivo do contato', removable: true, type: 'text' }, { id: 3, title: 'Outro', removable: true, type: 'text' }], ticket_forms: [], groups: [] }
  const f = compareAll(S, T, ['ticket_fields']).find(i => i.title === 'Motivo contato')!
  assert.equal(f.status, 'novo')
  assert.equal(f.matchedBy, undefined)
  assert.equal(f.suggestion!.targetId, 2)
  assert.ok(f.suggestion!.score >= 0.7)
})

test('vínculo manual vence o nome', () => {
  const S = { ticket_fields: [{ id: 1, title: 'A', removable: true, type: 'text' }], ticket_forms: [], groups: [] }
  const T = { ticket_fields: [{ id: 2, title: 'A', removable: true, type: 'text' }, { id: 3, title: 'B', removable: true, type: 'text' }], ticket_forms: [], groups: [] }
  const out = compareAll(S, T, ['ticket_fields'], undefined, { ticket_fields: { '1': 3 } })
  assert.equal(out.find(i => i.title === 'A' && i.sourceId === 1)!.targetId, 3)
  assert.equal(out.find(i => i.status === 'so_no_destino')!.targetId, 2)
})

test('matching ignora caixa, acentos, espaços e pontuação', () => {
  const S = { ticket_fields: [{ id: 1, title: 'Tipo da Requisição', removable: true, type: 'text' }], ticket_forms: [{ id: 5, name: 'F', ticket_field_ids: [1] }], groups: [] }
  const T = { ticket_fields: [{ id: 2, title: ' tipo  da requisicao ', removable: true, type: 'text' }], ticket_forms: [], groups: [] }
  const out = compareAll(S, T, ['ticket_fields', 'ticket_forms'])
  const f = out.filter(i => i.type === 'ticket_fields')
  assert.equal(f.length, 1)
  assert.equal(f[0]!.targetId, 2)
  assert.equal(f[0]!.status, 'alterado') // título difere: atualiza para o da origem
  assert.deepEqual(out.find(i => i.type === 'ticket_forms')!.source!.ticket_field_ids, [2])
})

test('duplicados: mesmo nome normalizado no ambiente, ignora sistema e apagados', () => {
  const snap = {
    ticket_fields: [
      { id: 1, title: 'Banco', removable: true, type: 'text', active: false },
      { id: 2, title: ' banco.', removable: true, type: 'tagger' },
      { id: 3, title: 'Banco', removable: false, type: 'subject' },
      { id: 4, title: 'Único', removable: true, type: 'text' },
    ],
    ticket_forms: [{ id: 9, name: 'F', ticket_field_ids: [2] }],
    groups: [{ id: 5, name: 'N1' }, { id: 6, name: 'N1', deleted: true }],
  }
  const d = duplicates(snap, ['ticket_fields', 'groups'])
  assert.equal(d.length, 1)
  assert.deepEqual(d[0]!.items.map(i => [i.id, i.used, i.active]), [[1, false, false], [2, true, true]])
})
