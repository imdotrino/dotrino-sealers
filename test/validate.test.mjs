/**
 * QUÉ ENTRA EN EL REGISTRO Y QUÉ NO.
 *
 * Lo que estas pruebas fijan, en una frase: el registro **no puede mentir**. Acepta o
 * rechaza, y lo que acepta se verifica solo contra el génesis de su propia identidad — así
 * que ni siquiera un registro comprometido puede inventar que alguien sella por ti.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { genesisActa, sealActa, applyChanges, actaHash } from '@dotrino/identity/acta'
import { makeDeviceKey } from '@dotrino/identity/capabilities'
import { validarCadena, rutaDe, idDe } from '../src/validate.js'

const sellar = (acta, k) => sealActa({ acta, privateJwk: k.privateJwk })

/** Una cuenta con su bóveda A y, si se pide, una segunda B con permiso de sellar. */
async function cuenta ({ conSegunda = true } = {}) {
  const A = await makeDeviceKey()
  const B = await makeDeviceKey()
  const genesis = await sellar(genesisActa({ pub: A.publickey, label: 'A' }), A)
  if (!conSegunda) return { A, B, genesis, cadena: [genesis] }
  let dos = await applyChanges(genesis, [
    { op: 'admit', member: { pub: B.publickey, label: 'B', caps: ['sign', 'sealer'] } }
  ], { by: A.publickey })
  dos = await sellar(dos, A)
  return { A, B, genesis, dos, cadena: [genesis, dos] }
}

test('una cadena legítima entra, y solo escribe los eslabones', async () => {
  const { genesis, cadena } = await cuenta()
  const r = await validarCadena(cadena)
  assert.equal(r.ok, true, r.error)
  assert.equal(r.profileId, genesis.profileId)
  assert.equal(r.archivos.length, 2, 'el génesis y la entrada de la segunda bóveda')
  assert.equal(r.archivos[0].ruta, rutaDe(await idDe(genesis.profileId), 1))
})

/**
 * UNA CUENTA NORMAL NO APARECE. No es por ahorrar espacio: una sola bóveda no puede
 * cambiar de selladores —no puede quitarse el permiso a sí misma y no hay otro que se lo
 * quite— así que no hay NADA que pueda quedar obsoleto. Admitirla convertiría el registro
 * en un directorio de identidades, que es justo lo que no debe ser.
 */
test('un génesis suelto NO se admite: no hay nada que refrescar', async () => {
  const { cadena } = await cuenta({ conSegunda: false })
  const r = await validarCadena(cadena)
  assert.equal(r.ok, false)
  assert.match(r.error, /nada que refrescar/)
})

test('una cadena fabricada para el profileId de otro NO entra', async () => {
  const { genesis } = await cuenta({ conSegunda: false })
  const malo = await makeDeviceKey()
  // Con tu `profileId` —que es público— alguien fabrica un acta donde él sella. Verifica
  // sola (está firmada, por él), y por eso el registro NO puede fiarse de un acta suelta.
  const falsa = await sellar({
    ...genesis,
    seq: 9,
    prev: 'a'.repeat(64),
    sealedBy: malo.publickey,
    sealerAnchor: { seq: 1, hash: await actaHash(genesis) },
    sealerChanged: true,
    members: [{ pub: malo.publickey, encPub: null, label: 'yo', cn: null, caps: ['sign', 'sealer'], addedAt: Date.now(), cert: null }]
  }, malo)

  const r = await validarCadena([genesis, falsa])
  assert.equal(r.ok, false)
  assert.match(r.error, /sellador-no-autorizado/)
})

test('una cadena que no empieza en el génesis no entra', async () => {
  const { dos } = await cuenta()
  const r = await validarCadena([dos])
  assert.equal(r.ok, false)
})

test('basura y tamaños absurdos se rechazan sin reventar', async () => {
  for (const x of [null, [], 'texto', [{}], [{ seq: 1 }]]) {
    const r = await validarCadena(x)
    assert.equal(r.ok, false, JSON.stringify(x))
  }
  const larga = new Array(200).fill({ sealerChanged: true, seq: 1 })
  assert.match((await validarCadena(larga)).error, /demasiados eslabones/)
})

test('la ruta reparte por los dos primeros caracteres', () => {
  assert.equal(rutaDe('6f3a1b2c', 12), 'chains/6f/6f3a1b2c/12.json')
})
