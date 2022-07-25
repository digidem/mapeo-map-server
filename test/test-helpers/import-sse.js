const EventSource = require('eventsource')

module.exports = importSse

/** @typedef {import('../../src/lib/mbtiles_import_worker').PortMessage} PortMessage */
/**
 * @param {string} endpoint
 * @returns {Promise<Array<PortMessage>>}
 */
async function importSse(endpoint) {
  /** @type {Array<PortMessage>} */
  const messages = []
  return new Promise((res, rej) => {
    const evtSource = new EventSource(endpoint)

    evtSource.onmessage = (event) => {
      /** @type {PortMessage} */
      const message = JSON.parse(event.data)
      messages.push(message)

      if (message.type === 'complete' || message.type === 'error') {
        evtSource.close()
        res(messages)
      }
    }

    evtSource.onerror = (ev) => {
      evtSource.close()
      rej({ errorEvent: ev, messages })
    }
  })
}
