import { createKeyStoreClient } from '@grexie/keystore-client';
import { KeyPair } from '@grexie/keystore-rsa';
import { Account } from 'web3-core';
import * as assert from 'assert';

const client = createKeyStoreClient({
  key: 'AUTH_KEY',
  url: 'ws://localhost:3000',
  debug: false,
});

const account1 = client.createKeyStore<Account>('ACCOUNT1');
const account2 = client.createKeyStore<Account>('ACCOUNT2');
const account3 = client.createKeyStore<Account>('ACCOUNT3');
const keyPair1 = client.createKeyStore<KeyPair>('KEYPAIR1');

const main = async () => {
  const original = await account1.secret;

  console.info('ACCOUNT1', (await account1.secret).address);
  console.info('ACCOUNT2', (await account2.secret).address);
  console.info('ACCOUNT3', (await account3.secret).address);

  account1.on('update', (secret: Account) => {
    console.info('ACCOUNT1:update', secret.address);
  });

  await account1.rotateSecret();

  console.info('ACCOUNT1 after rotate', (await account1.secret).address);

  await account1.restoreSecret(original.address);

  console.info('ACCOUNT1 after restore', (await account1.secret).address);

  assert.deepEqual(await account1.secret, original);

  console.info('KEYPAIR1', (await keyPair1.secret).id);

  keyPair1.on('update', (secret: KeyPair) => {
    console.info('KEYPAIR1:update', secret.id);
  });

  await keyPair1.rotateSecret();

  client.disconnect();
};

main().catch(err => {
  console.error(err);
  process.exit(1);
});
