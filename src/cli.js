#!/usr/bin/env node
/**
 * cli.js — enrolar y correr.
 *
 * El token de GitHub NO vive aquí ni en un `.env`: vive en un cajón del vault, sellado a
 * la llave de este servicio. Si le quitas el aparato, deja de poder escribir — sin tocar
 * el servidor, sin rotar nada a mano. Es el mismo patrón de los proxios y del bot social.
 */
import { fetchSecrets } from '@dotrino/vault/service'
import { enroll, loadLink, dataDir } from '@dotrino/remote-agent/link'
import { startSealersService } from './index.js'

const NS = process.env.SEALERS_NS || 'sealers'
const DIR = process.env.SEALERS_DIR || dataDir('dotrino-sealers')

const uso = () => {
  console.log(`dotrino-sealers — el testigo del registro de cadenas de selladores

  enroll <invitación>   engancha este servicio al vault (una vez)
  run                   escucha en el proxio y publica los eslabones que lleguen

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
} else if (cmd === 'run') {
  const repo = process.env.SEALERS_REPO
  if (!repo) { console.error('falta SEALERS_REPO (owner/nombre)'); process.exit(2) }
  const link = loadLink(DIR)
  if (!link?.cert) { console.error('sin enrolar: dotrino-sealers enroll <invitación>'); process.exit(2) }

  // ESPERAR AL VAULT es la regla del ecosistema: sin el cajón no se arranca a medias con
  // un token de otro sitio, porque entonces el vault dejaría de mandar sobre este servicio.
  const secretos = await fetchSecrets({
    ns: NS, proxyUrl: link.proxy, masterPubkey: link.iss,
    device: link.device, cert: link.cert, enc: link.enc
  })
  const token = secretos?.GITHUB_TOKEN
  if (!token) { console.error(`el cajón "${NS}" no tiene GITHUB_TOKEN`); process.exit(1) }

  await startSealersService({ token, repo, dir: DIR, link })
} else uso()
