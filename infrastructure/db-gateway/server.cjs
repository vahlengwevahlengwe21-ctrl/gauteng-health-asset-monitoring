'use strict';

const http = require('node:http');
const net = require('node:net');
const fs = require('node:fs');
const { timingSafeEqual } = require('node:crypto');
const { WebSocketServer, WebSocket } = require('ws');

function createGatewayServer({
  host = process.env.GATEWAY_HOST || '127.0.0.1',
  port = Number(process.env.GATEWAY_PORT || 8790),
  token,
  databaseHost = process.env.DB_TARGET_HOST || '127.0.0.1',
  databasePort = Number(process.env.DB_TARGET_PORT || 3306),
  maxConnections = Number(process.env.GATEWAY_MAX_CONNECTIONS || 50),
} = {}) {
  token ||= process.env.GATEWAY_TOKEN;
  if (!token && process.env.GATEWAY_TOKEN_FILE) {
    token = fs.readFileSync(process.env.GATEWAY_TOKEN_FILE, 'utf8').trim();
  }
  if (!token || Buffer.byteLength(token) < 32) {
    throw new Error('GATEWAY_TOKEN must contain at least 32 bytes.');
  }
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error('GATEWAY_PORT must be a valid TCP port.');
  }
  if (!Number.isInteger(databasePort) || databasePort < 1 || databasePort > 65535) {
    throw new Error('DB_TARGET_PORT must be a valid TCP port.');
  }
  if (!Number.isInteger(maxConnections) || maxConnections < 1) {
    throw new Error('GATEWAY_MAX_CONNECTIONS must be a positive integer.');
  }

  const expectedAuthorization = Buffer.from(`Bearer ${token}`);
  let activeConnections = 0;

  const server = http.createServer((request, response) => {
    if (request.method === 'GET' && request.url === '/healthz') {
      response.writeHead(200, {
        'Cache-Control': 'no-store',
        'Content-Type': 'application/json',
      });
      response.end('{"status":"ok"}');
      return;
    }

    response.writeHead(404, { 'Cache-Control': 'no-store' });
    response.end();
  });

  const webSocketServer = new WebSocketServer({
    noServer: true,
    maxPayload: 16 * 1024 * 1024,
    perMessageDeflate: false,
  });

  server.on('upgrade', (request, socket, head) => {
    const authorization = request.headers.authorization;
    const providedAuthorization =
      typeof authorization === 'string' ? Buffer.from(authorization) : Buffer.alloc(0);

    if (
      request.url !== '/mysql' ||
      providedAuthorization.length !== expectedAuthorization.length ||
      !timingSafeEqual(providedAuthorization, expectedAuthorization)
    ) {
      socket.end('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
      return;
    }

    if (activeConnections >= maxConnections) {
      socket.end('HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n');
      return;
    }

    webSocketServer.handleUpgrade(request, socket, head, (webSocket) => {
      activeConnections += 1;
      let databaseSocket;

      const closeConnection = () => {
        if (databaseSocket && !databaseSocket.destroyed) {
          databaseSocket.destroy();
        }
      };

      webSocket.once('close', () => {
        activeConnections -= 1;
        closeConnection();
      });
      webSocket.once('error', closeConnection);

      databaseSocket = net.createConnection({
        host: databaseHost,
        port: databasePort,
      });
      databaseSocket.setTimeout(10_000);

      databaseSocket.once('connect', () => {
        databaseSocket.setTimeout(0);
      });
      databaseSocket.once('timeout', () => {
        webSocket.close(1011, 'Database connection timed out');
        closeConnection();
      });
      databaseSocket.once('error', () => {
        webSocket.close(1011, 'Database connection failed');
        closeConnection();
      });
      databaseSocket.on('data', (data) => {
        if (webSocket.readyState !== WebSocket.OPEN) return;
        if (webSocket.bufferedAmount > 8 * 1024 * 1024) {
          webSocket.close(1013, 'Gateway is overloaded');
          closeConnection();
          return;
        }
        webSocket.send(data, { binary: true }, (error) => {
          if (error) closeConnection();
        });
      });
      databaseSocket.once('end', () => {
        if (webSocket.readyState === WebSocket.OPEN) webSocket.close(1000);
      });

      webSocket.on('message', (data, isBinary) => {
        if (!isBinary || !databaseSocket || databaseSocket.destroyed) {
          webSocket.close(1003, 'Binary MySQL data is required');
          closeConnection();
          return;
        }

        if (!databaseSocket.write(data)) {
          webSocket.pause();
          databaseSocket.once('drain', () => webSocket.resume());
        }
      });
    });
  });

  return { server, webSocketServer };
}

if (require.main === module) {
  const port = Number(process.env.GATEWAY_PORT || 8790);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    console.error('GATEWAY_PORT must be a valid TCP port.');
    process.exit(1);
  }
  const { server } = createGatewayServer();
  server.listen(port, process.env.GATEWAY_HOST || '127.0.0.1');
  server.on('listening', () => {
    console.log('Gauteng database gateway is listening.');
  });
  server.on('error', (error) => {
    console.error('Gauteng database gateway failed to start:', error.message);
    process.exitCode = 1;
  });
}

module.exports = { createGatewayServer };
