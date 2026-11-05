// Tipos de los subpaths de pilares que usa este servicio y que se publican en JS sin .d.ts.
// Solo lo que se usa aquí, con la forma que documenta cada pilar en su JSDoc.

/** El enlace de este aparato con su bóveda (`@dotrino/remote-agent/link`). */
interface SealersDevice { publickey: string, privateJwk: JsonWebKey }
interface SealersLink {
  proxy: string
  iss: string
  device: SealersDevice
  cert: { seq?: number } & Record<string, unknown>
  enc?: unknown
}

declare module '@dotrino/remote-agent/link' {
  export function dataDir (name?: string): string
  export function loadLink (dir?: string): SealersLink | null
  export function saveLink (dir: string, link: SealersLink): void
  export function enroll (args: {
    qr: string, label?: string, dir?: string, ns?: string | null,
    onChallenge?: (c: { deviceId: string, code: string }) => void, timeoutMs?: number
  }): Promise<SealersLink>
}

declare module '@dotrino/remote-agent/node-globals' {
  export function installNodeGlobals (dir?: string): void
}

declare module '@dotrino/vault/service' {
  export interface UpdateInfo { version: string, from?: string }
  export interface UpdateHooks {
    mayUpdate (u: UpdateInfo): Promise<boolean>
    onUpdated (u: UpdateInfo): Promise<void>
    onNeedsRoot (u: UpdateInfo): Promise<void>
  }
  export function vaultUpdateHooks (o: { product: string, log?: (m: string) => void } & Record<string, unknown>): UpdateHooks
  export function fetchSecrets (o: {
    ns: string, proxyUrl?: string, masterPubkey?: string, device?: SealersDevice,
    cert?: object, enc?: unknown, dir?: string, onCert?: (cert: SealersLink['cert']) => void
  }): Promise<Record<string, string>>
}

declare module '@dotrino/vault/device-info' {
  export function deviceInfo (link: SealersLink, extra?: Record<string, unknown>): Promise<Record<string, unknown>>
  export function formatDeviceInfo (info: Record<string, unknown>): string
}

declare module '@dotrino/update/npm' {
  export function updateStatusText (o: { dir: string, current: string, lang?: string }): string
  export function updatePrefsCommand (args: string[], o: { dir: string, lang?: string }):
    { handled: boolean, ok: boolean, text: string, prefs?: { approval: boolean, notify: boolean } }
  export function watchSelfUpdateNpm (o: {
    pkg: string, current: string, repo: string, dir?: string,
    mayUpdate?: (u: import('@dotrino/vault/service').UpdateInfo) => Promise<boolean>,
    onUpdated?: (u: import('@dotrino/vault/service').UpdateInfo) => Promise<void>,
    onNeedsRoot?: (u: import('@dotrino/vault/service').UpdateInfo) => Promise<void>,
    onInstalled?: (r: { version: string, from?: string, restart: boolean }) => unknown,
    log?: (m: string) => void
  }): () => void
}

declare module '@dotrino/identity/capabilities' {
  export function pubkeyId (publicJwk: string | JsonWebKey): Promise<string>
  export function signWithDevice (o: { privateJwk: JsonWebKey, data: unknown }): Promise<{ signature: string }>
}

declare module '@dotrino/identity/acta' {
  export function verifySealerLinkChain (chain: unknown[], o?: { expectedProfileId?: string | null }):
    Promise<{ ok: true, profileId: string, seq: number, sealers: string[] } | { ok: false, reason: string }>
}
