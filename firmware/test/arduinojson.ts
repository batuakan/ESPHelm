/**
 * ArduinoJson for the host-side C++ tests. Firmware builds use ESPHome's own copy (its `json`
 * component, 7.4.3); the tests compile with plain g++, so they fetch the same release into a
 * git-ignored cache on first use. ESPHELM_ARDUINOJSON=<dir containing ArduinoJson.h> uses a
 * copy you already have, for offline runs.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, renameSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const VERSION = '7.4.3';
/** The commit tag v7.4.3 points at; the clone is refused if it is anything else. */
const COMMIT = '77771d3c07668e01d8f52acb03910c1110bb373f';
const URL = 'https://github.com/bblanchon/ArduinoJson';

const CACHE = join(dirname(fileURLToPath(import.meta.url)), '.cache');

/** The directory to pass to `g++ -I`: it holds ArduinoJson.h. */
export function arduinoJsonSrc(): string {
  const own = process.env.ESPHELM_ARDUINOJSON;
  if (own) {
    if (!existsSync(join(own, 'ArduinoJson.h'))) {
      throw new Error(`ESPHELM_ARDUINOJSON=${own} has no ArduinoJson.h`);
    }
    return own;
  }
  const dir = join(CACHE, `ArduinoJson-${VERSION}`);
  const src = join(dir, 'src');
  if (existsSync(join(src, 'ArduinoJson.h'))) return src;

  mkdirSync(CACHE, { recursive: true });
  const tmp = `${dir}.partial`;
  rmSync(tmp, { recursive: true, force: true });
  try {
    execFileSync('git', ['clone', '--quiet', '--depth', '1', '--branch', `v${VERSION}`, URL, tmp], {
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    const got = execFileSync('git', ['-C', tmp, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    if (got !== COMMIT) throw new Error(`v${VERSION} is ${got}, expected ${COMMIT}`);
  } catch (e) {
    rmSync(tmp, { recursive: true, force: true });
    throw new Error(
      `Could not fetch ArduinoJson ${VERSION} from ${URL}: ${(e as Error).message}\n` +
        'Offline? Set ESPHELM_ARDUINOJSON to a directory that holds ArduinoJson.h (7.4.x).',
    );
  }
  rmSync(dir, { recursive: true, force: true });
  renameSync(tmp, dir);
  return src;
}
