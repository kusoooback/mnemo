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

  it('contient les sources demandées (psim.fr pour Python, géopolitique, annales)', () => {
    const ids = RESOURCES.map((r) => r.id)
    expect(ids).toEqual(expect.arrayContaining(['psim', 'geoconf', 'exo7', 'bce', 'ccinp']))
    expect(RESOURCES.find((r) => r.id === 'psim')?.unchecked).toBe(true)
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
