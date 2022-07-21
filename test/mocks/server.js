// src/mocks/server.js
const { setupServer } = require('msw/node')
const { handlers } = require('./handlers')

// This configures a request mocking server with the given request handlers.
module.exports.server = setupServer(...handlers)
