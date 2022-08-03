const fs = require('fs')
const path = require('path')
const mkdirp = require('mkdirp')
const fontnik = require('fontnik')

const font = fs.readFileSync(
  path.join(__dirname, '../fonts/OpenSans/OpenSans-Regular.ttf')
)

const outDir = path.join(__dirname, '../sdf/Open-Sans-Regular')
mkdirp.sync(outDir)

generateSdf({ font, outDir })

async function generateSdf({ font, outDir }) {
  return new Promise((resolve, reject) => {
    for (let i = 0; i < 65536; i = i + 256) {
      const start = i
      const end = i + 255
      fontnik.range({ font, start, end }, (err, sdf) => {
        if (err) return reject(err)
        fs.writeFile(path.join(outDir, `${start}-${end}.pbf`), sdf, (err) => {
          if (err) return reject(err)
          resolve()
        })
      })
    }
  })
}
