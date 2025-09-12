import path from 'path';
import fs from 'fs-extra';
import { execa } from 'execa';
import zlib from 'zlib';

export async function importDb(siteDir) {
  const dumpGz = path.join(siteDir, '.cw/db.sql.gz');
  const dump = path.join(siteDir, '.cw/db.sql');
  let inputStream;
  if (await fs.pathExists(dumpGz)) {
    inputStream = fs.createReadStream(dumpGz).pipe(zlib.createGunzip());
  } else if (await fs.pathExists(dump)) {
    inputStream = fs.createReadStream(dump);
  } else {
    console.log('No DB dump found at .cw/db.sql[.gz]. Skipping import.');
    return;
  }

  // Determine DB name from .env if present
  let dbName = 'wordpress';
  const envPath = path.join(siteDir, '.env');
  if (await fs.pathExists(envPath)) {
    const env = await fs.readFile(envPath, 'utf8');
    const m = env.match(/DB_NAME=(.+)/);
    if (m) dbName = m[1].trim();
  }

  console.log(`Importing DB into '${dbName}' ...`);
  await execa('docker', ['compose', 'exec', '-T', 'db', 'sh', '-lc', `mysql -uroot -proot ${dbName}`], {
    cwd: siteDir,
    input: inputStream,
    stdio: ['pipe', 'inherit', 'inherit']
  });
  console.log('DB import complete.');
}
