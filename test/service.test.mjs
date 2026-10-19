/**
 * EL SERVICIO, SIN GITHUB Y SIN PROXIO.
 *
 * `handle()` y el cliente de GitHub están separados a propósito: lo que decide qué se
 * escribe no debería necesitar red para probarse. Aquí se comprueba lo que un registro
 * tiene que cumplir pase lo que pase — que no reescribe, que no se cae, y que un doble
 * envío no es un error de nadie.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { genesisActa, sealActa, applyChanges, sealerLinkOf } from '@dotrino/identity/acta'
import { makeDeviceKey } from '@dotrino/identity/capabilities'
import { startSealersService, OP, QUOTA } from '../src/index.js'
import { createGitHub, AlreadyExists } from '../src/github.js'

/** Un GitHub de mentira que se comporta como el de verdad en lo único que importa. */
function fakeGitHub () {
  const files = new Map()
  return {
    files,
    async exists (r) { return files.has(r) },
    async create (r, c) {
      if (files.has(r)) throw new AlreadyExists(r) // como la API sin `sha`
      files.set(r, c)
      return true
    }
  }
}

/** Lo que se deposita son los ESLABONES, no las actas: ocho campos y ningún aparato. */
async function goodChain () {
  const A = await makeDeviceKey()
  const B = await makeDeviceKey()
  const g = await sealActa({ acta: genesisActa({ pub: A.publickey, label: 'A' }), privateJwk: A.privateJwk })
  let two = await applyChanges(g, [{ op: 'admit', member: { pub: B.publickey, label: 'B', caps: ['sign', 'sealer'] } }], { by: A.publickey })
  two = await sealActa({ acta: two, privateJwk: A.privateJwk })
  return [sealerLinkOf(g), sealerLinkOf(two)]
}

const makeService = (gh) => startSealersService({ github: gh, repo: 'x/y', log: () => {}, agent: false })

test('una cadena buena se escribe entera, y repetirla NO es un error', async () => {
  const gh = fakeGitHub()
  const s = await makeService(gh)
  const chain = await goodChain()

  const a = await s.handle({ op: OP, chain })
  assert.equal(a.ok, true, a.error)
  assert.equal(a.written.length, 2)
  assert.equal(gh.files.size, 2)

  // Va a pasar de verdad: publica la cuenta y publica quien la verifica.
  const b = await s.handle({ op: OP, chain })
  assert.equal(b.ok, true)
  assert.equal(b.written.length, 0)
  assert.equal(b.alreadyPresent.length, 2)
  assert.equal(gh.files.size, 2, 'no se escribió nada nuevo')
})

test('lo que ya está publicado NO se puede pisar', async () => {
  const gh = fakeGitHub()
  const s = await makeService(gh)
  const chain = await goodChain()
  await s.handle({ op: OP, chain })
  const before = new Map(gh.files)

  // Alguien reenvía la misma cadena con el génesis manipulado.
  const tampered = [{ ...chain[0], iat: 1 }, chain[1]]
  await s.handle({ op: OP, chain: tampered })
  assert.deepEqual([...gh.files], [...before], 'el contenido publicado no cambió')
})

test('una cadena inválida se rechaza y no escribe nada', async () => {
  const gh = fakeGitHub()
  const s = await makeService(gh)
  const r = await s.handle({ op: OP, chain: [{ v: 1, seq: 1 }, { v: 1, seq: 2 }] })
  assert.equal(r.ok, false)
  assert.equal(gh.files.size, 0)
})

test('una petición rara no tumba al testigo', async () => {
  const s = await makeService(fakeGitHub())
  for (const m of [null, {}, { op: 'otra' }, { op: OP }]) {
    const r = await s.handle(m)
    assert.equal(r.ok, false, JSON.stringify(m))
  }
})

test('si GitHub falla, se contesta el fallo — no se dice que se publicó', async () => {
  const gh = fakeGitHub()
  gh.create = async () => { throw new Error('502 bad gateway') }
  const s = await makeService(gh)
  const r = await s.handle({ op: OP, chain: await goodChain() })
  assert.equal(r.ok, false)
  assert.match(r.error, /502/)
})

test('el cliente de GitHub traduce el 422 en «ya existe», no en un fallo', async () => {
  const gh = createGitHub({ token: 't', repo: 'a/b', fetch: async () => ({ status: 422, ok: false, text: async () => '' }) })
  await assert.rejects(() => gh.create('chains/aa/aa/1.json', '{}', 'm'), (e) => e instanceof AlreadyExists && e.code === 'already-exists')
})

test('la cuota corta a quien insiste, y no a quien deposita una vez', async () => {
  const gh = fakeGitHub()
  const s = await makeService(gh)
  const junk = { op: OP, chain: [{ v: 1, seq: 1 }, { v: 1, seq: 2 }] }

  let cutOff = 0
  for (let i = 0; i < QUOTA.perWindow + 5; i++) {
    const r = await s.handle(junk, 'el-pesado')
    if (r.code === 'rate-limited') cutOff++
  }
  assert.equal(cutOff, 5, 'corta pasada la cuota, no antes')

  // Y la cuota es POR REMITENTE: el que llega el primero no paga por el pesado.
  const other = await s.handle({ op: OP, chain: await goodChain() }, 'otro')
  assert.equal(other.ok, true, other.error)
})
