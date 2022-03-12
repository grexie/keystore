import Web3 from 'web3';
import { Account } from 'web3-core';
import * as ethUtil from 'ethereumjs-util';
import { createKeyStoreFactory } from '@grexie/keystore';

const createWeb3KeyStore = createKeyStoreFactory<Account>({
  async persistor(account: Account) {
    if (!account) {
      const web3 = new Web3();
      account = web3.eth.accounts.create();
    }

    return {
      id: account.address,
      key: ethUtil.toBuffer(account.privateKey),
    };
  },

  async hydrator(buffer): Promise<Account> {
    const web3 = new Web3();
    const account = web3.eth.accounts.privateKeyToAccount(
      ethUtil.bufferToHex(buffer)
    );

    return account;
  },
});

export { createWeb3KeyStore };
