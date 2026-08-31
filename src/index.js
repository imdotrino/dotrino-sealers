/**
 * index.js — el testigo: recibe eslabones por el PROXIO y los publica en el repo.
 *
 * POR QUÉ POR EL PROXIO Y NO POR HTTP (dueño, 2026-08-31). El servicio ya está enrolado en
 * el acta de Dotrino, así que está en el proxio: recibir por ahí no abre ningún puerto, no
 * expone ninguna URL, y no hay CORS ni límite de peticiones que diseñar. Quien publica ya
 * viene identificado por el transporte.
 *
 * QUIÉN PUEDE PUBLICAR: cualquiera. Y no es descuido — un eslabón **se verifica solo**
 * contra el génesis de su propia identidad, así que publicarlo no es un privilegio, es un
 * favor que puede hacer cualquiera. Eso es lo que permite que si tu bóveda estaba apagada
 * cuando tocaba, lo deposite después otro aparato tuyo o incluso quien te verificó.
 *
 * LO QUE ESTE SERVICIO NO PUEDE HACER: mentir. No inventa cadenas ni cambia las que hay
 * (el repo es append-only por construcción, ver `github.js`). Lo peor que puede hacer un
 * registro comprometido es CALLARSE, y contra eso la defensa no es confiar más en él: es
 * que haya varios y se puedan comparar. Por eso el repo es público y clonable — un
 * `git clone` te convierte en testigo.
 */
import { startRemoteAgent } from '@dotrino/remote-agent/agent'
import { validarCadena } from './validate.js'
import { createGitHub, YaExiste } from './github.js'

export const OP = 'sealers.publish'

/**
 * @param {object} opts
 * @param {string} opts.token     token de GitHub con escritura al repo (del cajón del vault)
 * @param {string} opts.repo      "owner/nombre"
 * @param {string} [opts.branch]
 * @param {string} [opts.dir]     dir del enlace del agente
 * @param {(m:string)=>void} [opts.log]
 */
export async function startSealersService ({ token, repo, branch = 'main', dir, proxyUrl, log = console.log, github, agent = true } = {}) {
  const gh = github || createGitHub({ token, repo, branch })

  /** Atiende una petición ya descifrada. Separado para poder probarlo sin proxio. */
  async function atender (msg) {
    if (msg?.op !== OP) return { ok: false, error: 'op desconocida' }
    const v = await validarCadena(msg.chain)
    if (!v.ok) {
      log(`[sealers] rejected: ${v.error}`)
      return { ok: false, error: v.error }
    }
    const escritos = []
    const yaEstaban = []
    for (const a of v.archivos) {
      try {
        // Se mira antes de escribir para poder contestar «ya estaba» en vez de un error:
        // publicar dos veces el mismo eslabón no es fallo de nadie, y va a pasar —
        // publica la cuenta y publica quien la verifica.
        if (await gh.existe(a.ruta)) { yaEstaban.push(a.ruta); continue }
        await gh.crear(a.ruta, a.contenido, `${v.id.slice(0, 8)}: eslabón ${a.ruta.split('/').pop().replace('.json', '')}`)
        escritos.push(a.ruta)
      } catch (e) {
        if (e instanceof YaExiste) { yaEstaban.push(a.ruta); continue }
        log(`[sealers] could not write ${a.ruta}: ${e.message}`)
        return { ok: false, error: 'no se pudo publicar: ' + e.message }
      }
    }
    log(`[sealers] ${v.id.slice(0, 8)} seq ${v.seq}: ${escritos.length} nuevo(s), ${yaEstaban.length} ya estaba(n)`)
    return { ok: true, id: v.id, seq: v.seq, escritos, yaEstaban }
  }

  // `agent: false` deja el servicio sin transporte, solo con `atender`. Es como se prueba
  // lo que decide qué se escribe sin depender de una red ni de GitHub — que es justo la
  // parte que no puede fallar.
  if (!agent) return { atender, close: async () => {} }

  const agente = await startRemoteAgent({
    label: 'sealers',
    dir,
    proxyUrl,
    onReady: () => log(`[sealers] listening on the proxy · repo ${repo}`),
    onSession: (s) => {
      s.on('message', async (msg) => {
        let r
        // Nunca se cae por una petición: un testigo que se muere con un mensaje raro deja
        // de ser testigo justo cuando alguien tiene interés en que lo deje de ser.
        try { r = await atender(msg) } catch (e) { r = { ok: false, error: e.message } }
        s.send(r).catch(() => {})
      })
    }
  })

  return { ...agente, atender }
}

export default { startSealersService, OP }
