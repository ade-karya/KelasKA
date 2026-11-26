import fs from 'node:fs';
import path from 'node:path';

const LOCALES_DIR = path.join(process.cwd(), 'lib', 'i18n', 'locales');
// English and Chinese are the two upstream source locales: a key must exist in
// both before any other locale is asked to carry it. Keeping the two in
// lockstep here means an upstream rename/removal cannot leave one of them
// behind as an unnoticed "source of truth".
const SOURCE_LOCALES = ['en-US.json', 'zh-CN.json'];

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function formatPath(keyPath) {
  return keyPath || '<root>';
}

function collectLeafKeys(value, fileName, keyPath = '', keys = new Set()) {
  if (Array.isArray(value)) {
    throw new Error(
      `${fileName} has an array at "${formatPath(keyPath)}". Locale values must not be arrays.`,
    );
  }

  if (isPlainObject(value)) {
    const entries = Object.entries(value);
    if (entries.length === 0) {
      throw new Error(
        `${fileName} has an empty object at "${formatPath(keyPath)}". Locale objects must not be empty.`,
      );
    }
    for (const [key, child] of entries) {
      collectLeafKeys(child, fileName, keyPath ? `${keyPath}.${key}` : key, keys);
    }
    return keys;
  }

  if (!keyPath) throw new Error(`${fileName} must contain a JSON object at the root.`);
  keys.add(keyPath);
  return keys;
}

function readLocaleKeys(fileName) {
  const parsed = JSON.parse(fs.readFileSync(path.join(LOCALES_DIR, fileName), 'utf8'));
  if (!isPlainObject(parsed)) {
    throw new Error(`${fileName} must contain a JSON object at the root.`);
  }
  return [...collectLeafKeys(parsed, fileName)].sort();
}

function compare(reference, candidate) {
  const referenceSet = new Set(reference);
  const candidateSet = new Set(candidate);
  return {
    missing: reference.filter((key) => !candidateSet.has(key)),
    extra: candidate.filter((key) => !referenceSet.has(key)),
  };
}

function main() {
  const localeFiles = fs
    .readdirSync(LOCALES_DIR)
    .filter((name) => name.endsWith('.json'))
    .sort();

  for (const source of SOURCE_LOCALES) {
    if (!localeFiles.includes(source)) throw new Error(`Missing source locale: ${source}`);
  }

  const reference = readLocaleKeys(SOURCE_LOCALES[0]);
  const reports = [];

  // The two sources must describe the same catalogue, in both directions.
  for (const source of SOURCE_LOCALES.slice(1)) {
    const diff = compare(reference, readLocaleKeys(source));
    if (diff.missing.length || diff.extra.length) {
      reports.push({ label: `${source} vs ${SOURCE_LOCALES[0]}`, ...diff });
    }
  }

  for (const localeFile of localeFiles) {
    const diff = compare(reference, readLocaleKeys(localeFile));
    if (diff.missing.length || diff.extra.length) {
      reports.push({ label: `${localeFile} vs ${SOURCE_LOCALES[0]}`, ...diff });
    }
  }

  if (reports.length === 0) {
    console.log(
      `i18n key alignment check passed (${localeFiles.length} locale files, sources: ${SOURCE_LOCALES.join(' + ')}).`,
    );
    return;
  }

  console.error(`i18n key alignment check failed against ${SOURCE_LOCALES.join(' + ')}:`);
  for (const report of reports) {
    console.error(`\n- ${report.label}`);
    if (report.missing.length) {
      console.error(`  Missing keys (${report.missing.length}):`);
      for (const key of report.missing) console.error(`    - ${key}`);
    }
    if (report.extra.length) {
      console.error(`  Extra keys (${report.extra.length}):`);
      for (const key of report.extra) console.error(`    - ${key}`);
    }
  }
  process.exit(1);
}

main();
