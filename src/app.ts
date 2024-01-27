import MapServer from './map-server'

function createServer(
  ...args: ConstructorParameters<typeof MapServer>
): MapServer {
  return new MapServer(...args)
}

export default createServer

module.exports = createServer
