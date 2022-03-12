import { createServer } from 'http';
import { MemoryProvider } from '@grexie/keystore';
import { createWeb3KeyStore } from '@grexie/keystore-web3';
import { createRSAKeyStore } from '@grexie/keystore-rsa';
import { createKeyStoreServer } from '@grexie/keystore-server';

const httpServer = createServer();

createKeyStoreServer({
  server: httpServer,
  debug: false,
  authenticate: async key => {
    if (key === 'AUTH_KEY') {
      return true;
    } else {
      return false;
    }
  },
  keyStores: [
    {
      name: 'ACCOUNT1',
      keyStore: createWeb3KeyStore({
        provider: MemoryProvider,
        ttl: 24 * 3600,
      }),
    },
    {
      name: 'ACCOUNT2',
      keyStore: createWeb3KeyStore({
        provider: MemoryProvider,
        ttl: 24 * 3600,
      }),
    },
    {
      name: 'ACCOUNT3',
      keyStore: createWeb3KeyStore({
        provider: MemoryProvider,
        ttl: 24 * 3600,
      }),
    },
    {
      name: 'KEYPAIR1',
      keyStore: createRSAKeyStore({
        provider: MemoryProvider,
        ttl: 24 * 3600,
      }),
    },
  ],
});

httpServer.listen(3000, () => {
  console.info('server listening on port 3000');
});