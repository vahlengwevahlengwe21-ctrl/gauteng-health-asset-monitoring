import mysql, { type Pool } from 'mysql2/promise';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createMySqlGatewayStream } from '@/lib/mysql-websocket-stream';

let pool: Pool | undefined;

export function getDbPool(): Pool {
  if (!pool) {
      const {
            DB_HOST,
                  DB_PORT,
                        DB_USER,
                              DB_PASSWORD,
                                    DB_NAME,
                                          DB_SSL_CA,
                                                DB_GATEWAY_URL,
                                                      DB_GATEWAY_TOKEN,
                                                          } = process.env;
                                                              if (!DB_HOST || !DB_USER || !DB_PASSWORD || !DB_NAME) {
                                                                    throw new Error('Database configuration is incomplete.');
                                                                        }
                                                                            if (process.env.NODE_ENV === 'production' && (!DB_GATEWAY_URL || !DB_GATEWAY_TOKEN)) {
                                                                                  throw new Error('Production database gateway configuration is incomplete.');
                                                                                      }

                                                                                          const port = Number(DB_PORT);
                                                                                              if (!Number.isInteger(port) || port < 1 || port > 65535) {
                                                                                                    throw new Error('DB_PORT must be a valid TCP port.');
                                                                                                        }

                                                                                                            const useMySqlTls = process.env.NODE_ENV === 'production' && !DB_GATEWAY_URL;
                                                                                                                const databaseCa = useMySqlTls
                                                                                                                      ? DB_SSL_CA || readFileSync(resolve(process.cwd(), 'database/mysql-ca.pem'), 'utf8')
                                                                                                                            : undefined;

                                                                                                                                pool = mysql.createPool({
                                                                                                                                      host: DB_HOST,
                                                                                                                                            port,
                                                                                                                                                  user: DB_USER,
                                                                                                                                                        password: DB_PASSWORD,
                                                                                                                                                              database: DB_NAME,
                                                                                                                                                                    ssl: useMySqlTls
                                                                                                                                                                            ? {
                                                                                                                                                                                        rejectUnauthorized: true,
                                                                                                                                                                                                    verifyIdentity: true,
                                                                                                                                                                                                                ca: databaseCa,
                                                                                                                                                                                                                          }
                                                                                                                                                                                                                                  : undefined,
                                                                                                                                                                                                                                        stream: DB_GATEWAY_URL ? createMySqlGatewayStream : undefined,
                                                                                                                                                                                                                                              waitForConnections: true,
                                                                                                                                                                                                                                                    connectionLimit: 10,
                                                                                                                                                                                                                                                          connectTimeout: 20_000,
                                                                                                                                                                                                                                                                dateStrings: true,
                                                                                                                                                                                                                                                                      decimalNumbers: true,
                                                                                                                                                                                                                                                                          });
                                                                                                                                                                                                                                                                            }

                                                                                                                                                                                                                                                                              return pool;
                                                                                                                                                                                                                                                                              }
                                                                                                                                                                                                                                                                              