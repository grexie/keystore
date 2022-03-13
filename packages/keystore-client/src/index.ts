import { WebSocket } from 'ws';
import { EventEmitter } from 'events';
import { KeyStore } from '@grexie/keystore';

export interface ClientOptions {
  url: string;
  key: string;
  debug?: boolean;
}

interface ClientProviderOptions<T> {
  client: KeyStoreClientAPI<T>;
  name: string;
}

interface KeyStoreClientAPI<T> extends EventEmitter {
  secret(name: string): Promise<T>;
  setSecret(name: string, secret: T): Promise<T>;
  rotateSecret(name: string): Promise<T>;
  restoreSecret(name: string, id: string): Promise<T>;
}

export class KeyStoreClient {
  readonly #url: string;
  readonly #key: string;
  readonly #debug: boolean;
  #running: boolean = false;
  #shutdown: boolean = false;
  #ws?: WebSocket;
  readonly #queue: string[] = [];
  #nextId: number = 0;
  readonly #subscriptions: {
    [name: string]: ((secret: any) => void)[];
  } = {};
  readonly #requests: {
    [id: number]: {
      resolve: (payload: any) => void;
      reject: (error: Error) => void;
    };
  } = {};

  constructor(options: ClientOptions) {
    this.#url = options.url;
    this.#key = options.key;
    this.#debug = !!options.debug;
    if (this.#debug) {
      console.info('debug: on');
    }
  }

  #start(reconnecting = false) {
    if (this.#running || this.#shutdown) {
      return;
    }
    this.#running = true;

    let url = this.#url;
    if (url.endsWith('/')) {
      url = `${url}${this.#key}`;
    } else {
      url = `${url}/${this.#key}`;
    }

    this.#ws = new WebSocket(url);

    this.#ws.on('open', () => {
      console.info('KeyStore: connected to', this.#url);
      reconnecting = false;
      const queue = this.#queue.splice(0, this.#queue.length);
      queue.forEach(message => this.#ws?.send(message));
    });

    this.#ws.on('message', data => {
      const message = JSON.parse(data.toString());

      if (this.#debug) {
        console.info('rx:', data.toString());
      }

      if (message.method === 'notify') {
        this.#subscriptions[message.name]?.forEach(listener =>
          listener(message.payload)
        );
      } else {
        const resolver = this.#requests[message.id];
        delete this.#requests[message.id];
        if (message.error) {
          resolver.reject(new Error(message.error));
        } else {
          resolver.resolve(message.payload);
        }
      }
    });

    this.#ws.on('error', err => {
      if (!reconnecting) {
        console.error('KeyStore: error', err.message);
      }
      this.#ws?.close();
      this.#running = false;
      this.#ws = undefined;
      if (!this.#shutdown) {
        setTimeout(() => {
          this.#start(true);
        }, 1000);
      }
    });

    this.#ws.on('close', () => {
      if (!reconnecting) {
        console.info('KeyStore: disconnected');
      }
      this.#running = false;
      this.#ws = undefined;
      if (!this.#shutdown) {
        setTimeout(() => {
          this.#start(true);
        }, 1000);
      }
    });
  }

  disconnect() {
    this.#shutdown = true;
    this.#ws?.close();
  }

  #subscribe(name: string, listener: (secret: any) => void) {
    if (!this.#subscriptions[name]) {
      this.#subscriptions[name] = [];
    }

    this.#subscriptions[name].push(listener);
  }

  async #request<T>(message: any) {
    const id = this.#nextId++;
    message = Object.assign({}, message, { id });
    const resolver: any = {};
    const promise = new Promise<T>((resolve, reject) =>
      Object.assign(resolver, { resolve, reject })
    );
    this.#requests[id] = resolver;
    this.#send(JSON.stringify(message));
    return promise;
  }

  #send(message: string) {
    if (this.#ws?.readyState !== WebSocket.OPEN) {
      this.#queue.push(message);
      this.#start();
    } else {
      this.#ws!.send(message);
    }
  }

  createKeyStore<T>(name: string): KeyStore<T> {
    const emitter = new EventEmitter();

    this.#subscribe(name, (secret: T) => {
      if (this.#debug) {
        console.info(`notify(${name}):`, secret);
      }
      emitter.emit('update', secret);
    });

    const iface: KeyStoreClientAPI<T> = Object.assign(emitter, {
      secret: async (name: string): Promise<T> => {
        const payload = await this.#request<T>({
          method: 'get',
          name,
        });

        if (this.#debug) {
          console.info(`secret(${name}):`, payload);
        }

        return payload;
      },

      setSecret: async (name: string, secret: T): Promise<T> => {
        const payload = await this.#request<T>({
          method: 'set',
          name,
          payload: secret,
        });

        if (this.#debug) {
          console.info(`setSecret(${name}):`, payload);
        }

        return payload;
      },

      rotateSecret: async (name: string): Promise<T> => {
        const payload = await this.#request<T>({
          method: 'rotate',
          name,
        });

        if (this.#debug) {
          console.info(`rotateSecret(${name}):`, payload);
        }

        return payload;
      },

      restoreSecret: async (name: string, id: string): Promise<T> => {
        const payload = await this.#request<T>({
          method: 'restore',
          name,
          payload: id,
        });

        if (this.#debug) {
          console.info(`restoreSecret(${name})`);
        }

        return payload;
      },
    });

    const keyStore = new ClientProvider<T>({
      client: iface,
      name,
    });

    return keyStore;
  }
}

class ClientProvider<T> extends EventEmitter implements KeyStore<T> {
  readonly #client: KeyStoreClientAPI<T>;
  readonly #name: string;
  #secret: Promise<T> | null;

  constructor(options: ClientProviderOptions<T>) {
    super();
    this.#client = options.client;
    this.#name = options.name;

    this.#client.on('update', (secret: T) => {
      this.#secret = Promise.resolve(secret);
      this.emit('update', secret);
    });
  }

  get secret() {
    if (!this.#secret) {
      this.#secret = this.#client.secret(this.#name);
    }

    return this.#secret;
  }

  async setSecret(secret: T) {
    this.#secret = this.#client.setSecret(this.#name, secret);
    return this.#secret;
  }

  async rotateSecret() {
    this.#secret = this.#client.rotateSecret(this.#name);
    return this.#secret;
  }

  async restoreSecret(id: string) {
    this.#secret = this.#client.restoreSecret(this.#name, id);
    return this.#secret;
  }
}

const createKeyStoreClient = (options: ClientOptions) =>
  new KeyStoreClient(options);

export { createKeyStoreClient };
