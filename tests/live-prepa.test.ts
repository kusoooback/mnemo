import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { getPath: () => '' }, dialog: {}, shell: {}, BrowserWindow: class {}, safeStorage: { isEncryptionAvailable: () => false } }))

// Test réseau : ne tourne que si MNEMO_LIVE=1 (il interroge le vrai site public).
describe.runIf(process.env.MNEMO_LIVE === '1')('site réel (public)', () => {
  it('analyse le Cahier de Prépa sans connexion', async () => {
    const { fetchHttp, scanSite, eventKind } = await import('../src/main/prepa')
    const scan = await scanSite(fetchHttp(fetch), process.env.MNEMO_LIVE_URL ?? 'https://cahier-de-prepa.fr/ecg1-clemenceau/')
    console.log(JSON.stringify({ site: scan.siteName, subjects: scan.subjects.map((s) => s.name), docs: scan.docs.length, sample: scan.docs.slice(0, 5), events: scan.events.length, evSample: scan.events.filter((e) => eventKind(e.title)).slice(0, 5), protectedPages: scan.protectedPages, warnings: scan.warnings }, null, 1))
    expect(scan.subjects.length).toBeGreaterThan(0)
  }, 120000)
})
