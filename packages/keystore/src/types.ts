import { EventEmitter } from 'events';

export interface Key {
  id: string;
  key: Buffer;
}

export interface Hydrator<T> {
  (buffer: Buffer): PromiseLike<T> | T;
}

export interface Persistor<T> {
  (secret: T | null): PromiseLike<Key> | Key;
}

export interface KeyStore<T> extends EventEmitter {
  get secret(): Promise<T | null>;
  setSecret(secret: T | null): Promise<T | null>;
  rotateSecret(): Promise<T>;
  restoreSecret(id: string): Promise<void>;
}

export interface ProviderOptions<T> {
  persistor: Persistor<T>;
  hydrator: Hydrator<T>;
}

export interface FactoryOptions<O extends Object, T> {
  provider: Provider<O, T>;
}

export type Provider<O extends Object, T = any> = new (
  options: Omit<O, 'provider'> & ProviderOptions<T>
) => KeyStore<T>;

export type Factory<T> = <O extends Object>(
  options: O & FactoryOptions<O, T>
) => KeyStore<T>;

export const createKeyStoreFactory =
  <T>({ persistor, hydrator }: ProviderOptions<T>): Factory<T> =>
  ({ provider: Provider, ...options }) =>
    new Provider({
      ...options,
      persistor,
      hydrator,
    });
