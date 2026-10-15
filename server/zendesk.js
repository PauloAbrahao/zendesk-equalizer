// path = endpoint e chave da lista; one = chave do objeto único; title = chave de matching
export const TYPES = {
  ticket_fields: { path: 'ticket_fields', one: 'ticket_field', title: 'title' },
  ticket_forms: { path: 'ticket_forms', one: 'ticket_form', title: 'name' },
  triggers: { path: 'triggers', one: 'trigger', title: 'title' },
  automations: { path: 'automations', one: 'automation', title: 'title' },
  groups: { path: 'groups', one: 'group', title: 'name' },
}

// ordem de aplicação: dependências primeiro
export const ORDER = ['groups', 'ticket_fields', 'ticket_forms', 'triggers', 'automations']

export function client(env) {
  const P = env.toUpperCase()
  const [sub, email, token] = ['SUBDOMAIN', 'EMAIL', 'TOKEN'].map(k => process.env[`${P}_${k}`])
  if (!sub || !email || !token) throw new Error(`Ambiente "${env}" sem ${P}_SUBDOMAIN/${P}_EMAIL/${P}_TOKEN no .env`)
  const base = `https://${sub}.zendesk.com/api/v2/`
  const auth = 'Basic ' + Buffer.from(`${email}/token:${token}`).toString('base64')

  async function call(url, opts = {}) {
    for (let i = 0; ; i++) {
      const r = await fetch(url, { ...opts, headers: { Authorization: auth, 'Content-Type': 'application/json' } })
      if (r.status === 429 && i < 3) {
        await new Promise(ok => setTimeout(ok, (Number(r.headers.get('retry-after')) || 5) * 1000))
        continue
      }
      if (!r.ok) throw new Error(`${r.status} ${opts.method ?? 'GET'} ${url.replace(base, '')}: ${await r.text()}`)
      return r.json()
    }
  }

  return {
    async list(type) {
      const { path } = TYPES[type]
      const out = []
      for (let url = `${base}${path}.json?per_page=100`; url; ) {
        const d = await call(url)
        out.push(...d[path])
        url = d.next_page
      }
      return out
    },
    create: (type, obj) =>
      call(`${base}${TYPES[type].path}.json`, { method: 'POST', body: JSON.stringify({ [TYPES[type].one]: obj }) }),
    update: (type, id, obj) =>
      call(`${base}${TYPES[type].path}/${id}.json`, { method: 'PUT', body: JSON.stringify({ [TYPES[type].one]: obj }) }),
  }
}

// busca tudo que o compare precisa: listas pedidas + campos/forms/grupos para o remap
export async function snapshot(c, types) {
  const keys = [...new Set(['ticket_fields', 'ticket_forms', 'groups', ...types])]
  return Object.fromEntries(await Promise.all(keys.map(async k => [k, await c.list(k)])))
}
