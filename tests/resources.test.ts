import { describe, expect, it } from 'vitest'
import { RESOURCES, RESOURCE_CATEGORIES, cleanUrl, searchResources } from '../src/shared/resources'

describe('Catalogue de ressources', () => {
  it('est cohérent : identifiants uniques, adresses https valides, catégories connues', () => {
    expect(new Set(RESOURCES.map((r) => r.id)).size).toBe(RESOURCES.length)
    for (const r of RESOURCES) {
      expect(new URL(r.url).protocol).toBe('https:')
      expect(RESOURCE_CATEGORIES.some((c) => c.id === r.cat)).toBe(true)
      expect(r.title.length).toBeGreaterThan(1)
      expect(r.desc.length).toBeGreaterThan(10)
    }
    expect(RESOURCES.length).toBeGreaterThanOrEqual(40)
  })

  it('contient les sources demandées (PyCime, Basthon, Thonny, Mathraining, géopolitique, annales, concours ECG)', () => {
    const ids = RESOURCES.map((r) => r.id)
    expect(ids).toEqual(expect.arrayContaining(['pycime', 'basthon', 'thonny', 'mathraining', 'geoconf', 'exo7', 'bce', 'ccinp', 'ecricome', 'majorprepa']))
    expect(ids).not.toContain('psim')
    expect(RESOURCES.find((r) => r.id === 'pycime')?.url).toBe('https://www.pycime.fr')
    expect(RESOURCES.find((r) => r.id === 'pycime')?.unchecked).toBeUndefined()
  })

  it('retrouve les sources par ce qu’on cherche (même avec la faute « mattraining »)', () => {
    expect(searchResources(RESOURCES, 'mattraining', '').map((r) => r.id)).toContain('mathraining')
    expect(searchResources(RESOURCES, 'éditeur', 'python').map((r) => r.id)).toEqual(expect.arrayContaining(['basthon', 'thonny']))
    expect(searchResources(RESOURCES, 'règlement', 'concours').map((r) => r.id)).toEqual(expect.arrayContaining(['bce', 'ecricome']))
    expect(searchResources(RESOURCES, 'méthodologie', '').map((r) => r.id)).toContain('majorprepa')
  })

  it('cherche sans tenir compte des accents ni de la casse, et filtre par catégorie', () => {
    expect(searchResources(RESOURCES, 'GEOPOLITIQUE', '').map((r) => r.id)).toEqual(expect.arrayContaining(['geoconf', 'diploweb']))
    expect(searchResources(RESOURCES, 'géopolitique', 'maths')).toEqual([])
    expect(searchResources(RESOURCES, 'python exercices', '').length).toBeGreaterThan(0)
    expect(searchResources(RESOURCES, '', 'concours').every((r) => r.cat === 'concours')).toBe(true)
    expect(searchResources(RESOURCES, 'zzzzzz', '')).toEqual([])
  })

  it('n’accepte pour une source perso que des adresses https', () => {
    expect(cleanUrl('exemple.fr/page')).toBe('https://exemple.fr/page')
    expect(cleanUrl('https://exemple.fr')).toBe('https://exemple.fr/')
    expect(cleanUrl('http://exemple.fr')).toBeNull()
    expect(cleanUrl('javascript:alert(1)')).toBeNull()
    expect(cleanUrl('file:///etc/passwd')).toBeNull()
    expect(cleanUrl('')).toBeNull()
  })
})
