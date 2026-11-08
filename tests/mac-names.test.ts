import { describe, expect, it } from 'vitest'
import { categoryFromFolder, categoryFromName, categoryFromText, fallbackChapter } from '../src/main/triage'

/** Sur Mac, un nom de fichier peut arriver en forme décomposée : « é » = « e » + accent combinant. */
describe('Noms et textes en forme décomposée (Mac)', () => {
  const nfd = (s: string): string => s.normalize('NFD')

  it('reconnaît corrigés et exercices comme en forme composée', () => {
    expect(nfd('Corrigé DS 1')).not.toBe('Corrigé DS 1')
    expect(categoryFromName(nfd('Corrigé DS 1'))).toBe('corrige')
    expect(categoryFromName(nfd('Feuille d’exercices 3'))).toBe('exercices')
    expect(categoryFromFolder(nfd('Mathématiques / DS / Corrigés'))).toBe('corrige')
  })

  it('reconnaît un sujet ou un corrigé d’après le début du texte', () => {
    expect(categoryFromText(nfd('Corrigé du devoir surveillé n°2\nExercice 1'))).toBe('corrige')
  })

  it('le chapitre déduit du titre est en forme composée', () => {
    expect(fallbackChapter(nfd('Dérivabilité'), '')).toBe('Dérivabilité')
  })
})
