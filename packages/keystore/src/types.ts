import { EventEmitter } from 'events';

export interface Key {
  id: string;
  key: Buffer;
}

export interface Hydrator<T> {
  (buffer: Buffer): PromiseLike<T> | T;
}

export interface Persistor<T> {
  (secret: T | null):
    | PromiseLike<Key | null | undefined>
    | Key
    | null
    | undefined;
}

export interface KeyStore<T> extends EventEmitter {
  get secret(): Promise<T | null>;
  setSecret(secret: T | null): Promise<T | null>;
  rotateSecret(): Promise<T | null>;
  restoreSecret(id: string): Promise<T | null>;
}

export interface ProviderOptions<T> {
  persistor: Persistor<T>;
  hydrator: Hydrator<T>;
}

export interface FactoryOptions<T, O extends Object = Object> {
  provider: Provider<O, T>;
}

export type Provider<O extends Object, T = any> = new (
  options: Omit<O, 'provider'> & ProviderOptions<T>
) => KeyStore<T>;

export type Factory<T> = <O extends Object>(
  options: O & FactoryOptions<T, O>
) => KeyStore<T>;

export const createKeyStoreFactory =
  <T>({ persistor, hydrator }: ProviderOptions<T>): Factory<T> =>
  ({ provider: Provider, ...options }) =>
    new Provider({
      ...options,
      persistor,
      hydrator,
    });

interface KeyStoreOptions<T> {
  idField: string;
  create?: () => T;
}

export const createJSONKeyStoreFactory = <T>({
  idField,
  create,
}: KeyStoreOptions<T>) =>
  createKeyStoreFactory<T>({
    async persistor(key) {
      if (!key) {
        if (!create) {
          return;
        }

        key = create();
      }

      return {
        id: key[idField],
        key: Buffer.from(JSON.stringify(key), 'utf8'),
      };
    },
    async hydrator(buffer) {
      return JSON.parse(buffer.toString('utf8'));
    },
  });
