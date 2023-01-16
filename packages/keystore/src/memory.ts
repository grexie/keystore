import {
  Provider,
  Persistor,
  Hydrator,
  KeyStore,
  ProviderOptions,
} from './types.js';
import { EventEmitter } from 'events';

interface MemoryProviderOptions<T = any> {
  ttl?: number;
  initialSecret?: T;
}

const MemoryProvider: Provider<MemoryProviderOptions> = class<T>
  extends EventEmitter
  implements KeyStore<T>
{
  #start: Promise<void>;
  #secret: Promise<T>;
  #secretId: string;
  readonly #secrets: {
    [id: string]: {
      timeout?: NodeJS.Timeout;
      key: Buffer;
    };
  } = {};
  readonly #persistor: Persistor<T>;
  readonly #hydrator: Hydrator<T>;
  readonly #ttl: number;

  constructor({
    persistor,
    hydrator,
    ttl = 0,
    initialSecret,
  }: ProviderOptions<T> & MemoryProviderOptions<T>) {
    super();
    this.#persistor = persistor;
    this.#hydrator = hydrator;
    this.#ttl = ttl;

    const resolver: { resolve?: () => void } = {};
    this.#start = new Promise<void>(resolve =>
      Object.assign(resolver, { resolve })
    );
    if (initialSecret) {
      this.setSecret(initialSecret).finally(resolver.resolve);
    } else {
      this.rotateSecret().finally(resolver.resolve);
    }
  }

  get secret() {
    return this.#start.then(() => this.#secret);
  }

  async #setSecret(id: string, key: Buffer) {
    if (id === this.#secretId && this.#secrets[id].timeout) {
      clearTimeout(this.#secrets[id].timeout!);
      this.#secrets[id].timeout = undefined;
    }
    this.#secrets[id] = { key };

    if (this.#secretId) {
      const oldSecretId = this.#secretId;
      if (this.#ttl > 0) {
        this.#secrets[oldSecretId].timeout = setTimeout(() => {
          delete this.#secrets[oldSecretId];
        }, this.#ttl);
      } else if (this.#ttl === 0) {
        delete this.#secrets[oldSecretId];
      }
    }

    this.#secretId = id;
    this.#secret = Promise.resolve(this.#hydrator(key));
    this.emit('update', await this.#secret);
    return this.#secret;
  }

  async setSecret(secret: T | null): Promise<T> {
    const key = await this.#persistor(secret);

    if (!key) {
      return this.#secret;
    }

    return this.#setSecret(key.id, key.key);
  }

  async rotateSecret(): Promise<T> {
    return this.setSecret(null);
  }

  async restoreSecret(id: string) {
    if (!this.#secrets[id]) {
      throw new Error(`secret ${id} not found`);
    }

    const { key } = this.#secrets[id];

    return this.#setSecret(id, key);
  }
};

export { MemoryProvider };
