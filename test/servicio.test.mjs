/**
 * EL SERVICIO, SIN GITHUB Y SIN PROXIO.
 *
 * `atender()` y el cliente de GitHub están separados a propósito: lo que decide qué se
 * escribe no debería necesitar red para probarse. Aquí se comprueba lo que un registro
 * tiene que cumplir pase lo que pase — que no reescribe, que no se cae, y que un doble
 * envío no es un error de nadie.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { genesisActa, sealActa, applyChanges } from '@dotrino/identity/acta'
import { makeDeviceKey } from '@dotrino/identity/capabilities'
import { startSealersService, OP } from '../src/index.js'
import { createGitHub, YaExiste } from '../src/github.js'

/** Un GitHub de mentira que se comporta como el de verdad en lo único que importa. */
function githubFalso () {
  const archivos = new Map()
  return {
    archivos,
    async existe (r) { return archivos.has(r) },
    async crear (r, c) {
      if (archivos.has(r)) throw new YaExiste(r) // como la API sin `sha`
      archivos.set(r, c)
      return true
    }
  }
}

async function cadenaBuena () {
  const A = await makeDeviceKey()
  const B = await makeDeviceKey()
  const g = await sealActa({ acta: genesisActa({ pub: A.publickey, label: 'A' }), privateJwk: A.privateJwk })
  let dos = await applyChanges(g, [{ op: 'admit', member: { pub: B.publickey, label: 'B', caps: ['sign', 'sealer'] } }], { by: A.publickey })
  dos = await sealActa({ acta: dos, privateJwk: A.privateJwk })
  return [g, dos]
}

const servicio = (gh) => startSealersService({ github: gh, repo: 'x/y', log: () => {}, agent: false })

test('una cadena buena se escribe entera, y repetirla NO es un error', async () => {
  const gh = githubFalso()
  const s = await servicio(gh)
  const chain = await cadenaBuena()

  const a = await s.atender({ op: OP, chain })
  assert.equal(a.ok, true, a.error)
  assert.equal(a.escritos.length, 2)
  assert.equal(gh.archivos.size, 2)

  // Va a pasar de verdad: publica la cuenta y publica quien la verifica.
  const b = await s.atender({ op: OP, chain })
  assert.equal(b.ok, true)
  assert.equal(b.escritos.length, 0)
  assert.equal(b.yaEstaban.length, 2)
  assert.equal(gh.archivos.size, 2, 'no se escribió nada nuevo')
})

test('lo que ya está publicado NO se puede pisar', async () => {
  const gh = githubFalso()
  const s = await servicio(gh)
  const chain = await cadenaBuena()
  await s.atender({ op: OP, chain })
  const antes = new Map(gh.archivos)

  // Alguien reenvía la misma cadena con el génesis manipulado.
  const falseada = [{ ...chain[0], label: 'otra cosa' }, chain[1]]
  await s.atender({ op: OP, chain: falseada })
  assert.deepEqual([...gh.archivos], [...antes], 'el contenido publicado no cambió')
})

test('una cadena inválida se rechaza y no escribe nada', async () => {
  const gh = githubFalso()
  const s = await servicio(gh)
  const r = await s.atender({ op: OP, chain: [{ seq: 1, sealerChanged: true }, { seq: 2, sealerChanged: true }] })
  assert.equal(r.ok, false)
  assert.equal(gh.archivos.size, 0)
})

test('una petición rara no tumba al testigo', async () => {
  const s = await servicio(githubFalso())
  for (const m of [null, {}, { op: 'otra' }, { op: OP }]) {
    const r = await s.atender(m)
    assert.equal(r.ok, false, JSON.stringify(m))
  }
})

test('si GitHub falla, se contesta el fallo — no se dice que se publicó', async () => {
  const gh = githubFalso()
  gh.crear = async () => { throw new Error('502 bad gateway') }
  const s = await servicio(gh)
  const r = await s.atender({ op: OP, chain: await cadenaBuena() })
  assert.equal(r.ok, false)
  assert.match(r.error, /502/)
})

test('el cliente de GitHub traduce el 422 en «ya existe», no en un fallo', async () => {
  const gh = createGitHub({ token: 't', repo: 'a/b', fetch: async () => ({ status: 422, ok: false, text: async () => '' }) })
  await assert.rejects(() => gh.crear('chains/aa/aa/1.json', '{}', 'm'), (e) => e instanceof YaExiste && e.code === 'ya-existe')
})
