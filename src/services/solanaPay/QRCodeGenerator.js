import { encodeURL, createQR } from '@solana/pay';
import { PublicKey } from '@solana/web3.js';

export class QRCodeGenerator {
  async initialize() {
    return true;
  }

  async generate(params) {
    const url = encodeURL(params);
    const qrCode = await createQR(url);
    return { url, qrCode };
  }

  cleanup() {
    // Nothing to clean up
  }
}