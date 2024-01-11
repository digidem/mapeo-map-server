const test = require('tape')
const fs = require('fs')
const path = require('path')
const fastify = require('fastify').default
const StaticStylesPlugin = require('../../dist/static-styles').default

const fixturesPath = path.resolve(__dirname, '../fixtures', 'static-styles')

test('list static styles', async (t) => {
  const server = setup(t)

  const response = await server.inject({
    method: 'GET',
    url: '/',
  })

  t.is(response.statusCode, 200)

  const data = response.json()

  t.is(data.length, 2, 'data has expected number of items')
  t.deepEqual(
    data,
    [
      {
        id: 'sat-style',
        name: 'Satellite',
        url: 'http://localhost/sat-style',
      },
      {
        id: 'streets-sat-style',
        name: 'Mapbox Satellite Streets',
        url: 'http://localhost/streets-sat-style',
      },
    ],
    'data has expected shape'
  )
})

test('get style.json', async (t) => {
  const server = setup(t)

  const styleIds = fs.readdirSync(fixturesPath)

  const address = await server.listen(0)

  await Promise.all(
    styleIds.map(async (styleId) => {
      const rawStyleJson = fs.readFileSync(
        path.join(fixturesPath, styleId, 'style.json'),
        'utf-8'
      )

      const response = await server.inject({
        method: 'GET',
        url: `/${styleId}/style.json`,
      })

      t.is(response.statusCode, 200)

      const data = response.json()

      t.not(
        data,
        JSON.parse(rawStyleJson),
        'response data is different from raw style file content'
      )
      t.deepEqual(
        data,
        JSON.parse(rawStyleJson.replace(/\{host\}/gm, `${address}/${styleId}`)),
        'response data has correct'
      )
    })
  )
})

test('get sprite.json', async (t) => {
  const server = setup(t)

  const styleIds = fs.readdirSync(fixturesPath)

  await Promise.all(
    styleIds.map(async (styleId) => {
      const expectedJson = JSON.parse(
        fs.readFileSync(
          path.join(fixturesPath, styleId, 'sprites', 'sprite.json'),
          'utf-8'
        )
      )

      const response = await server.inject({
        method: 'GET',
        url: `/${styleId}/sprites/sprite.json`,
      })

      t.is(response.statusCode, 200)
      t.deepEqual(response.json(), expectedJson)
    })
  )
})

test('get tile (image)', async (t) => {
  const server = setup(t)

  const styleIds = fs.readdirSync(fixturesPath)

  await Promise.all(
    styleIds.map(async (styleId) => {
      t.test('non-existing tile', async (st) => {
        // With extension
        {
          const response = await server.inject({
            method: 'GET',
            url: `/${styleId}/tiles/mapbox.satellite/0/0/0.png`,
          })

          st.is(response.statusCode, 404)
        }

        // Without extension
        {
          const response = await server.inject({
            method: 'GET',
            url: `/${styleId}/tiles/mapbox.satellite/0/0/0`,
          })

          st.is(response.statusCode, 404)
        }
      })

      t.test('non-existing tile id', async (st) => {
        {
          const response = await server.inject({
            method: 'GET',
            url: `/${styleId}/tiles/foo.bar/6/10/24.png`,
          })

          st.is(response.statusCode, 404)
        }
      })

      t.test('existing tile', async (st) => {
        // With extension
        {
          const response = await server.inject({
            method: 'GET',
            url: `/${styleId}/tiles/mapbox.satellite/6/10/24.png`,
          })

          st.is(response.statusCode, 200)
          st.is(
            response.headers['content-type'],
            'image/png',
            'content type correct'
          )
          st.is(
            parseContentLength(response.headers['content-length']),
            21014,
            'correct content length'
          )
        }

        // Without extension
        {
          const response = await server.inject({
            method: 'GET',
            url: `/${styleId}/tiles/mapbox.satellite/6/10/24`,
          })

          st.is(response.statusCode, 200)
          st.is(
            response.headers['content-type'],
            'image/png',
            'content type correct'
          )
          st.is(
            parseContentLength(response.headers['content-length']),
            21014,
            'correct content length'
          )
        }
      })
    })
  )
})

test('get tile (pbf)', async (t) => {
  const server = setup(t)

  const response = await server.inject({
    method: 'GET',
    url: '/streets-sat-style/tiles/mapbox.mapbox-streets-v7/12/656/1582.vector.pbf',
  })

  t.is(response.statusCode, 200)

  // Currently fails because @fastify/static does not seem to call setHeaders() opt when using fastify.inject()
  // Tested in a browser and it works as expected
  //   t.is(
  //     response.headers['content-type'],
  //     'application/x-protobuf',
  //     'content type correct'
  //   )

  t.is(response.headers['content-encoding'], 'gzip', 'gzip encoding enabled')
  t.is(
    parseContentLength(response.headers['content-length']),
    49229,
    'correct file length'
  )
})

test('get font pbf', async (t) => {
  const server = setup(t)

  const response = await server.inject({
    method: 'GET',
    url: '/streets-sat-style/fonts/DIN Offc Pro Bold,Arial Unicode MS Bold/0-255.pbf',
  })

  t.is(response.statusCode, 200)

  // Currently fails because @fastify/static does not seem to call setHeaders() opt when using fastify.inject()
  // Tested in a browser and it works as expected
  //   t.is(
  //     response.headers['content-type'],
  //     'application/x-protobuf',
  //     'content type correct'
  //   )

  t.is(
    parseContentLength(response.headers['content-length']),
    75287,
    'correct file length'
  )
})

/**
 * @param {import('tape').Test} t
 */
function setup(t) {
  const server = fastify({ logger: false, forceCloseConnections: true })

  server.register(StaticStylesPlugin, {
    staticStylesDir: fixturesPath,
  })

  t.teardown(async () => {
    await server.close()
  })

  return server
}

/**
 * @param {string | number | undefined} value
 * @returns {number | undefined}
 */
function parseContentLength(value) {
  if (typeof value === 'number') return value
  if (typeof value === 'string') return parseInt(value, 10)
  return value
}
