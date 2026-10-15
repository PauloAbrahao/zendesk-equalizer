// path = endpoint e chave da lista; one = chave do objeto único; title = chave de matching
export type Obj = Record<string, any>

export const TYPES = {
  ticket_fields: { path: 'ticket_fields', one: 'ticket_field', title: 'title' },
  ticket_forms: { path: 'ticket_forms', one: 'ticket_form', title: 'name' },
  triggers: { path: 'triggers', one: 'trigger', title: 'title' },
  automations: { path: 'automations', one: 'automation', title: 'title' },
  groups: { path: 'groups', one: 'group', title: 'name' },
  brands: { path: 'brands', one: 'brand', title: 'name' },
} as const

export type Type = keyof typeof TYPES
export type Snapshot = Partial<Record<Type, Obj[]>>
export type Client = ReturnType<typeof client>

// ordem de aplicação: dependências primeiro
export const ORDER: Type[] = ['brands', 'groups', 'ticket_fields', 'ticket_forms', 'triggers', 'automations']

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
    async list(type: Type) {
      const { path } = TYPES[type]
      const out: Obj[] = []
      for (let url: string | null = `${base}${path}.json?per_page=100`; url; ) {
        const d = await call(url)
        out.push(...d[path])
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
// + gatilhos/automações para saber quais itens de título repetido estão em uso
export async function snapshot(c: Client, types: Type[]): Promise<Snapshot> {
  const keys = [...new Set([...ORDER, ...types])]
  return Object.fromEntries(await Promise.all(keys.map(async k => [k, await c.list(k)])))
}
