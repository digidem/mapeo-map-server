import 'make-promises-safe'

import createMapServer from './src/app'

createMapServer({ storagePath: './example.db' })
  .listen(3000)
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
