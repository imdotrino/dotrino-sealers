/**
 * QUÉ ENTRA EN EL REGISTRO Y QUÉ NO.
 *
 * Lo que estas pruebas fijan, en una frase: el registro **no puede mentir**. Acepta o
 * rechaza, y lo que acepta se verifica solo contra el génesis de su propia identidad — así
 * que ni siquiera un registro comprometido puede inventar que alguien sella por ti.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { genesisActa, sealActa, applyChanges, actaHash, sealerLinkOf } from '@dotrino/identity/acta'
import { makeDeviceKey, signWithDevice } from '@dotrino/identity/capabilities'
import { validateChain, pathOf, idOf } from '../src/validate.js'

const seal = (acta, k) => sealActa({ acta, privateJwk: k.privateJwk })

/**
 * Una cuenta con su bóveda A y, si se pide, una segunda B con permiso de sellar.
 *
 * Lo que se publica NO son las actas sino sus ESLABONES (`sealerLinkOf`): ocho campos que
 * no dicen nada de los aparatos. Las actas se quedan aquí, que es su sitio.
 */
async function account ({ withSecond = true } = {}) {
  const A = await makeDeviceKey()
  const B = await makeDeviceKey()
  const genesis = await seal(genesisActa({ pub: A.publickey, label: 'A' }), A)
  if (!withSecond) return { A, B, genesis, chain: [sealerLinkOf(genesis)] }
  let two = await applyChanges(genesis, [
    { op: 'admit', member: { pub: B.publickey, label: 'B', caps: ['sign', 'sealer'] } }
  ], { by: A.publickey })
  two = await seal(two, A)
  return { A, B, genesis, two, chain: [sealerLinkOf(genesis), sealerLinkOf(two)] }
}

test('una cadena legítima entra, y solo escribe los eslabones', async () => {
  const { genesis, chain } = await account()
  const r = await validateChain(chain)
  assert.equal(r.ok, true, r.error)
  assert.equal(r.profileId, genesis.profileId)
  assert.equal(r.files.length, 2, 'el génesis y la entrada de la segunda bóveda')
  assert.equal(r.files[0].path, pathOf(await idOf(genesis.profileId), 1))
})

/**
 * UNA CUENTA NORMAL NO APARECE. No es por ahorrar espacio: una sola bóveda no puede
 * cambiar de selladores —no puede quitarse el permiso a sí misma y no hay otro que se lo
 * quite— así que no hay NADA que pueda quedar obsoleto. Admitirla convertiría el registro
 * en un directorio de identidades, que es justo lo que no debe ser.
 */
test('un génesis suelto NO se admite: no hay nada que refrescar', async () => {
  const { chain } = await account({ withSecond: false })
  const r = await validateChain(chain)
  assert.equal(r.ok, false)
  assert.equal(r.code, 'single-link')
})

test('un eslabón fabricado para el profileId de otro NO entra', async () => {
  const { genesis } = await account({ withSecond: false })
  const bad = await makeDeviceKey()
  // Con tu `profileId` —que es público— alguien firma un eslabón donde él sella. Verifica
  // solo (está firmado, por él), y por eso el registro no se fía de un eslabón suelto: lo
  // ancla al génesis, que solo puede autofirmar la llave que da nombre al perfil.
  const body = { v: 1, profileId: genesis.profileId, seq: 9, by: bad.publickey, sealers: [bad.publickey], prev: { seq: 1, hash: 'a'.repeat(64) }, iat: Date.now() }
  const forged = { ...body, sig: (await signWithDevice({ privateJwk: bad.privateJwk, data: body })).signature }

  const r = await validateChain([sealerLinkOf(genesis), forged])
  assert.equal(r.ok, false)
  assert.match(r.error, /no-encadena|sellador-no-autorizado/)
})

test('un ACTA se rechaza diciendo por qué: lleva dentro tus aparatos', async () => {
  const { genesis, two } = await account()
  const r = await validateChain([genesis, two])
  assert.equal(r.ok, false)
  assert.equal(r.code, 'acta-not-link')
})

test('una cadena que no empieza en el génesis no entra', async () => {
  const { two } = await account()
  const r = await validateChain([sealerLinkOf(two)])
  assert.equal(r.ok, false)
})

test('lo que se escribe no lleva NADA de los aparatos', async () => {
  const A = await makeDeviceKey()
  const B = await makeDeviceKey()
  const g = await seal(genesisActa({ pub: A.publickey, label: 'el-portátil' }), A)
  let two = await applyChanges(g, [
    { op: 'admit', member: { pub: B.publickey, label: 'servidor', cn: 'eco', caps: ['sign', 'sealer'] } }
  ], { by: A.publickey })
  two = await seal(two, A)

  const r = await validateChain([sealerLinkOf(g), sealerLinkOf(two)])
  assert.equal(r.ok, true, r.error)
  const written = r.files.map((a) => a.content).join('')
  for (const x of ['el-portátil', 'servidor', 'eco', 'members', 'keyring', 'card']) {
    assert.ok(!written.includes(x), `no se escribe: ${x}`)
  }
})

test('basura y tamaños absurdos se rechazan sin reventar', async () => {
  for (const x of [null, [], 'texto', [{}], [{ seq: 1 }]]) {
    const r = await validateChain(x)
    assert.equal(r.ok, false, JSON.stringify(x))
  }
  const tooLong = new Array(200).fill({ v: 1, seq: 1 })
  assert.equal((await validateChain(tooLong)).code, 'too-many-links')
})

test('la ruta reparte por los dos primeros caracteres', () => {
  assert.equal(pathOf('6f3a1b2c', 12), 'chains/6f/6f3a1b2c/12.json')
})
