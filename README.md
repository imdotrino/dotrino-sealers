# @dotrino/sealers — el registro público de cadenas de selladores

Un **testigo**: guarda, en un repo público que cualquiera puede clonar, los eslabones donde
cambia **quién puede sellar** el acta de una identidad. Sirve para responder una sola
pregunta, la que no se puede responder sin ayuda de nadie:

> Este documento lo firmó una llave que, según un acta que tengo del año pasado, podía
> firmar. ¿Sigue pudiendo? ¿O ese aparato ya no es de esa cuenta?

Documentación de uso: **<https://wiki.dotrino.com/vault/registro-selladores/>**.

## Qué se publica, y qué no

**No se publican las actas.** Un acta lleva dentro los aparatos de una persona con sus
nombres, qué servicios corre y cuándo entró cada uno: publicarla sería colgar el inventario
de una casa en un repo público. Y cambian con cada emparejamiento.

Lo que se publica es el subconjunto que casi nunca cambia: los eslabones con
`sealerChanged`, encadenados por `sealerAnchor` desde el génesis. Un usuario con una sola
bóveda **no aparece nunca** — no puede cambiar de selladores, así que no tiene nada que
pueda quedar obsoleto. Quien suma una segunda bóveda escribe una línea.

Cada identidad vive bajo el sha256 de su `profileId`:

```
chains/6f/6f3a…c1/1.json      ← el génesis
chains/6f/6f3a…c1/7.json      ← el eslabón donde entró la segunda bóveda
```

Eso no es privacidad —tu `profileId` viaja en cada firma tuya, así que quien te haya leído
puede calcular el nombre de tu carpeta— sino **no enumerabilidad**: quien clone el registro
entero no se lleva una lista de llaves públicas lista para correlacionar.

## Por qué se puede confiar en él sin confiar en él

**El registro no puede mentir.** Cada eslabón se verifica contra el génesis, que está
autofirmado por la llave que da nombre al perfil, y `verifySealerChain` comprueba la cadena
entera del lado de quien lee. Un registro comprometido no puede inventar que alguien sella
por ti: lo peor que puede hacer es **callarse**, y contra eso la defensa no es confiar más
en él sino que haya varios y se puedan comparar. Por eso el repo es público: un `git clone`
te convierte en testigo.

Y es **append-only por construcción**, no por una regla que alguien recuerde: el servicio
escribe con la API de contenidos de GitHub sin pasar `sha`, y ahí crear un archivo que ya
existe falla. Los PR pasan además por `scripts/validate-pr.mjs`, que rechaza cualquier
cosa que no sea añadir.

## Cómo se publica

Dos caminos, y el segundo existe porque el primero no debe ser obligatorio:

1. **Por el proxio** (lo normal). Se manda `{ op: 'sealers.publish', chain }` a la pubkey
   del testigo con `sendByPubkey`, y contesta con `sealers.publish.result`. **Puede
   publicar cualquiera** — un eslabón se verifica solo, así que depositarlo no es un
   privilegio sino un favor: si tu bóveda estaba apagada cuando tocaba, lo deposita después
   otro aparato tuyo o quien te verificó.

   Por eso el testigo **no** es un `startRemoteAgent`: un agente remoto verifica al cliente
   contra su propia cuenta, y aquí hace falta lo contrario. Escucha en el proxio
   identificado con su llave, y acepta de quien sea, con una cuota por remitente (20/min)
   que solo protege el trabajo de comprobar firmas y la cuota de la API de GitHub.
2. **Por PR**, a mano, añadiendo los archivos. El validador de CI comprueba lo mismo.

## Correr el testigo

```sh
npm i -g @dotrino/sealers
dotrino-sealers enroll "<invitación del vault>"
SEALERS_REPO=imdotrino/dotrino-sealers dotrino-sealers run
```

El token de GitHub **no va en el entorno ni en un `.env`**: sale de un cajón del vault
(`secret set sealers GITHUB_TOKEN <token>`), sellado a la llave de este servicio. Quitarle
el aparato le quita la escritura, sin tocar el servidor.

| Variable | |
|---|---|
| `SEALERS_REPO` | `owner/nombre` del repo del registro (requerido) |
| `SEALERS_NS` | cajón del vault del que sale el token (default: `sealers`) |
| `SEALERS_DIR` | dónde vive el enlace de este aparato |

## Desarrollo

```sh
npm install && npm test
```

MIT.
