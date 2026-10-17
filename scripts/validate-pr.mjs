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
import { validateChain, pathOf } from '../src/validate.js'

const base = process.argv[2] || 'origin/main'
const git = (...a) => execFileSync('git', a, { encoding: 'utf8' }).trim()

const changes = git('diff', '--name-status', `${base}...HEAD`).split('\n').filter(Boolean)
  .map((l) => { const [status, ...rest] = l.split('\t'); return { status: status[0], path: rest[rest.length - 1] } })

const problems = []
const identities = new Set()

for (const { status, path } of changes) {
  if (!path.startsWith('chains/')) {
    // Fuera de `chains/` es el repo en sí (README, el propio validador): eso se revisa a
    // ojo como cualquier PR, no lo juzga este script.
    continue
  }
  if (path.endsWith('/.gitkeep')) continue
  if (status !== 'A') {
    problems.push(`${path}: ${status === 'D' ? 'deleted' : 'modified'} — the registry only accepts additions`)
    continue
  }
  const m = path.match(/^chains\/([0-9a-f]{2})\/([0-9a-f]{8,})\/(\d+)\.json$/)
  if (!m) { problems.push(`${path}: not a valid path (chains/<xx>/<id>/<seq>.json)`); continue }
  const [, prefix, id, seq] = m
  if (!id.startsWith(prefix)) { problems.push(`${path}: the prefix does not match the id`); continue }
  if (path !== pathOf(id, Number(seq))) { problems.push(`${path}: non-canonical path`); continue }
  identities.add(`${prefix}/${id}`)
}

// Cada identidad tocada se verifica ENTERA: los eslabones que ya estaban más los del PR.
for (const rel of identities) {
  const dir = `chains/${rel}`
  if (!existsSync(dir)) { problems.push(`${dir}: does not exist`); continue }
  const chain = readdirSync(dir).filter((f) => f.endsWith('.json'))
    .map((f) => ({ seq: Number(f.replace('.json', '')), f }))
    .sort((a, b) => a.seq - b.seq)
    .map(({ f }) => JSON.parse(readFileSync(`${dir}/${f}`, 'utf8')))

  const v = await validateChain(chain)
  if (!v.ok) { problems.push(`${dir}: ${v.error}`); continue }
  if (`chains/${rel}` !== pathOf(v.id, chain[0].seq).replace(/\/\d+\.json$/, '')) {
    problems.push(`${dir}: the folder does not match the chain profileId`)
    continue
  }
  console.log(`ok  ${dir}  (${chain.length} links, up to seq ${v.seq})`)
}

if (problems.length) {
  console.error('\nCannot accept:\n' + problems.map((p) => '  · ' + p).join('\n'))
  process.exit(1)
}
console.log(problems.length ? '' : `\n${identities.size} identity(ies) verified.`)
