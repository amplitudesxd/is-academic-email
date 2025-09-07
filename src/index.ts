import fs from 'node:fs';
import path from 'node:path';
import { brotliDecompressSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

type SwotDataPacked = {
  institutions: Record<string, string[]>;
  stoplist: string[];
  tlds: string[];
};

/**
 * Unpacked dataset used at runtime.
 *
 * @property {Map<string, string[]>} institutions Map from registered domain
 * (e.g., "stanford.edu") to one or more official institution names.
 * @property {Set<string>} stoplist Domains/subdomains that should not be considered academic.
 * @property {Set<string>} tlds Academic/public-suffix TLDs (e.g., "edu", "ac.uk").
 */
export type SwotData = {
  institutions: Map<string, string[]>;
  stoplist: Set<string>;
  tlds: Set<string>;
};

function loadData(): SwotData {
  const dataPath = path.join(__dirname, '..', 'data.json.br');

  let packed: SwotDataPacked;
  try {
    const compressed = fs.readFileSync(dataPath);
    const decompressed = brotliDecompressSync(compressed);
    packed = JSON.parse(decompressed.toString('utf8')) as SwotDataPacked;
  } catch {
    packed = { institutions: {}, stoplist: [], tlds: [] };
  }

  return {
    institutions: new Map(Object.entries(packed.institutions)),
    stoplist: new Set(packed.stoplist.map((s) => s.toLowerCase())),
    tlds: new Set(packed.tlds.map((s) => s.toLowerCase())),
  };
}

const DATA: SwotData = loadData();

function domainParts(emailOrDomain: string): string[] {
  const raw = emailOrDomain.trim().toLowerCase();
  const host = raw
    .substring(raw.indexOf('@') + 1)
    .replace(/^[a-z]+:\/\//, '')
    .replace(/^[^/]*@/, '')
    .split('/')[0]
    .split(':')[0];
  if (!host) return [];
  return host.split('.').reverse();
}

function checkSet(set: Set<string>, parts: string[]): boolean {
  let subj = '';
  for (const part of parts) {
    subj = subj ? `${part}.${subj}` : part;
    if (set.has(subj)) return true;
  }
  return false;
}

/**
 * Check if the host is under a known academic/public-suffix TLD
 * (e.g., "edu", "ac.uk").
 *
 * @param {string} emailOrDomain Email address, bare domain, or full URL.
 * @returns {boolean} True if any domain suffix matches a known academic TLD.
 * @example
 * isUnderTLD('prof@university.edu'); // true (if "edu" is in TLDs)
 */
export function isUnderTLD(emailOrDomain: string): boolean {
  return checkSet(DATA.tlds, domainParts(emailOrDomain));
}

/**
 * Check if the host is in the stoplist
 *
 * @param {string} emailOrDomain Email address, bare domain, or full URL.
 * @returns {boolean} True if any domain suffix is stoplisted.
 * @example
 * isStoplisted('user@stoplisted.edu'); // true (if "stoplisted.edu" is in stoplist)
 */
export function isStoplisted(emailOrDomain: string): boolean {
  return checkSet(DATA.stoplist, domainParts(emailOrDomain));
}

/**
 * Get institution names associated with the host.
 * Returns a new array; returns [] if none found.
 *
 * @param {string} emailOrDomain Email address, bare domain, or full URL.
 * @returns {string[]} Institution names for the first matching suffix.
 * @example
 * findSchoolNames('alice@cs.stanford.edu'); // ["Stanford University"]
 */
export function findSchoolNames(emailOrDomain: string): string[] {
  const parts = domainParts(emailOrDomain);
  let subj = '';
  for (const part of parts) {
    subj = subj ? `${part}.${subj}` : part;
    const names = DATA.institutions.get(subj);
    if (names && names.length) return names.slice();
  }
  return [];
}

/**
 * Check if an email address is an academic email address.
 *
 * @param {string} email Email address to test.
 * @returns {boolean} True if the email is valid and not stoplisted, and
 * either under a known academic TLD or associated with a known institution.
 * @example
 * isAcademic('jane.doe@ox.ac.uk'); // true (if "ac.uk" or domain is known)
 */
export function isAcademic(email: string): boolean {
  const valid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  if (!valid) return false;
  return (
    !isStoplisted(email) &&
    (isUnderTLD(email) || findSchoolNames(email).length > 0)
  );
}

/**
 * Metadata about the dataset (e.g., version and counts).
 *
 * @see ./swot-metadata.js
 */
export { SWOT_METADATA } from './swot-metadata.js';
