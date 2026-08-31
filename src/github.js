/**
 * github.js — escribir en el repo, sin git.
 *
 * Se usa la API de contenidos y no `git`: no hace falta clonar nada (el repo entero puede
 * pesar, y este servicio solo añade archivos sueltos), no hay working tree que mantener, y
 * el proceso puede correr en cualquier sitio sin estado.
 *
 * Y regala la propiedad que más importa: **crear un archivo que ya existe FALLA** si no le
 * pasas su `sha`. Como aquí nunca se pasa, el registro es append-only por construcción —
 * no por una regla que alguien tenga que recordar. Un eslabón publicado no se puede pisar.
 */
const API = 'https://api.github.com'

/** Un eslabón ya publicado no se reescribe: eso es lo que hace del registro un registro. */
export class YaExiste extends Error {
  constructor (ruta) { super('ya publicado: ' + ruta); this.code = 'ya-existe' }
}

export function createGitHub ({ token, repo, branch = 'main', fetch: f = globalThis.fetch } = {}) {
  if (!token) throw new Error('github: falta el token')
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo || '')) throw new Error('github: repo debe ser "owner/nombre"')

  const cabeceras = {
    authorization: `Bearer ${token}`,
    accept: 'application/vnd.github+json',
    'x-github-api-version': '2022-11-28',
    'user-agent': 'dotrino-sealers'
  }

  /** ¿Está ya este eslabón? Se pregunta antes de escribir para poder contestar «ya estaba»
   *  en vez de un error de la API: publicar dos veces lo mismo no es un fallo de nadie. */
  async function existe (ruta) {
    const r = await f(`${API}/repos/${repo}/contents/${encodeURI(ruta)}?ref=${encodeURIComponent(branch)}`, { headers: cabeceras })
    if (r.status === 404) return false
    if (!r.ok) throw new Error(`github: ${r.status} al mirar ${ruta}`)
    return true
  }

  async function crear (ruta, contenido, mensaje) {
    const r = await f(`${API}/repos/${repo}/contents/${encodeURI(ruta)}`, {
      method: 'PUT',
      headers: { ...cabeceras, 'content-type': 'application/json' },
      body: JSON.stringify({
        message: mensaje,
        branch,
        content: Buffer.from(contenido, 'utf8').toString('base64')
      })
    })
    // 422 = ya existe. Sin `sha` la API se niega a pisar, que es exactamente lo que se
    // quiere: el append-only lo hace cumplir GitHub, no este código.
    if (r.status === 422) throw new YaExiste(ruta)
    if (!r.ok) throw new Error(`github: ${r.status} al escribir ${ruta}: ${(await r.text()).slice(0, 200)}`)
    return true
  }

  return { existe, crear }
}

export default { createGitHub, YaExiste }
