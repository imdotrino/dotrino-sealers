/**
 * validate.js — QUÉ SE ACEPTA EN EL REGISTRO, y dónde cae.
 *
 * El registro guarda **solo los eslabones donde cambia quién sella** una identidad, nunca
 * las actas. Esa distinción es la que lo hace viable, y conviene entender por qué:
 *
 *   · un acta lleva dentro tus aparatos con sus NOMBRES, qué servicios corres y cuándo
 *     entró cada uno. Publicarla sería colgar el inventario de tu casa en un repo público;
 *   · y cambian con cada emparejamiento, así que el registro crecería sin parar.
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
import { verifySealerChain } from '@dotrino/identity/acta'
import { pubkeyId } from '@dotrino/identity/capabilities'

/** Un eslabón suelto no cabe en un JSON de cualquier tamaño: un acta ronda los 2 KB. */
export const MAX_ESLABON = 64 * 1024
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

  // AL MENOS DOS. Un génesis suelto no se admite y no es por ahorrar espacio: una cuenta
  // de una sola bóveda no tiene NADA que pueda quedar obsoleto —su conjunto de selladores
  // no puede cambiar— así que no hay nada que refrescar. Admitirla convertiría el registro
  // en un directorio de identidades, que es justo lo que no debe ser.
  const eslabones = chain.filter((a) => a?.sealerChanged)
  if (eslabones.length < 2) {
    return { ok: false, error: 'una cadena de un solo eslabón no tiene nada que refrescar: no se admite' }
  }

  const v = await verifySealerChain(chain)
  if (!v.ok) return { ok: false, error: 'cadena inválida: ' + v.reason }

  const id = await idDe(v.profileId)
  const archivos = []
  for (const a of eslabones) {
    const contenido = JSON.stringify(a, null, 2) + '\n'
    if (contenido.length > MAX_ESLABON) return { ok: false, error: `eslabón ${a.seq} demasiado grande` }
    archivos.push({ ruta: rutaDe(id, a.seq), contenido })
  }
  return { ok: true, id, profileId: v.profileId, seq: v.seq, archivos }
}
