// @ts-check
const test = require('tape')
const { ExhaustivenessError } = require('../../dist/lib/utils')

test('ExhaustivenessError', (t) => {
  t.plan(1)

  const bools = [true, false]
  t.doesNotThrow(() => {
    bools.forEach((bool) => {
      switch (bool) {
        case true:
        case false:
          break
        default:
          throw new ExhaustivenessError(bool)
      }
    })
  })
})
