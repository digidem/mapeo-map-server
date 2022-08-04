const test = require('tape')
const fs = require('fs')
const path = require('path')

const { isValidGlyphsRange } = require('../../dist/lib/glyphs')

/**
 * @param {number} factor
 * @returns {[number, number]}
 */
function createRange(factor) {
  if (factor < 0) throw new Error('Range factor must be >= 0')

  const start = 256 * factor
  const end = start + 255

  return [start, end]
}

test('isValidGlyphsRange', (t) => {
  t.test('returns false for any negative numbers', (st) => {
    st.notOk(isValidGlyphsRange(-1, -1), 'when start and end are negative')
    st.notOk(isValidGlyphsRange(-1, 1), 'when start is negative')
    st.notOk(isValidGlyphsRange(1, -1), 'when end is negative')

    st.end()
  })

  t.test('returns false for invalid positive values', (st) => {
    st.notOk(isValidGlyphsRange(10, 255), 'invalid start')
    st.notOk(isValidGlyphsRange(0, 10), 'invalid end')

    st.end()
  })

  t.test(
    'returns false for valid range that exceeds maximum range of 65280-65535',
    (st) => {
      const [start, end] = createRange(256)

      st.notOk(isValidGlyphsRange(start, end), `${start}-${end} is too large`)

      st.end()
    }
  )

  t.test(
    'returns true for valid ranges that do not exceed maximum range of 65280-65535',
    (st) => {
      const allValid = new Array(255).every((_, index) => {
        return isValidGlyphsRange(createRange(index))
      })

      st.ok(allValid, 'all ranges from factor 0 to 255 are valid')

      st.end()
    }
  )

  t.end()
})
