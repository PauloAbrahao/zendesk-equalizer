export async function api(path: string, body?: object) {
  const r = await fetch(path, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : undefined)
  // corpo vazio/HTML = backend fora do ar ou caiu no meio da requisição (proxy do vite devolve 500 sem corpo)
  const text = await r.text()
  let d
  try {
    d = JSON.parse(text)
  } catch {
    throw new Error(`${r.status} ${r.statusText}: backend não respondeu JSON${text ? ` (${text.slice(0, 200)})` : ' (resposta vazia — o servidor está rodando?)'}`)
  }
  if (!r.ok) throw new Error(d.error)
  return d
}
