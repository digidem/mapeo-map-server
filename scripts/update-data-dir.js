#!/usr/bin/env node

const fs = require('fs-extra')
const path = require('path')

const dataDir = path.resolve(__dirname, '../data')

fs.mkdirpSync(dataDir)

try {
  fs.copySync(
    path.resolve(__dirname, '../prisma/migrations'),
    path.resolve(dataDir, 'migrations')
  )
} catch (err) {
  console.log('Could not find prisma migrations directory 🤔')
  console.log(
    'Make sure you run `npm run prisma:migrate-dev -- --name MIGRATION_NAME_HERE` first!'
  )
  throw err
}
