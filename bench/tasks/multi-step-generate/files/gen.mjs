import { writeFileSync } from 'node:fs'
writeFileSync('data.json', JSON.stringify({ values: [10, 20, 30] }))
console.log('data.json written')
