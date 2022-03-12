import { WebSocket, WebSocketServer } from 'ws';
import type { Server as HTTPServer } from 'http';
import type { Server as HTTPSServer } from 'https';
import { KeyStore } from '@grexie/keystore';

export interface KeyStoreOptions {
  name: string;
  keyStore: KeyStore<any>;
}

export interface ServerOptions {
  server: HTTPServer | HTTPSServer;
  debug?: boolean;
  authenticate: (key: string, method: Method, name: string) => Promise<boolean>;
  keyStores: KeyStoreOptions[];
}

export enum Method {
  notify = 'notify',
  get = 'get',
  set = 'set',
  rotate = 'rotate',
  restore = 'restore',
}

interface Request<M extends Method> {
  id: number;
  method: M;
  name: string;
}

interface Response<T> {
  id: number;
  error?: string;
  payload?: T;
}

interface SetRequest<T> extends Request<Method.set> {
  payload: {
    secret: T;
  };
}

interface RestoreRequest extends Request<Method.restore> {
  payload: {
    id: string;
  };
}

const serve = (options: ServerOptions, ws: WebSocket, key: string) => {
  const send = <T>(response: Response<T>) => {
    const data = JSON.stringify(response);
    if (options.debug) {
      console.info('tx:', data);
    }
    ws.send(data, err => {
      if (err) {
        console.error(err);
      }
    });
  };

  ws.on('message', async data => {
    if (options.debug) {
      console.info('rx:', data.toString());
    }

    const request: Request<any> = JSON.parse(data.toString());

    if (!(await options.authenticate(key, request.method, request.name))) {
      send({
        id: request.id,
        error: 'forbidden',
      });
      return;
    }

    const { keyStore } =
      options.keyStores.find(({ name }) => name === request.name) ?? {};

    if (!keyStore) {
      send({
        id: request.id,
        error: 'not-found',
      });
      return;
    }

    switch (request.method) {
      case Method.get: {
        const secret = await keyStore.secret;
        send({
          id: request.id,
          payload: secret,
        });
        return;
      }
      case Method.set: {
        const secret = await keyStore.setSecret(
          (request as SetRequest<any>).payload.secret
        );
        send({
          id: request.id,
          payload: secret,
        });
        return;
      }
      case Method.rotate: {
        const secret = await keyStore.rotateSecret();
        send({
          id: request.id,
          payload: secret,
        });
        return;
      }
      case Method.restore: {
        await keyStore.restoreSecret((request as RestoreRequest).payload.id);
        send({
          id: request.id,
        });
        return;
      }
    }
  });
};

interface Connection {
  key: string;
  ws: WebSocket;
}

const createKeyStoreServer = (options: ServerOptions) => {
  const wss = new WebSocketServer({
    server: options.server,
  });

  const connections: Connection[] = [];

  options.keyStores.forEach(({ name, keyStore }) => {
    keyStore.on('update', (secret: any) => {
      const data = JSON.stringify({
        method: 'notify',
        name,
        payload: {
          secret,
        },
      });

      connections.forEach(async ({ key, ws }) => {
        try {
          if (await options.authenticate(key, Method.notify, name)) {
            if (options.debug) {
              console.info('tx:', data);
            }

            ws.send(data);
          }
        } catch (err) {
          console.error(err);
        }
      });
    });
  });

  wss.on('connection', async (ws, req) => {
    try {
      const url = new URL(req.url!, `ws://${req.headers.host}`);
      const [key, ...parts] = url.pathname.split(/\//g).slice(1);
      if (parts.length) {
        ws.close();
        return;
      }

      const connection = { key, ws };
      connections.push(connection);
      ws.on('close', () => {
        const index = connections.indexOf(connection);
        if (index != -1) {
          connections.splice(index, 1);
        }
      });

      options.keyStores.forEach(async ({ name, keyStore }) => {
        try {
          const secret = await keyStore.secret;

          const data = JSON.stringify({
            method: 'notify',
            name,
            payload: {
              secret,
            },
          });

          if (await options.authenticate(key, Method.notify, name)) {
            if (options.debug) {
              console.info('tx:', data);
            }

            ws.send(data);
          }
        } catch (err) {
          console.error(err);
        }
      });

      serve(options, ws, key);
    } catch (err) {
      console.error(err);
      ws.close();
    }
  });
};

export { createKeyStoreServer };
