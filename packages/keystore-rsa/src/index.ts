import * as crypto from 'crypto';
import { createKeyStoreFactory } from '@grexie/keystore';

export interface KeyPair {
  id: string;
  publicKey: string;
  privateKey: string;
}

const createRSAKeyStore = createKeyStoreFactory<KeyPair>({
  async persistor(keyPair: KeyPair) {
    if (!keyPair) {
      keyPair = await new Promise((resolve, reject) => {
        crypto.generateKeyPair(
          'rsa',
          {
            modulusLength: 4096,
            publicKeyEncoding: { type: 'spki', format: 'pem' },
            privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
          },
          (err, publicKey, privateKey) => {
            if (err) {
              reject(err);
              return;
            }

            resolve({
              id: crypto
                .createHash('sha256')
                .update(publicKey)
                .digest()
                .toString('hex'),
              publicKey,
              privateKey,
            });
          }
        );
      });
    }

    return {
      id: keyPair.id,
      key: Buffer.from(keyPair.privateKey, 'utf8'),
    };
  },
  async hydrator(buffer) {
    const privateKey = buffer.toString('utf8');

    const publicKey = crypto.createPublicKey(buffer).export({
      type: 'spki',
      format: 'pem',
    }) as string;

    const id = crypto
      .createHash('sha256')
      .update(publicKey)
      .digest()
      .toString('hex');

    return { id, publicKey, privateKey };
  },
});

export { createRSAKeyStore };
