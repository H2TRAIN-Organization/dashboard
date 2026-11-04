#!/usr/bin/env node
import { createDecipheriv, scrypt } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const KDF = { name: 'scrypt', N: 131072, r: 8, p: 1, keyLength: 32 };

/** Native Node recovery tool; never contacts a server or accepts a password in argv. */
export async function decryptLogicalCopyFile(envelope, password) {
  if (typeof password !== 'string' || password.length < 12 || password.length > 1024 || envelope?.format !== 'dashboard-encrypted-logical-copy' || envelope.version !== 1 || envelope.cipher !== 'aes-256-gcm' || JSON.stringify(envelope.kdf) !== JSON.stringify(KDF)) throw new Error('Invalid copy format or password.');
  const salt = Buffer.from(envelope.salt, 'base64'), nonce = Buffer.from(envelope.nonce, 'base64'), tag = Buffer.from(envelope.tag, 'base64');
  if (salt.length !== 32 || nonce.length !== 12 || tag.length !== 16) throw new Error('Invalid copy format.');
  const key = await new Promise((resolve, reject) => scrypt(password, salt, 32, { N: KDF.N, r: KDF.r, p: KDF.p, maxmem: 256 * 1024 * 1024 }, (error, derived) => error ? reject(error) : resolve(derived)));
  try {
    const header = { format: envelope.format, version: envelope.version, cipher: envelope.cipher, kdf: KDF, salt: envelope.salt, nonce: envelope.nonce };
    const cipher = createDecipheriv('aes-256-gcm', key, nonce);
    cipher.setAAD(Buffer.from(JSON.stringify(header)));
    cipher.setAuthTag(tag);
    const plaintext = Buffer.concat([cipher.update(Buffer.from(envelope.ciphertext, 'base64')), cipher.final()]).toString('utf8');
    JSON.parse(plaintext); // Validate before creating any output file.
    return plaintext;
  } finally { key.fill(0); }
}

function askPassword() {
  if (!process.stdin.isTTY) throw new Error('Use an interactive terminal for the hidden password prompt.');
  process.stderr.write('Copy password (hidden): ');
  return new Promise((resolve, reject) => {
    let password = '';
    process.stdin.setRawMode(true);
    process.stdin.setEncoding('utf8');
    process.stdin.resume();
    const finish = () => { process.stdin.setRawMode(false); process.stdin.pause(); process.stdin.off('data', onData); process.stderr.write('\n'); };
    const onData = chunk => {
      for (const character of chunk) {
        if (character === '\u0003') { finish(); reject(new Error('Cancelled.')); return; }
        if (character === '\r' || character === '\n') { finish(); resolve(password); password = ''; return; }
        if (character === '\u007f' || character === '\b') password = Array.from(password).slice(0, -1).join('');
        else if (character >= ' ' && password.length < 1024) password += character;
      }
    };
    process.stdin.on('data', onData);
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const [input, output, ...extra] = process.argv.slice(2);
    if (!input || !output || extra.length) throw new Error('Usage: node scripts/decrypt-logical-copy.mjs encrypted.json recovered.json');
    const envelope = JSON.parse(await readFile(input, 'utf8'));
    const password = await askPassword();
    const plaintext = await decryptLogicalCopyFile(envelope, password);
    await writeFile(output, plaintext, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
    process.stderr.write('Logical copy decrypted. No database changes were made.\n');
  } catch {
    process.stderr.write('Recovery failed: check arguments, format, password and that the output file does not already exist.\n');
    process.exitCode = 1;
  }
}
