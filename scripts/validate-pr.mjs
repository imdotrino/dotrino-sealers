#!/usr/bin/env node
/**
 * validate-pr.mjs — el portero de los PR.
 *
 * El servicio publica con su token y no pasa por aquí; esto es para cuando alguien deposita
 * un eslabón a mano (porque su bóveda estaba apagada, o porque prefiere no pedirle nada a
 * nadie). Comprueba dos cosas, y las dos importan:
 *
 *   1. QUE SOLO SE AÑADA. Modificar o borrar un eslabón publicado es lo único que
 *      convertiría este repo en algo en lo que no se puede confiar. El servicio no puede
 *      hacerlo (GitHub se niega a pisar sin `sha`); por PR hay que prohibirlo aquí.
 *   2. QUE LA CADENA VERIFIQUE, entera, desde su génesis. Un eslabón suelto y bien firmado
 *      no prueba nada: cualquiera firma un acta con tu `profileId` dentro.
 *
 * Se corre con la lista de archivos tocados por delante:  node scripts/validate-pr.mjs <base>
 */
import { execFileSync } from 'node:child_process'
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { validarCadena, rutaDe } from '../src/validate.js'

const base = process.argv[2] || 'origin/main'
const git = (...a) => execFileSync('git', a, { encoding: 'utf8' }).trim()

const cambios = git('diff', '--name-status', `${base}...HEAD`).split('\n').filter(Boolean)
  .map((l) => { const [estado, ...resto] = l.split('\t'); return { estado: estado[0], ruta: resto[resto.length - 1] } })

const problemas = []
const identidades = new Set()

for (const { estado, ruta } of cambios) {
  if (!ruta.startsWith('chains/')) {
    // Fuera de `chains/` es el repo en sí (README, el propio validador): eso se revisa a
    // ojo como cualquier PR, no lo juzga este script.
    continue
  }
  if (ruta.endsWith('/.gitkeep')) continue
  if (estado !== 'A') {
    problemas.push(`${ruta}: ${estado === 'D' ? 'borrado' : 'modificado'} — el registro solo admite añadir`)
    continue
  }
  const m = ruta.match(/^chains\/([0-9a-f]{2})\/([0-9a-f]{8,})\/(\d+)\.json$/)
  if (!m) { problemas.push(`${ruta}: no es una ruta válida (chains/<xx>/<id>/<seq>.json)`); continue }
  const [, prefijo, id, seq] = m
  if (!id.startsWith(prefijo)) { problemas.push(`${ruta}: el prefijo no coincide con el id`); continue }
  if (ruta !== rutaDe(id, Number(seq))) { problemas.push(`${ruta}: ruta no canónica`); continue }
  identidades.add(`${prefijo}/${id}`)
}

// Cada identidad tocada se verifica ENTERA: los eslabones que ya estaban más los del PR.
for (const rel of identidades) {
  const dir = `chains/${rel}`
  if (!existsSync(dir)) { problemas.push(`${dir}: no existe`); continue }
  const cadena = readdirSync(dir).filter((f) => f.endsWith('.json'))
    .map((f) => ({ seq: Number(f.replace('.json', '')), f }))
    .sort((a, b) => a.seq - b.seq)
    .map(({ f }) => JSON.parse(readFileSync(`${dir}/${f}`, 'utf8')))

  const v = await validarCadena(cadena)
  if (!v.ok) { problemas.push(`${dir}: ${v.error}`); continue }
  if (`chains/${rel}` !== rutaDe(v.id, cadena[0].seq).replace(/\/\d+\.json$/, '')) {
    problemas.push(`${dir}: la carpeta no corresponde al profileId de la cadena`)
    continue
  }
  console.log(`ok  ${dir}  (${cadena.length} eslabones, hasta seq ${v.seq})`)
}

if (problemas.length) {
  console.error('\nNo se puede aceptar:\n' + problemas.map((p) => '  · ' + p).join('\n'))
  process.exit(1)
}
console.log(problemas.length ? '' : `\n${identidades.size} identidad(es) verificada(s).`)
