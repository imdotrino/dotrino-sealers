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
import { validarCadena, rutaDe, idDe } from '../src/validate.js'

const sellar = (acta, k) => sealActa({ acta, privateJwk: k.privateJwk })

/**
 * Una cuenta con su bóveda A y, si se pide, una segunda B con permiso de sellar.
 *
 * Lo que se publica NO son las actas sino sus ESLABONES (`sealerLinkOf`): ocho campos que
 * no dicen nada de los aparatos. Las actas se quedan aquí, que es su sitio.
 */
async function cuenta ({ conSegunda = true } = {}) {
  const A = await makeDeviceKey()
  const B = await makeDeviceKey()
  const genesis = await sellar(genesisActa({ pub: A.publickey, label: 'A' }), A)
  if (!conSegunda) return { A, B, genesis, cadena: [sealerLinkOf(genesis)] }
  let dos = await applyChanges(genesis, [
    { op: 'admit', member: { pub: B.publickey, label: 'B', caps: ['sign', 'sealer'] } }
  ], { by: A.publickey })
  dos = await sellar(dos, A)
  return { A, B, genesis, dos, cadena: [sealerLinkOf(genesis), sealerLinkOf(dos)] }
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

test('un eslabón fabricado para el profileId de otro NO entra', async () => {
  const { genesis } = await cuenta({ conSegunda: false })
  const malo = await makeDeviceKey()
  // Con tu `profileId` —que es público— alguien firma un eslabón donde él sella. Verifica
  // solo (está firmado, por él), y por eso el registro no se fía de un eslabón suelto: lo
  // ancla al génesis, que solo puede autofirmar la llave que da nombre al perfil.
  const cuerpo = { v: 1, profileId: genesis.profileId, seq: 9, by: malo.publickey, sealers: [malo.publickey], prev: { seq: 1, hash: 'a'.repeat(64) }, iat: Date.now() }
  const falso = { ...cuerpo, sig: (await signWithDevice({ privateJwk: malo.privateJwk, data: cuerpo })).signature }

  const r = await validarCadena([sealerLinkOf(genesis), falso])
  assert.equal(r.ok, false)
  assert.match(r.error, /no-encadena|sellador-no-autorizado/)
})

test('un ACTA se rechaza diciendo por qué: lleva dentro tus aparatos', async () => {
  const { genesis, dos } = await cuenta()
  const r = await validarCadena([genesis, dos])
  assert.equal(r.ok, false)
  assert.match(r.error, /es un acta, no un eslabón/)
})

test('una cadena que no empieza en el génesis no entra', async () => {
  const { dos } = await cuenta()
  const r = await validarCadena([sealerLinkOf(dos)])
  assert.equal(r.ok, false)
})

test('lo que se escribe no lleva NADA de los aparatos', async () => {
  const A = await makeDeviceKey()
  const B = await makeDeviceKey()
  const g = await sellar(genesisActa({ pub: A.publickey, label: 'el-portátil' }), A)
  let dos = await applyChanges(g, [
    { op: 'admit', member: { pub: B.publickey, label: 'servidor', cn: 'eco', caps: ['sign', 'sealer'] } }
  ], { by: A.publickey })
  dos = await sellar(dos, A)

  const r = await validarCadena([sealerLinkOf(g), sealerLinkOf(dos)])
  assert.equal(r.ok, true, r.error)
  const escrito = r.archivos.map((a) => a.contenido).join('')
  for (const x of ['el-portátil', 'servidor', 'eco', 'members', 'keyring', 'card']) {
    assert.ok(!escrito.includes(x), `no se escribe: ${x}`)
  }
})

test('basura y tamaños absurdos se rechazan sin reventar', async () => {
  for (const x of [null, [], 'texto', [{}], [{ seq: 1 }]]) {
    const r = await validarCadena(x)
    assert.equal(r.ok, false, JSON.stringify(x))
  }
  const larga = new Array(200).fill({ v: 1, seq: 1 })
  assert.match((await validarCadena(larga)).error, /demasiados eslabones/)
})

test('la ruta reparte por los dos primeros caracteres', () => {
  assert.equal(rutaDe('6f3a1b2c', 12), 'chains/6f/6f3a1b2c/12.json')
})
