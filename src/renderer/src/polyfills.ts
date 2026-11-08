/*
 * Compléments pour les fonctions JavaScript très récentes (« upsert » sur Map / WeakMap) que la bibliothèque de lecture
 * des PDF utilise et que le moteur d'Electron n'a pas encore.
 */
type Upsertable = {
  has(k: unknown): boolean
  get(k: unknown): unknown
  set(k: unknown, v: unknown): unknown
}
for (const ctor of [Map, WeakMap] as unknown as { prototype: Record<string, unknown> }[]) {
  const proto = ctor.prototype
  if (!('getOrInsert' in proto))
    Object.defineProperty(proto, 'getOrInsert', {
      configurable: true,
      writable: true,
      value(this: Upsertable, key: unknown, value: unknown) {
        if (!this.has(key)) this.set(key, value)
        return this.get(key)
      }
    })
  if (!('getOrInsertComputed' in proto))
    Object.defineProperty(proto, 'getOrInsertComputed', {
      configurable: true,
      writable: true,
      value(this: Upsertable, key: unknown, compute: (k: unknown) => unknown) {
        if (!this.has(key)) this.set(key, compute(key))
        return this.get(key)
      }
    })
}

// Math.sumPrecise (somme exacte) : utilisé par la bibliothèque PDF pour charger les polices.
if (!('sumPrecise' in Math)) {
  Object.defineProperty(Math, 'sumPrecise', {
    configurable: true,
    writable: true,
    value(values: Iterable<number>) {
      let sum = 0
      let c = 0
      for (const v of values) {
        const y = v - c
        const t = sum + y
        c = t - sum - y
        sum = t
      }
      return sum
    }
  })
}
