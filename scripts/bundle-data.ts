import fs from 'node:fs/promises';
import path from 'node:path';
import { domainToASCII } from 'node:url';
import { execSync } from 'node:child_process';

async function* walk(dir: string): AsyncGenerator<string> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else if (e.isFile()) yield p;
  }
}

function filePathToDomain(filePath: string, libDomainsRoot: string): string {
  const rel = path.relative(libDomainsRoot, filePath);
  const parts = rel.split(path.sep);
  const last = parts.pop()!;
  parts.push(last.replace(/\.txt$/i, ''));
  const domain = parts.reverse().join('.');
  return domainToASCII(domain.toLowerCase());
}

function parseSchoolFile(text: string): string[] {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'));
  return lines;
}

async function readSwot(swotRoot: string): Promise<{
  institutions: Map<string, string[]>;
  stoplist: Set<string>;
  tlds: Set<string>;
}> {
  const libDomains = path.join(swotRoot, 'lib', 'domains');
  await fs.access(libDomains);

  const institutions = new Map<string, string[]>();
  const stoplist = new Set<string>();
  const tlds = new Set<string>();

  try {
    const stoplistPath = path.join(libDomains, 'stoplist.txt');
    const stoplistContent = await fs.readFile(stoplistPath, 'utf8');
    for (const line of stoplistContent.split(/\r?\n/)) {
      const domain = line.trim().toLowerCase();
      if (domain && !domain.startsWith('#')) {
        stoplist.add(domain);
      }
    }
    console.log(`Loaded ${stoplist.size} stoplist entries`);
  } catch (error) {
    throw new Error(`Failed to read stoplist.txt: ${error}`);
  }

  try {
    const tldsPath = path.join(libDomains, 'tlds.txt');
    const tldsContent = await fs.readFile(tldsPath, 'utf8');
    for (const line of tldsContent.split(/\r?\n/)) {
      const tld = line.trim().toLowerCase();
      if (tld && !tld.startsWith('#')) {
        tlds.add(tld);
      }
    }
    console.log(`Loaded ${tlds.size} academic TLDs`);
  } catch (error) {
    throw new Error(`Failed to read tlds.txt: ${error}`);
  }

  for await (const file of walk(libDomains)) {
    if (!file.endsWith('.txt')) continue;
    if (path.basename(file) === 'stoplist.txt') continue;
    if (path.basename(file) === 'tlds.txt') continue;
    if (path.basename(file) === 'abused.txt') continue;

    const domain = filePathToDomain(file, libDomains);
    try {
      const content = await fs.readFile(file, 'utf8');
      const schoolNames = parseSchoolFile(content);
      if (schoolNames.length > 0 && !institutions.has(domain)) {
        institutions.set(domain, schoolNames);
      }
    } catch (error) {
      // log and continue
      console.warn(`Could not read file ${file}: ${error}`);
    }
  }

  return { institutions, stoplist, tlds };
}

interface SwotData {
  institutions: Record<string, string[]>;
  stoplist: string[];
  tlds: string[];
}

async function getSwotInfo(swotRoot: string) {
  try {
    const commit = execSync('git rev-parse HEAD', {
      cwd: swotRoot,
      encoding: 'utf8',
    }).trim();

    const date = execSync('git log -1 --format=%ci', {
      cwd: swotRoot,
      encoding: 'utf8',
    }).trim();

    const url = execSync('git remote get-url origin', {
      cwd: swotRoot,
      encoding: 'utf8',
    }).trim();

    return {
      commit,
      date,
      url: url || 'https://github.com/jetbrains/swot',
      updatedAt: new Date().toISOString(),
    };
  } catch (error) {
    // fallback to env vars if git commands fail
    return {
      commit: process.env.SWOT_COMMIT || 'unknown',
      date: process.env.SWOT_DATE || 'unknown',
      url: 'https://github.com/jetbrains/swot',
      updatedAt: new Date().toISOString(),
      error: 'Failed to get git info',
    };
  }
}

async function main() {
  const swotRoot = process.argv[2] || './swot';
  const outDir = process.argv[3] || './';

  console.log('Reading SWOT database...');
  const { institutions, stoplist, tlds } = await readSwot(swotRoot);
  console.log(`Found ${institutions.size} academic domains`);
  console.log(`Found ${stoplist.size} stoplist entries`);
  console.log(`Found ${tlds.size} academic TLDs`);

  console.log('Getting SWOT repository info...');
  const swotInfo = await getSwotInfo(swotRoot);

  const swotData: SwotData = {
    institutions: Object.fromEntries(institutions),
    stoplist: Array.from(stoplist),
    tlds: Array.from(tlds),
  };

  await fs.mkdir(outDir, { recursive: true });

  const outPath = path.join(outDir, 'data.json');
  await fs.writeFile(outPath, JSON.stringify(swotData), 'utf8');
  console.log(`Wrote data to ${outPath}`);

  const metadataPath = path.join(outDir, 'src', 'swot-metadata.ts');

  const tsContent = `// This file was automatically generated on ${new Date().toISOString()}
export const SWOT_METADATA = ${JSON.stringify(swotInfo)} as const;
`;

  await fs.writeFile(metadataPath, tsContent);
  console.log(`Wrote metadata to ${metadataPath}`);
}

main().catch((e) => {
  console.error(e?.message || e);
  process.exit(1);
});
