const test = require('tape')
const { parseSpriteName } = require('../../dist/lib/sprites')

/**
 * @param {string} id
 * @param {number} density
 * @returns {string}
 */
function createSpriteNameFixture(id, density) {
  return `${id}${density ? `@${density}x` : ''}`
}

test('parseSpriteUrlName', (t) => {
  t.test('works when no density is specified', (st) => {
    const expectedId = 'abc123'
    const expectedDensity = 1

    const result = parseSpriteName(
      createSpriteNameFixture(expectedId, expectedDensity)
    )

    st.equal(result.pixelDensity, expectedDensity)
    st.equal(result.id, expectedId)

    st.end()
  })

  t.test('works when density of integer is specified', (st) => {
    const expectedId = 'abc123'
    const expectedDensity = 2

    const result = parseSpriteName(
      createSpriteNameFixture(expectedId, expectedDensity)
    )

    st.equal(result.pixelDensity, expectedDensity)
    st.equal(result.id, expectedId)

    st.end()
  })

  t.test('works when density of float is specified', (st) => {
    const expectedId = 'abc123'
    const expectedDensity = 2.5

    const result = parseSpriteName(
      createSpriteNameFixture(expectedId, expectedDensity)
    )

    st.equal(result.pixelDensity, expectedDensity)
    st.equal(result.id, expectedId)

    st.end()
  })

  t.end()
})
