import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { getPath: () => '' }, dialog: {}, shell: {}, BrowserWindow: class {}, safeStorage: { isEncryptionAvailable: () => false } }))

describe('Contrôle de qualité des cartes', () => {
  it('écarte les cartes à trous presque entièrement masquées (le bug des « […] » en pile)', async () => {
    const { goodCard } = await import('../src/main/cardquality')
    const garbage = '{{c1::Soit}} {{c2::f}} {{c3::une}} {{c4::application}} {{c5::de}} {{c6::E}} {{c7::dans}} {{c8::F}}'
    expect(goodCard({ kind: 'cloze', front: '', back: '', text: garbage })).toBe(false)
    expect(goodCard({ kind: 'cloze', front: '', back: '', text: 'Une application est {{c1::injective}} si deux éléments distincts ont des images distinctes.' })).toBe(true)
  })

  it('écarte les questions vides et le contenu pratique', async () => {
    const { goodCard } = await import('../src/main/cardquality')
    expect(goodCard({ kind: 'basic', front: 'Penser', back: 'Je pense', text: '' })).toBe(false)
    expect(goodCard({ kind: 'basic', front: 'Penser', back: 'Je pense', text: '' }, { vocabulary: true })).toBe(true)
    // Étiquettes de paragraphe et énoncés pris pour des questions (cartes vues dans la bibliothèque)
    expect(goodCard({ kind: 'basic', front: 'Remarque', back: 'Il s’agit donc d’une façon supplémentaire pour montrer que f est bijective', text: '' })).toBe(false)
    expect(goodCard({ kind: 'basic', front: 'A ⊂ B', back: 'A ∪ B = E', text: '' })).toBe(false)
    expect(goodCard({ kind: 'basic', front: 'Soit f : E → F . f est surjective si et seulement si f (E) = F .', back: 'Démonstration', text: '' })).toBe(false)
    expect(goodCard({ kind: 'basic', front: 'Quelle est la dérivée de $e^x$ ?', back: '$e^x$', text: '' })).toBe(true)
    expect(goodCard({ kind: 'basic', front: 'Qui est dans le groupe de colle 3 ?', back: 'Martin et Durand', text: '' })).toBe(false)
    expect(goodCard({ kind: 'basic', front: 'Que dit le théorème de Bayes ?', back: 'P(A|B) = P(B|A)P(A)/P(B)', text: '' })).toBe(true)
  })
})

describe('Tri des documents', () => {
  it('reconnaît les énoncés, corrigés et informations pratiques, accents compris', async () => {
    const { categoryFromName, fallbackChapter } = await import('../src/main/triage')
    expect(categoryFromName('corrigé Ecricome carte Brit 1913')).toBe('corrige')
    expect(categoryFromName('Colles semaine 4')).toBe('admin') // le programme de la semaine, pas un énoncé
    expect(categoryFromName('colle 16 oct - Hyrox')).toBe('exercices')
    expect(categoryFromName('Charte des devoirs surveillés')).toBe('admin')
    expect(categoryFromName('Exos systèmes linéaires')).toBe('exercices')
    expect(categoryFromName('Groupes de TD du 16 septembre')).toBe('admin')
    expect(categoryFromName('Programme de colles')).toBe('admin')
    expect(categoryFromName('méthode dissertation')).toBe('methode')
    expect(categoryFromName('Fin du cours ensembles et applications')).toBe('cours')
    expect(categoryFromName('Ensembles et applications')).toBeNull()
    expect(fallbackChapter('Exercices ensembles et applications', 'Distanciel')).toBe('Ensembles et applications')
    expect(fallbackChapter('Fin du cours ensembles et applications', 'Distanciel')).toBe('Ensembles et applications')
    expect(fallbackChapter('doc 3', 'SEQUENCE 1 - Brave New World')).toBe('SEQUENCE 1 - Brave New World')
    expect(fallbackChapter('cours 12 crise 1929', 'Chap 1')).toBe('Crise 1929')
    expect(fallbackChapter('urban5', 'SEQUENCE 1')).toBe('Urban')
    expect(fallbackChapter('LA CONJUGAISON DU VERBE WISSEN', 'x')).toBe('La conjugaison du verbe wissen')
  })
})

