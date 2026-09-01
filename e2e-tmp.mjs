/** El camino COMPLETO: descubrir al testigo en el canal y depositar. */
import fs from 'node:fs'
import { installNodeGlobals } from '@dotrino/remote-agent/node-globals'
installNodeGlobals(process.env.SP)

const { genesisActa, sealActa, applyChanges, sealerLinkOf } = await import('@dotrino/identity/acta')
const { makeDeviceKey, verifyDelegation } = await import('@dotrino/identity/capabilities')
const { getWebSocketProxyClient } = await import('@dotrino/proxy-client')

const IDENTIDAD = fs.readFileSync(process.env.SP + '/iss.pub', 'utf8').trim()

const c = getWebSocketProxyClient({ url: 'wss://proxy.dotrino.com', enableWebRTC: false, autoReconnect: false })
await c.connect()

// 1. descubrir
const anunciados = await c.list('dotrino.sealers')
console.log('anunciados en el canal:', anunciados.length)
console.log('forma de una entrada:', JSON.stringify(anunciados[0], null, 1).slice(0, 400))

let testigo = null
for (const t of anunciados) {
  const cert = t?.data?.cert
  if (!cert || cert.iss !== IDENTIDAD) { console.log('  · descartado: cert ausente o de otra identidad'); continue }
  const v = await verifyDelegation({ cert, expectedSub: cert.sub }).catch(() => ({ ok: false }))
  if (!v?.ok) { console.log('  · descartado: cert inválido —', v?.reason); continue }
  testigo = cert.sub
}
if (!testigo) { console.log('\nNO se descubrió testigo'); process.exit(1) }
console.log('testigo descubierto ✓')

// 2. depositar
const A = await makeDeviceKey(); const B = await makeDeviceKey()
const g = await sealActa({ acta: genesisActa({ pub: A.publickey, label: 'portatil' }), privateJwk: A.privateJwk })
let dos = await applyChanges(g, [{ op: 'admit', member: { pub: B.publickey, label: 'segunda', cn: 'eco', caps: ['sign', 'sealer'] } }], { by: A.publickey })
dos = await sealActa({ acta: dos, privateJwk: A.privateJwk })

const r = new Promise((res, rej) => {
  c.on('message', (_f, p) => { if (p?.op === 'sealers.publish.result') res(p) })
  setTimeout(() => rej(new Error('timeout')), 45000)
})
await c.sendByPubkey(testigo, { op: 'sealers.publish', chain: [sealerLinkOf(g), sealerLinkOf(dos)] })
const res = await r
console.log('\nresultado:', res.ok ? 'ok' : 'FALLÓ — ' + res.error)
if (res.ok) console.log('escritos:', res.escritos.map((x) => x.split('/').slice(-2).join('/')).join(', '))
process.exit(res.ok ? 0 : 1)
