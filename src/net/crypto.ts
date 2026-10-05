import { deinterleave, flipMsb, interleave, swapMultiples } from 'eolib';
import { randomInt } from 'node:crypto';

function skipEncryption(data: Uint8Array): boolean {
  return data.length <= 2 || (data[0] === 0xff && data[1] === 0xff);
}

export function encryptPacket(data: Uint8Array, multiple: number): void {
  if (multiple === 0 || skipEncryption(data)) return;
  swapMultiples(data, multiple);
  interleave(data);
  flipMsb(data);
}

export function decryptPacket(data: Uint8Array, multiple: number): void {
  if (multiple === 0 || skipEncryption(data)) return;
  deinterleave(data);
  flipMsb(data);
  swapMultiples(data, multiple);
}

export function generateEncryptionMultiple(): number {
  return randomInt(6, 13);
}
