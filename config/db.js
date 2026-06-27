import mysql from "mysql2";

import {
  DB_HOST,
  DB_USER,
  DB_PASSWORD,
  DB_NAME,
  DB_PORT,
  DB_SSL,
} from "./env.js";

const RETRYABLE_DATABASE_ERRORS = new Set([
  "ECONNRESET",
  "ETIMEDOUT",
  "EPIPE",
  "PROTOCOL_CONNECTION_LOST",
  "PROTOCOL_ENQUEUE_AFTER_FATAL_ERROR",
  "PROTOCOL_PACKETS_OUT_OF_ORDER",
]);

function wait(milliseconds) {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

const pool = mysql.createPool({
  host: DB_HOST,
  user: DB_USER,
  password: DB_PASSWORD,
  database: DB_NAME,
  port: DB_PORT,

  ssl: DB_SSL
    ? {
        minVersion: "TLSv1.2",
      }
    : undefined,

  waitForConnections: true,

  // Jumlah koneksi aktif maksimal.
  connectionLimit: 5,

  // Jumlah koneksi diam yang tetap disimpan.
  maxIdle: 5,

  // Koneksi diam akan dibuang setelah 30 detik.
  // Ini mengurangi kemungkinan koneksi lama dipakai kembali.
  idleTimeout: 30000,

  queueLimit: 0,

  // Menjaga socket koneksi tetap hidup.
  enableKeepAlive: true,
  keepAliveInitialDelay: 0,

  // Batas waktu membuat koneksi baru.
  connectTimeout: 20000,
});

const promisePool = pool.promise();

async function runWithRetry(
  operationName,
  operation,
  maxRetries = 3,
) {
  let lastError;

  for (
    let attempt = 0;
    attempt <= maxRetries;
    attempt += 1
  ) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;

      const retryable =
        RETRYABLE_DATABASE_ERRORS.has(
          error.code,
        ) && attempt < maxRetries;

      if (!retryable) {
        throw error;
      }

      const delay =
        400 * (attempt + 1);

      console.warn(
        `[DB] ${operationName} gagal ` +
          `(${error.code}). ` +
          `Percobaan ulang ${attempt + 1}/` +
          `${maxRetries} dalam ${delay} ms.`,
      );

      await wait(delay);
    }
  }

  throw lastError;
}

export async function executeWithRetry(
  sql,
  values = [],
  maxRetries = 3,
) {
  return runWithRetry(
    "execute",
    () =>
      promisePool.execute(
        sql,
        values,
      ),
    maxRetries,
  );
}

export async function queryWithRetry(
  sql,
  values = [],
  maxRetries = 3,
) {
  return runWithRetry(
    "query",
    () =>
      promisePool.query(
        sql,
        values,
      ),
    maxRetries,
  );
}

/*
 * Proxy ini membuat kode lama seperti:
 *
 * db.promise().execute(...)
 * db.promise().query(...)
 *
 * otomatis menggunakan mekanisme retry.
 *
 * Jadi file router tidak perlu diubah satu per satu.
 */
const retryingPromisePool = new Proxy(
  promisePool,
  {
    get(target, property, receiver) {
      if (property === "execute") {
        return executeWithRetry;
      }

      if (property === "query") {
        return queryWithRetry;
      }

      const value = Reflect.get(
        target,
        property,
        receiver,
      );

      if (typeof value === "function") {
        return value.bind(target);
      }

      return value;
    },
  },
);

/*
 * Tetap mempertahankan dukungan:
 *
 * db.query(...)
 * db.getConnection(...)
 * db.promise().getConnection(...)
 *
 * sehingga router lain tidak rusak.
 */
const db = new Proxy(pool, {
  get(target, property, receiver) {
    if (property === "promise") {
      return () =>
        retryingPromisePool;
    }

    const value = Reflect.get(
      target,
      property,
      receiver,
    );

    if (typeof value === "function") {
      return value.bind(target);
    }

    return value;
  },
});

// Tes koneksi ketika backend pertama kali dijalankan.
pool.getConnection(
  (error, connection) => {
    if (error) {
      console.error(
        "Gagal terhubung ke database:",
        error.message,
      );

      return;
    }

    connection.ping(
      (pingError) => {
        if (pingError) {
          console.error(
            "Database terhubung, " +
              "tetapi ping gagal:",
            pingError.message,
          );
        } else {
          console.log(
            "Database TiDB berhasil terhubung!",
          );
        }

        connection.release();
      },
    );
  },
);

export default db;
