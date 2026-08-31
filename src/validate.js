/**
 * validate.js — QUÉ SE ACEPTA EN EL REGISTRO, y dónde cae.
 *
 * El registro guarda **eslabones**, no actas. Y el eslabón no es un acta recortada: es un
 * documento propio, firmado aparte y metido DENTRO del acta antes de firmarla (identity
 * ≥ 0.72, `sealerLinkOf`). Lleva ocho campos y ninguno dice nada de tus aparatos.
 *
 * Esto costó una vuelta y conviene que quede escrito: al principio se publicaban «los
 * eslabones donde cambia quién sella», pero un eslabón ERA un acta entera, así que la
 * primera cadena que llegó al repo se fue con los `label` y los `cn` de cada aparato y el
 * llavero. Un acta lleva dentro el inventario de tu casa, y además cambia con cada
 * emparejamiento: no se publica, ni recortada — su firma la cubre entera.
 *
 * Lo que cambia casi nunca es quién puede sellar. Un usuario normal **no aparece jamás**
 * —una sola bóveda no puede cambiar de selladores— y quien suma una segunda escribe una
 * línea en su vida.
 *
 * Y lo que el registro NO puede hacer, que es lo que lo vuelve seguro tenerlo: **mentir**.
 * Cada eslabón se verifica contra el génesis, autofirmado por la llave que da nombre al
 * perfil. Lo peor que puede hacer un registro comprometido es callarse — y para eso la
 * defensa no es confiar más en él, es que haya varios y se puedan comparar.
 */
import { verifySealerLinkChain } from '@dotrino/identity/acta'
import { pubkeyId } from '@dotrino/identity/capabilities'

/** Un eslabón son ocho campos: 2 KB de sobra. El tope es contra el que mande basura. */
export const MAX_ESLABON = 8 * 1024
/** Y una cadena razonable no tiene cientos: cambiar de bóveda es raro. */
export const MAX_ESLABONES = 64

/** Dónde vive el eslabón `seq` de una identidad. Repartido por los dos primeros
 *  caracteres para no acabar con un directorio plano de miles de entradas. */
export function rutaDe (id, seq) {
  return `chains/${id.slice(0, 2)}/${id}/${seq}.json`
}

/** El identificador público de una identidad: el sha256 de su `profileId`.
 *
 *  No es privacidad —tu `profileId` viaja en cada firma tuya, así que quien te haya leído
 *  puede calcularlo— sino NO ENUMERABILIDAD: quien se descargue el registro entero no se
 *  lleva una lista de llaves públicas lista para correlacionar. */
export const idDe = (profileId) => pubkeyId(profileId)

/**
 * ¿Se acepta esta cadena? Devuelve los archivos a escribir, o por qué no.
 *
 * @returns {Promise<{ok:true, id:string, profileId:string, archivos:{ruta:string,contenido:string}[]}
 *                 | {ok:false, error:string}>}
 */
export async function validarCadena (chain) {
  if (!Array.isArray(chain) || !chain.length) return { ok: false, error: 'cadena vacía' }
  if (chain.length > MAX_ESLABONES) return { ok: false, error: `demasiados eslabones (máx ${MAX_ESLABONES})` }

  // NO SE ADMITE UN ACTA. Se dice con su nombre porque es el error que más va a pasar:
  // hasta identity 0.72 la cadena eran actas, y una lleva dentro tus aparatos. Si trae
  // `members`, el que la manda cree que está publicando poco y no lo está.
  if (chain.some((a) => a && (a.members || a.keyring || a.card))) {
    return { ok: false, error: 'esto es un acta, no un eslabón: lleva dentro tus aparatos. Publica `sealerLinkOf(acta)` (identity >= 0.72)' }
  }

  // AL MENOS DOS. Un génesis suelto no se admite y no es por ahorrar espacio: una cuenta
  // de una sola bóveda no tiene NADA que pueda quedar obsoleto —su conjunto de selladores
  // no puede cambiar— así que no hay nada que refrescar. Admitirla convertiría el registro
  // en un directorio de identidades, que es justo lo que no debe ser.
  if (chain.length < 2) {
    return { ok: false, error: 'una cadena de un solo eslabón no tiene nada que refrescar: no se admite' }
  }

  const v = await verifySealerLinkChain(chain)
  if (!v.ok) return { ok: false, error: 'cadena inválida: ' + v.reason }

  const id = await idDe(v.profileId)
  const archivos = []
  for (const a of chain) {
    const contenido = JSON.stringify(a, null, 2) + '\n'
    if (contenido.length > MAX_ESLABON) return { ok: false, error: `eslabón ${a.seq} demasiado grande` }
    archivos.push({ ruta: rutaDe(id, a.seq), contenido })
  }
  return { ok: true, id, profileId: v.profileId, seq: v.seq, archivos }
}
