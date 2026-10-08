#!/usr/bin/env node
/**
 * cli.js — enrolar y correr.
 *
 * El token de GitHub NO vive aquí ni en un `.env`: vive en un cajón del vault, sellado a
 * la llave de este servicio. Si le quitas el aparato, deja de poder escribir — sin tocar
 * el servidor, sin rotar nada a mano. Es el mismo patrón de los proxios y del bot social.
 */
import { fetchSecrets } from '@dotrino/vault/service'
import { enroll, loadLink, saveLink, dataDir } from '@dotrino/remote-agent/link'
import { startSealersService } from './index.js'
import { deviceInfo, formatDeviceInfo } from '@dotrino/vault/device-info'
import { updatePrefsCommand, updateStatusText } from '@dotrino/update/npm'
import { startSelfUpdate } from './selfUpdate.js'
import { createRequire } from 'node:module'

const { version: VERSION } = createRequire(import.meta.url)('../package.json')

const NS = process.env.SEALERS_NS || 'sealers'
const DIR = process.env.SEALERS_DIR || dataDir('dotrino-sealers')

const uso = () => {
  console.log(`dotrino-sealers — el testigo del registro de cadenas de selladores

  enroll <invitación>   engancha este servicio al vault (una vez)
  run                   escucha en el proxio y publica los eslabones que lleguen
  info [--json]         qué aparato es este servicio: su ID (el de «dotrino-vault members»),
                        su bóveda y sus permisos. Sin red.
  update [--approval on|off] [--notify on|off]
                        este servicio se actualiza solo. --approval on: antes pide permiso a
                        quien aprueba en tu bóveda. --notify off: no avisa de que se
                        actualizó. Sin opciones, dice cómo está.

Variables:
  SEALERS_REPO   owner/nombre del repo del registro (requerido)
  SEALERS_NS     cajón del vault de donde sale el token (default: sealers)
  SEALERS_DIR    dónde vive el enlace de este aparato

El token de GitHub sale del cajón, no del entorno: en el vault, \`secret set ${NS} GITHUB_TOKEN <token>\`.`)
}

const [cmd, ...rest] = process.argv.slice(2)

if (cmd === 'enroll') {
  const invitacion = rest.join(' ').trim()
  if (!invitacion) { console.error('uso: dotrino-sealers enroll <invitación>'); process.exit(2) }
  // `ns` no es decoración: hace que el enrolamiento EXIJA que el cert traiga
  // `vault:secrets:sealers`. Sin eso el servicio entraría en la cuenta y descubriría al
  // arrancar que no puede leer su cajón — o peor, que le dieron uno que no es el suyo.
  const link = await enroll({
    qr: invitacion, dir: DIR, label: 'sealers', ns: NS,
    onChallenge: (c) => console.log(`\nAprueba en la bóveda:  dotrino-vault approve ${c.code || c}\n`)
  })
  console.log('enrolado · proxio', link.proxy)
} else if (cmd === 'info') {
  // La pieza común de todos los comandos (CONVENCIONES §15.1): lo que se viene a mirar es el ID.
  const link = loadLink(DIR)
  if (!link) { console.error(`sin enrolar (${DIR}): dotrino-sealers enroll <invitación>`); process.exit(1) }
  const info = await deviceInfo(link, { kind: 'sealers', ns: NS, version: VERSION, dir: DIR })
  console.log(rest.includes('--json') ? JSON.stringify(info, null, 2) : formatDeviceInfo(info))
  // Y si hay una actualización que no se instaló (no se aprobó, o necesita root), se dice
  // aquí. Fuera del JSON, que lo lee una máquina.
  if (!rest.includes('--json')) {
    const estado = updateStatusText({ dir: DIR, current: VERSION, lang: 'es' })
    if (estado) console.log('\n' + estado)
  }
} else if (cmd === 'update') {
  // Los dos ajustes de actualización de ESTA instancia (CONVENCIONES §15). Sin red.
  const r = updatePrefsCommand(rest, { dir: DIR, lang: 'es' })
  if (!r.handled) { console.error('uso: dotrino-sealers update [--approval on|off] [--notify on|off]'); process.exit(2) }
  ;(r.ok ? console.log : console.error)(r.text)
  process.exit(r.ok ? 0 : 2)
} else if (cmd === 'run') {
  const repo = process.env.SEALERS_REPO
  if (!repo) { console.error('falta SEALERS_REPO (owner/nombre)'); process.exit(2) }
  const link = loadLink(DIR)
  if (!link?.cert) { console.error('sin enrolar: dotrino-sealers enroll <invitación>'); process.exit(2) }

  // ESPERAR AL VAULT es la regla del ecosistema: sin el cajón no se arranca a medias con
  // un token de otro sitio, porque entonces el vault dejaría de mandar sobre este servicio.
  const secretos = await fetchSecrets({
    ns: NS, proxyUrl: link.proxy, masterPubkey: link.iss,
    device: link.device, cert: link.cert, enc: link.enc,
    // EL PAPEL RENOVADO LO GUARDAMOS NOSOTROS. Esta identidad vive en NUESTRO archivo y le
    // pasamos el enlace a mano, así que la librería no tiene dónde escribirlo: sin esto
    // renovaba en cada arranque y volvía a empezar, y el papel del modelo viejo no se
    // cambiaba nunca — o sea que la migración no terminaba.
    onCert: (cert) => {
      link.cert = cert
      try { saveLink(DIR, link); console.log('[sealers] papel renovado · acta', cert.seq) } catch (e) {
        console.error('[sealers] no pude guardar el papel renovado:', e.message)
      }
    }
  })
  const token = secretos?.GITHUB_TOKEN
  if (!token) { console.error(`el cajón "${NS}" no tiene GITHUB_TOKEN`); process.exit(1) }

  const service = await startSealersService({ token, repo, dir: DIR, link })
  // §15: SE ACTUALIZA SOLO. Mira al arrancar y una vez al día; lo que baja se comprueba
  // contra la release de GitHub antes de tocar el disco, y solo se reinicia si hay quien lo
  // levante. Los dos ajustes (`dotrino-sealers update`) son de esta instancia.
  startSelfUpdate({
    version: VERSION,
    dir: DIR,
    // La identidad se lee AL LLAMAR: `link.cert` se renueva con el servicio en marcha.
    conn: () => ({ proxyUrl: link.proxy, masterPubkey: link.iss, device: link.device, cert: link.cert }),
    restart: () => { Promise.resolve(service?.close?.()).catch(() => {}).finally(() => process.exit(0)) },
    log: (m) => console.log(m)
  })
} else uso()
