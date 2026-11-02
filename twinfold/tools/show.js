// Print a chamber's map with coordinate rulers: node tools/show.js <levelNumber>
const LEVELS = require('../js/chambers.js');
const d = LEVELS[+process.argv[2] - 1];
const w = d.map[0].length;
let tens = '    ', ones = '    ';
for (let x = 0; x < w; x++) { tens += x % 10 === 0 ? String(Math.floor(x / 10) % 10) : ' '; ones += x % 10; }
console.log(d.name, w + 'x' + d.map.length);
console.log(tens); console.log(ones);
d.map.forEach((r, y) => console.log(String(y).padStart(3) + ' ' + r));
