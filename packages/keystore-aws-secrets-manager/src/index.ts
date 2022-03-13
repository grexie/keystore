import {
  Provider,
  ProviderOptions,
  Hydrator,
  Persistor,
  KeyStore,
} from '@grexie/keystore';
import { EventEmitter } from 'events';
import { AWSError, SecretsManager } from 'aws-sdk';
import { SecretBinaryType } from 'aws-sdk/clients/secretsmanager';

interface PubSub {
  subscribe: (
    channels: string,
    listener: (message: string, channel: string) => unknown
  ) => Promise<void>;
  publish: (channel: string, message: string) => Promise<void>;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
}

export interface SecretsManagerProviderOptions {
  name: string;
  secretsManager: SecretsManager;
  pubsub?: PubSub | (() => Promise<PubSub>);
}

const SecretsManagerProvider: Provider<SecretsManagerProviderOptions> = class<T>
  extends EventEmitter
  implements KeyStore<T>
{
  readonly #secretsManager: SecretsManager;
  readonly #pubsub?: PubSub | (() => Promise<PubSub>);
  #subscriber?: PubSub;
  #publisher?: PubSub;
  #secret: Promise<T | null>;
  #running: boolean = false;
  readonly #name: string;
  readonly #hydrator: Hydrator<T>;
  readonly #persistor: Persistor<T>;

  constructor({
    persistor,
    hydrator,
    name,
    secretsManager,
    pubsub,
  }: ProviderOptions<T> & SecretsManagerProviderOptions) {
    super();
    this.#persistor = persistor;
    this.#hydrator = hydrator;
    this.#name = name;
    this.#secretsManager = secretsManager;
    this.#pubsub = pubsub;
  }

  #disconnect: null | (() => void) = null;
  #startPromise: null | Promise<void>;
  #start = () => {
    if (!this.#startPromise) {
      this.#startPromise = (async () => {
        if (this.#running) {
          return;
        }

        try {
          this.#running = true;

          this.#disconnect = async () => {
            if (!this.#running) {
              return;
            }

            this.#running = false;
            this.#startPromise = null;
            await Promise.all([
              this.#subscriber?.disconnect(),
              this.#publisher?.disconnect(),
            ]);
          };

          if (this.#pubsub) {
            this.#subscriber =
              typeof this.#pubsub === 'function'
                ? await this.#pubsub()
                : this.#pubsub!;
            this.#publisher =
              typeof this.#pubsub === 'function'
                ? await this.#pubsub()
                : this.#pubsub!;

            await Promise.all([
              this.#subscriber.connect(),
              this.#publisher.connect(),
            ]);

            if (this.#running) {
              await this.#subscriber.subscribe(`keystore:${this.#name}`, () => {
                this.#secret = this.#fetchSecret();
              });
            }
          }

          if (this.#running) {
            this.#secret = this.#fetchSecret();
          }
        } catch (err) {
          console.error(err);
          this.#running = false;
        }
      })();
    }

    return this.#startPromise;
  };

  disconnect() {
    this.#disconnect?.();
  }

  get secret() {
    return this.#start()
      .then(() => this.#secret)
      .then(secret => secret!);
  }

  async #exists() {
    try {
      await this.#secretsManager
        .describeSecret({
          SecretId: this.#name,
        })
        .promise();
      return true;
    } catch (err) {
      return false;
    }
  }

  async #setSecret(id: string, key: SecretBinaryType) {
    await this.#start();

    if (await this.#exists()) {
      await this.#secretsManager
        .putSecretValue({
          SecretId: this.#name,
          SecretBinary: key,
          ...(id ? { ClientRequestToken: id } : {}),
        })
        .promise();
    } else {
      await this.#secretsManager
        .createSecret({
          Name: this.#name,
          SecretBinary: key,
          ClientRequestToken: id,
        })
        .promise();
    }

    await this.#publisher?.publish(`secret:${this.#name}`, '');

    this.#secret = Promise.resolve(
      this.#hydrator(Buffer.from(key.toString(), 'base64'))
    );
    this.emit('update', await this.#secret);

    return this.#secret;
  }

  async setSecret(secret: T | null) {
    const key = await this.#persistor(secret);

    if (!key) {
      return null;
    }

    return this.#setSecret(key.id, key.key.toString('base64'));
  }

  async rotateSecret() {
    return this.setSecret(null);
  }

  async restoreSecret(id: string) {
    await this.#start();

    const response = await this.#secretsManager
      .getSecretValue({
        SecretId: this.#name,
        VersionId: id,
      })
      .promise();

    if (!response.SecretBinary) {
      throw new Error(`secret ${this.#name}:${id} not found`);
    }

    return this.#setSecret(id, response.SecretBinary);
  }

  async #fetchSecret() {
    try {
      const response = await this.#secretsManager
        .getSecretValue({
          SecretId: this.#name,
        })
        .promise();

      if (response.SecretString == '::initial') {
        return this.rotateSecret();
      }

      if (!response.SecretBinary && !response.SecretString) {
        throw new Error(`secret ${this.#name} not found`);
      }

      return this.#hydrator(
        response.SecretBinary
          ? Buffer.from(response.SecretBinary.toString(), 'base64')
          : Buffer.from(response.SecretString!, 'utf8')
      );
    } catch (err) {
      if ((err as AWSError).statusCode == 404) {
        return this.rotateSecret();
      } else {
        throw err;
      }
    }
  }
};

export { SecretsManagerProvider };
