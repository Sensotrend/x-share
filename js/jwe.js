// Minimal JWE (compact serialization) decryption for SMART Health Links:
// alg "dir", enc "A256GCM", optional "zip": "DEF" (raw DEFLATE). It uses WebCrypto only.
import { b64urlToBytes, b64urlToString } from './util.js';

export async function decryptJwe(compact, keyB64url) {
  const parts = compact.split('.');
  if (parts.length !== 5) throw new Error('The encrypted file is not a valid JWE.');
  const [protectedB64, encryptedKey, ivB64, ctB64, tagB64] = parts;
  const header = JSON.parse(b64urlToString(protectedB64));
  if (header.alg !== 'dir' || header.enc !== 'A256GCM' || encryptedKey !== '') {
    throw new Error(`Unsupported encryption (${header.alg}/${header.enc}).`);
  }
  const key = await crypto.subtle.importKey('raw', b64urlToBytes(keyB64url), 'AES-GCM', false, ['decrypt']);
  const ct = b64urlToBytes(ctB64);
  const tag = b64urlToBytes(tagB64);
  const data = new Uint8Array(ct.length + tag.length);
  data.set(ct);
  data.set(tag, ct.length);
  let plain;
  try {
    plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: b64urlToBytes(ivB64), additionalData: new TextEncoder().encode(protectedB64), tagLength: 128 },
      key,
      data,
    );
  } catch {
    throw new Error('Decryption failed: the key in the link does not match the data.');
  }
  let bytes = new Uint8Array(plain);
  if (header.zip === 'DEF') bytes = await inflateRaw(bytes);
  return { header, text: new TextDecoder().decode(bytes) };
}

async function inflateRaw(bytes) {
  if (typeof DecompressionStream === 'undefined') throw new Error('This browser cannot decompress the data.');
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
