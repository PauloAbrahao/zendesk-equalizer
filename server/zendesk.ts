// path = endpoint; key = chave da lista (quando difere do path); one = chave do objeto único; title = chave de matching
export type Obj = Record<string, any>

export const TYPES = {
  ticket_fields: { path: 'ticket_fields', one: 'ticket_field', title: 'title' },
  ticket_forms: { path: 'ticket_forms', one: 'ticket_form', title: 'name' },
  triggers: { path: 'triggers', one: 'trigger', title: 'title' },
  automations: { path: 'automations', one: 'automation', title: 'title' },
  groups: { path: 'groups', one: 'group', title: 'name' },
  brands: { path: 'brands', one: 'brand', title: 'name' },
  sla_policies: { path: 'slas/policies', key: 'sla_policies', one: 'sla_policy', title: 'title' },
} as const

export type Type = keyof typeof TYPES
// status personalizado: só leitura, serve de mapa de IDs para gatilhos/automações (não migrável)
type ReadOnly = 'custom_statuses'
export type Snapshot = Partial<Record<Type | ReadOnly, Obj[]>>
export type Client = ReturnType<typeof client>

// ordem de aplicação: dependências primeiro
export const ORDER: Type[] = ['brands', 'groups', 'ticket_fields', 'ticket_forms', 'triggers', 'automations', 'sla_policies']

export function client(env: string) {
  const P = env.toUpperCase()
  const [sub, email, token] = ['SUBDOMAIN', 'EMAIL', 'TOKEN'].map(k => process.env[`${P}_${k}`])
  if (!sub || !email || !token) throw new Error(`Ambiente "${env}" sem ${P}_SUBDOMAIN/${P}_EMAIL/${P}_TOKEN no .env`)
  const base = `https://${sub}.zendesk.com/api/v2/`
  const auth = 'Basic ' + Buffer.from(`${email}/token:${token}`).toString('base64')

  async function call(url: string, opts: RequestInit = {}): Promise<Obj> {
    for (let i = 0; ; i++) {
      // ponytail: 30s fixo; Zendesk lento de verdade aparece como erro em vez de spinner eterno
      const r = await fetch(url, { ...opts, headers: { Authorization: auth, 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(30_000) })
      if (r.status === 429 && i < 3) {
        await new Promise(ok => setTimeout(ok, (Number(r.headers.get('retry-after')) || 5) * 1000))
        continue
      }
      if (!r.ok) throw new Error(`${r.status} ${opts.method ?? 'GET'} ${url.replace(base, '')}: ${await r.text()}`)
      return r.json()
    }
  }

  return {
    async list(type: Type | ReadOnly) {
      const t: { path: string; key?: string } = type === 'custom_statuses' ? { path: type } : TYPES[type]
      const out: Obj[] = []
      for (let url: string | null = `${base}${t.path}.json?per_page=100`; url; ) {
        const d = await call(url)
        out.push(...d[t.key ?? t.path])
        url = d.next_page
      }
      return out
    },
    create: (type: Type, obj: Obj) =>
      call(`${base}${TYPES[type].path}.json`, { method: 'POST', body: JSON.stringify({ [TYPES[type].one]: obj }) }),
    update: (type: Type, id: number, obj: Obj) =>
      call(`${base}${TYPES[type].path}/${id}.json`, { method: 'PUT', body: JSON.stringify({ [TYPES[type].one]: obj }) }),
  }
}

// busca tudo que o compare precisa: listas pedidas + campos/forms/grupos para o remap
// + gatilhos/automações para saber quais itens de título repetido estão em uso.
// SLA só quando pedido: ninguém depende dele e conta sem o recurso responde 403
export async function snapshot(c: Client, types: Type[]): Promise<Snapshot> {
  const keys = [...new Set<Type | ReadOnly>([...ORDER.filter(t => t !== 'sla_policies'), 'custom_statuses', ...types])]
  return Object.fromEntries(await Promise.all(keys.map(async k => [k, await c.list(k)])))
}