describe('Tri par dossier et par contenu', () => {
  it('écarte les sujets et corrigés de DS même sans mot-clé dans le titre', async () => {
    const { triageDocument, categoryFromFolder, categoryFromText } = await import('../src/main/triage')
    expect(categoryFromFolder('DS de l’année dernière')).toBe('exercices')
    expect(categoryFromFolder('Réponses aux exercices')).toBe('corrige')
    expect(categoryFromFolder('Chap 1')).toBeNull()
    expect(categoryFromText('ECRICOME 2023 — Épreuve de mathématiques. Durée : 4 heures. Calculatrice interdite.')).toBe('exercices')
    expect(categoryFromText('Corrigé du DS 2. Exercice 1 : on a...')).toBe('corrige')
    expect(categoryFromText('Soit f une application de E dans F. Définition : f est injective si…')).toBeNull()
    const long = 'Texte du document. '.repeat(30)
    expect((await triageDocument({ title: 'Ensembles et applications', subject: 'Maths', folder: 'Réponses aux exercices', text: long }, [])).category).toBe('corrige')
    expect((await triageDocument({ title: 'doc 4', subject: 'Maths', folder: 'Divers', text: 'Durée : 4 h. Calculatrice interdite. ' + long }, [])).category).toBe('exercices')
    // un titre qui annonce un cours ou une méthode n'est jamais écarté à cause du dossier
    const { categoryFromName } = await import('../src/main/triage')
    expect(categoryFromName('Méthode dissertation')).toBe('methode')
  })
})

describe('Extraction des maths', () => {
  it('garde les exposants et les indices du PDF', async () => {
    const { pageText } = await import('../src/main/ai')
    const items = [
      { str: 'Soit x', transform: [10, 0, 0, 10, 0, 100] },
      { str: '2', transform: [6, 0, 0, 6, 40, 104] },
      { str: ' + u', transform: [10, 0, 0, 10, 46, 100] },
      { str: 'n', transform: [6, 0, 0, 6, 70, 97] },
      { str: ' = 1', transform: [10, 0, 0, 10, 76, 100], hasEOL: true },
      { str: 'Ligne suivante', transform: [10, 0, 0, 10, 0, 85] }
    ]
    expect(pageText(items)).toBe('Soit x^{2} + u_{n} = 1' + String.fromCharCode(10) + 'Ligne suivante')
  })
})

describe('Accents des PDF LaTeX', () => {
  it('recompose les accents écrits avant la lettre', async () => {
    const { fixAccents } = await import('../src/main/ai')
    expect(fixAccents('D´emonstration. Th´eor`eme : fa¸con, ant´ec´edent, ´enonc´e, `a')).toBe('Démonstration. Théorème : façon, antécédent, énoncé, à')
  })
})

describe('Réponses tronquées du modèle', () => {
  it('récupère les cartes complètes d’un JSON coupé en plein milieu', async () => {
    const { salvageObjects } = await import('../src/main/ai')
    const cut = '{"cards":[{"type":"basic","front":"Quelle est la définition d’une injection ?","back":"Deux éléments distincts ont des images distinctes.","text":"","extra":""},{"type":"basic","front":"Que dit le théo'
    const found = salvageObjects(cut)
    expect(found).toHaveLength(1)
    expect(found[0].front).toContain('injection')
  })
})

describe('Doublons', () => {
  it('voit qu’un texte republié avec de petites retouches est le même document', async () => {
    const { similarity } = await import('../src/main/dedupe')
    const base = Array.from({ length: 120 }, (_, i) => `mot${i}`).join(' ')
    const retouched = base.replace('mot10', 'modifié').replace('mot90', 'autre')
    const other = Array.from({ length: 120 }, (_, i) => `texte${i}`).join(' ')
    expect(similarity(base, retouched)).toBeGreaterThan(0.8)
    expect(similarity(base, other)).toBeLessThan(0.1)
  })
})
