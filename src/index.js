/**
 * index.js — el testigo: recibe eslabones por el PROXIO y los publica en el repo.
 *
 * POR QUÉ ESCUCHA EN EL PROXIO Y NO EN UN PUERTO. El servicio ya tiene una identidad del
 * ecosistema, así que recibir por ahí no abre ningún puerto, no expone ninguna URL, y no
 * hay CORS ni rate-limit de HTTP que diseñar. Es transporte prestado, nada más.
 *
 * POR QUÉ NO ES UN `startRemoteAgent`, que sería lo obvio: un agente remoto verifica al
 * cliente contra SU PROPIA cuenta (`verifyChain({ trustedIssuer: master })`), así que solo
 * los aparatos de Dotrino podrían depositar. Aquí hace falta lo contrario — **publicar
 * puede cualquiera**. Y no es descuido: un eslabón se verifica solo contra el génesis de su
 * identidad, así que depositarlo no es un privilegio sino un favor. Eso es justo lo que
 * permite que, si tu bóveda estaba apagada cuando tocaba, lo deposite después otro aparato
 * tuyo o incluso quien te verificó.
 *
 * Y POR ESO TAMPOCO SE SELLA el mensaje (§4.1 pide sellar los dirigidos): lo que viaja va a
 * acabar en un repo PÚBLICO, que es su propósito — mismo caso que los canales
 * `publish`/`list`, exentos por la misma razón. Sellarlo además obligaría a conocer la
 * llave de cifrado del testigo, que es exactamente la barrera que aquí no debe existir.
 *
 * LO QUE ESTE SERVICIO NO PUEDE HACER: mentir. No inventa cadenas ni pisa las que hay (el
 * repo es append-only por construcción, ver `github.js`). Lo peor que puede hacer un
 * registro comprometido es CALLARSE, y contra eso la defensa no es confiar más en él: es
 * que haya varios y se puedan comparar. Por eso el repo es público — un `git clone` te
 * convierte en testigo.
 */
import { validarCadena } from './validate.js'
import { createGitHub, YaExiste } from './github.js'

export const OP = 'sealers.publish'

/**
 * EL CANAL DONDE SE ANUNCIA. Que una bóveda sepa a qué pubkey mandar su eslabón no puede
 * resolverse quemando la pubkey del testigo en el código (dueño, 2026-08-31: «¿no me puedes
 * quemar un device en el código?»): re-enrolarlo se la cambia, y todo lo que la tuviera
 * apuntada se quedaría hablando con una dirección muerta — es lo mismo que ya pasó con el
 * `nodeId` del proxio.
 *
 * Lo que no cambia nunca es la IDENTIDAD. Así que el testigo se anuncia aquí con su cert, y
 * quien lo busca acepta al que traiga un cert emitido por la identidad que sí está en su
 * código. Re-enrolarlo da un cert nuevo de la misma identidad y sigue solo; revocarlo lo
 * deja fuera del acta y su anuncio deja de valer.
 */
export const CANAL = 'dotrino.sealers'

/**
 * CUOTA POR REMITENTE. No protege el registro —lo publicado se verifica solo— sino el
 * trabajo: comprobar firmas cuesta CPU y escribir cuesta cuota de la API de GitHub. Una
 * cuenta legítima deposita una vez cada muchos meses, así que esto no le roza.
 */
export const CUOTA = { ventanaMs: 60_000, porVentana: 20 }

export function startSealersService ({
  token, repo, branch = 'main', dir, proxyUrl, log = console.log, github, link, agent = true
} = {}) {
  const gh = github || createGitHub({ token, repo, branch })
  const vistos = new Map()

  /** ¿Este remitente pasó de la cuota? Se dice en el log: un límite callado miente. */
  function pasaCuota (quien) {
    const ahora = Date.now()
    const t = (vistos.get(quien) || []).filter((x) => ahora - x < CUOTA.ventanaMs)
    if (t.length >= CUOTA.porVentana) {
      log(`[sealers] rate-limited ${String(quien).slice(0, 8)}: ${t.length} requests in the last minute`)
      vistos.set(quien, t)
      return false
    }
    t.push(ahora)
    vistos.set(quien, t)
    return true
  }

  /** Atiende una petición. Separado del transporte para poder probarlo sin red. */
  async function atender (msg, quien = 'anon') {
    if (msg?.op !== OP) return { ok: false, error: 'op desconocida' }
    if (!pasaCuota(quien)) return { ok: false, error: 'demasiadas peticiones, prueba en un minuto' }

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
  if (!agent) return Promise.resolve({ atender, close: async () => {} })

  return (async () => {
    const { installNodeGlobals } = await import('@dotrino/remote-agent/node-globals')
    // Sin esto el proxy-client no encuentra dónde guardar su llave de transporte y ESTRENA
    // una en cada arranque: el testigo cambiaría de identidad cada vez que se reinicia.
    installNodeGlobals(dir)

    const { getWebSocketProxyClient } = await import('@dotrino/proxy-client')
    const { signWithDevice, pubkeyId } = await import('@dotrino/identity/capabilities')
    const url = proxyUrl || link?.proxy || 'wss://proxy.dotrino.com'
    const client = getWebSocketProxyClient({
      url, enableWebRTC: false, autoReconnect: true, maxReconnectAttempts: 100000, reconnectDelay: 4000
    })
    await client.connect()

    // IDENTIFICARSE bajo la llave del aparato: así el testigo tiene SIEMPRE la misma
    // pubkey —la que la gente pone en su configuración— y le llega lo que le manden por
    // ella, incluso lo que se envió mientras estaba caído (cola de 24 h del proxio).
    const device = link?.device
    const identify = async () => {
      if (!device || !client.token) return
      const data = { op: 'identify', publickey: device.publickey, token: client.token, ts: Date.now() }
      const { signature } = await signWithDevice({ privateJwk: device.privateJwk, data })
      await client.identify({ data, signature })
    }
    await identify()
    client.on('token', () => { identify().catch(() => {}) })

    client.on('message', (from, payload) => {
      if (payload?.op !== OP) return
      // Nunca se cae por una petición: un testigo que se muere con un mensaje raro deja de
      // ser testigo justo cuando alguien tiene interés en que lo deje de ser.
      atender(payload, payload.publickey || from)
        .catch((e) => ({ ok: false, error: e.message }))
        .then((r) => { try { client.send(from, { op: OP + '.result', ...r }) } catch (_) {} })
    })

    // El id corto, no la pubkey: una pubkey es un JWK entero y en el log salía el
    // `{"key_ops":[` en vez de algo que alguien pueda comparar de un vistazo.
    const id = device?.publickey ? (await pubkeyId(device.publickey)).slice(0, 8).toUpperCase() : '????????'
    // ANUNCIARSE. Se republica en cada reconexión porque el canal va por token de sesión:
    // al reconectar el token es otro y el anuncio viejo ya no lleva a ninguna parte.
    const anunciar = async () => {
      try { await client.publish(CANAL, { role: 'sealers', repo, cert: link?.cert }) } catch (e) { log('[sealers] could not announce:', e.message) }
    }
    await anunciar()
    client.on('token', () => { anunciar().catch(() => {}) })

    log(`[sealers] listening on the proxy as ${id} · repo ${repo} · announced in ${CANAL}`)
    return { atender, client, id, pubkey: device?.publickey, close: async () => { try { client.disconnect?.() } catch (_) {} } }
  })()
}

export default { startSealersService, OP, CUOTA }
