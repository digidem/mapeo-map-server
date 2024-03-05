// @ts-check
const assert = require('node:assert/strict')

/**
 * Wraps [Node's assert.rejects][0].
 *
 * This exists because:
 *
 * 1. Tape doesn't support it
 * 2. We eventually want to use Node's built-in test runner
 *
 * [0]: https://nodejs.org/api/assert.html#assertrejectsasyncfn-error-message
 *
 * @param {import('tape').Test} t
 * @param {Parameters<typeof assert.rejects>} args
 * @returns {Promise<void>}
 */
async function assertRejects(t, ...args) {
  await assert.rejects(...args)

  const lastArg = args[args.length - 1]
  const passMessage =
    typeof lastArg === 'string' ? lastArg : 'expected rejection'
  t.pass(passMessage)
}
exports.assertRejects = assertRejects
