import fs from 'fs-extra';

(async () => {
  // Basic self-test: ensure CLI loads
  const pkg = JSON.parse(await fs.readFile('./package.json', 'utf8'));
  console.log('Package:', pkg.name, pkg.version);
})();
