import { Router } from "express";
import db from "../config/db.js";

const router = Router();

const RETRYABLE_DATABASE_ERRORS = new Set([
  "ECONNRESET",
  "ETIMEDOUT",
  "EPIPE",
  "PROTOCOL_CONNECTION_LOST",
]);

function wait(milliseconds) {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

async function executeWithRetry(
  sql,
  values = [],
  maxRetries = 2,
) {
  let lastError;

  for (
    let attempt = 0;
    attempt <= maxRetries;
    attempt += 1
  ) {
    try {
      return await db
        .promise()
        .execute(sql, values);
    } catch (error) {
      lastError = error;

      const canRetry =
        RETRYABLE_DATABASE_ERRORS.has(
          error.code,
        ) && attempt < maxRetries;

      if (!canRetry) {
        throw error;
      }

      await wait(300 * (attempt + 1));
    }
  }

  throw lastError;
}

function parsePositiveInteger(value) {
  const parsedValue = Number(value);

  if (
    !Number.isInteger(parsedValue) ||
    parsedValue <= 0
  ) {
    return null;
  }

  return parsedValue;
}

function parsePositiveNumber(value) {
  const parsedValue = Number(value);

  if (
    !Number.isFinite(parsedValue) ||
    parsedValue <= 0
  ) {
    return null;
  }

  return parsedValue;
}

function normalizeRequiredText(value) {
  const text = String(value ?? "").trim();

  return text === "" ? null : text;
}

function toNumber(value) {
  const parsedValue = Number(value);

  return Number.isFinite(parsedValue)
    ? parsedValue
    : 0;
}

function toIsoDate(value) {
  if (!value) {
    return null;
  }

  const date =
    value instanceof Date
      ? value
      : new Date(value);

  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date.toISOString();
}

async function getSellerSummary(
  sellerId,
) {
  const [salesRows] =
    await executeWithRetry(
      `
        SELECT
          COALESCE(
            SUM(
              CASE
                WHEN t.status = 'selesai'
                THEN td.subtotal
                ELSE 0
              END
            ),
            0
          ) AS total_penjualan,

          COALESCE(
            SUM(
              CASE
                WHEN t.status IN (
                  'pending',
                  'dibayar',
                  'diproses',
                  'dikirim'
                )
                THEN td.subtotal
                ELSE 0
              END
            ),
            0
          ) AS saldo_tertahan

        FROM transaction_details AS td

        INNER JOIN products AS p
          ON p.id_product =
            td.id_product

        INNER JOIN transactions AS t
          ON t.id_transaction =
            td.id_transaction

        WHERE p.id_user = ?
      `,
      [sellerId],
    );

  const [withdrawalRows] =
    await executeWithRetry(
      `
        SELECT
          COALESCE(
            SUM(
              CASE
                WHEN status = 'berhasil'
                THEN jumlah
                ELSE 0
              END
            ),
            0
          ) AS sudah_ditarik,

          COALESCE(
            SUM(
              CASE
                WHEN status = 'menunggu'
                THEN jumlah
                ELSE 0
              END
            ),
            0
          ) AS penarikan_menunggu

        FROM seller_withdrawals

        WHERE id_seller = ?
      `,
      [sellerId],
    );

  const totalPenjualan = toNumber(
    salesRows[0]?.total_penjualan,
  );

  const saldoTertahan = toNumber(
    salesRows[0]?.saldo_tertahan,
  );

  const sudahDitarik = toNumber(
    withdrawalRows[0]?.sudah_ditarik,
  );

  const penarikanMenunggu = toNumber(
    withdrawalRows[0]
      ?.penarikan_menunggu,
  );

  const saldoTersedia = Math.max(
    totalPenjualan -
      sudahDitarik -
      penarikanMenunggu,
    0,
  );

  return {
    saldo_tersedia: saldoTersedia,
    total_penjualan: totalPenjualan,
    saldo_tertahan: saldoTertahan,
    sudah_ditarik: sudahDitarik,
    penarikan_menunggu:
      penarikanMenunggu,
  };
}

// ======================================================
// RINGKASAN SALDO PENJUAL
// GET /seller-balance/:sellerId/summary
// ======================================================

router.get(
  "/:sellerId/summary",
  async (req, res) => {
    const sellerId =
      parsePositiveInteger(
        req.params.sellerId,
      );

    if (sellerId === null) {
      return res.status(400).json({
        success: false,
        message:
          "ID penjual tidak valid.",
      });
    }

    try {
      const summary =
        await getSellerSummary(
          sellerId,
        );

      return res.status(200).json({
        success: true,
        summary,
      });
    } catch (error) {
      console.error(
        "Gagal mengambil saldo penjual:",
        error,
      );

      return res.status(500).json({
        success: false,
        message:
          "Gagal mengambil saldo penjual.",
        error: error.message,
        code: error.code,
      });
    }
  },
);

// ======================================================
// RIWAYAT SALDO PENJUAL
// GET /seller-balance/:sellerId/history
// ======================================================

router.get(
  "/:sellerId/history",
  async (req, res) => {
    const sellerId =
      parsePositiveInteger(
        req.params.sellerId,
      );

    if (sellerId === null) {
      return res.status(400).json({
        success: false,
        message:
          "ID penjual tidak valid.",
      });
    }

    try {
      const [salesRows] =
        await executeWithRetry(
          `
            SELECT
              t.id_transaction,
              SUM(td.subtotal) AS jumlah

            FROM transaction_details AS td

            INNER JOIN products AS p
              ON p.id_product =
                td.id_product

            INNER JOIN transactions AS t
              ON t.id_transaction =
                td.id_transaction

            WHERE
              p.id_user = ?
              AND t.status = 'selesai'

            GROUP BY t.id_transaction

            ORDER BY t.id_transaction DESC
          `,
          [sellerId],
        );

      const [withdrawalRows] =
        await executeWithRetry(
          `
            SELECT
              id_withdrawal,
              jumlah,
              metode,
              nama_rekening,
              nomor_rekening,
              status,
              created_at,
              processed_at

            FROM seller_withdrawals

            WHERE id_seller = ?

            ORDER BY id_withdrawal DESC
          `,
          [sellerId],
        );

      const salesHistory =
        salesRows.map((row) => ({
          id:
            `sale-${row.id_transaction}`,
          tipe: "penjualan",
          judul:
            `Penjualan Pesanan #` +
            `${row.id_transaction}`,
          keterangan:
            "Pesanan telah diselesaikan pembeli",
          jumlah: toNumber(row.jumlah),
          status: "selesai",
          id_transaction: Number(
            row.id_transaction,
          ),
          tanggal: null,
        }));

      const withdrawalHistory =
        withdrawalRows.map((row) => ({
          id:
            `withdrawal-` +
            `${row.id_withdrawal}`,
          tipe: "penarikan",
          judul: "Penarikan Saldo",
          keterangan:
            `${row.metode} • ` +
            `${row.nomor_rekening}`,
          jumlah: toNumber(row.jumlah),
          status: row.status,
          id_withdrawal: Number(
            row.id_withdrawal,
          ),
          metode: row.metode,
          nama_rekening:
            row.nama_rekening,
          nomor_rekening:
            row.nomor_rekening,
          tanggal:
            toIsoDate(
              row.processed_at ??
                row.created_at,
            ),
        }));

      return res.status(200).json({
        success: true,
        history: [
          ...withdrawalHistory,
          ...salesHistory,
        ],
      });
    } catch (error) {
      console.error(
        "Gagal mengambil riwayat saldo:",
        error,
      );

      return res.status(500).json({
        success: false,
        message:
          "Gagal mengambil riwayat saldo.",
        error: error.message,
        code: error.code,
      });
    }
  },
);

// ======================================================
// TARIK SALDO
// POST /seller-balance/:sellerId/withdraw
//
// Versi proyek ini langsung menandai penarikan
// berhasil sebagai simulasi pencairan dana.
// ======================================================

router.post(
  "/:sellerId/withdraw",
  async (req, res) => {
    const sellerId =
      parsePositiveInteger(
        req.params.sellerId,
      );

    const amount =
      parsePositiveNumber(
        req.body.jumlah,
      );

    const method =
      normalizeRequiredText(
        req.body.metode,
      );

    const accountName =
      normalizeRequiredText(
        req.body.nama_rekening,
      );

    const accountNumber =
      normalizeRequiredText(
        req.body.nomor_rekening,
      );

    if (sellerId === null) {
      return res.status(400).json({
        success: false,
        message:
          "ID penjual tidak valid.",
      });
    }

    if (amount === null) {
      return res.status(400).json({
        success: false,
        message:
          "Jumlah penarikan tidak valid.",
      });
    }

    if (amount < 10000) {
      return res.status(400).json({
        success: false,
        message:
          "Minimal penarikan adalah Rp 10.000.",
      });
    }

    if (
      !method ||
      !accountName ||
      !accountNumber
    ) {
      return res.status(400).json({
        success: false,
        message:
          "Data tujuan penarikan belum lengkap.",
      });
    }

    const promisePool = db.promise();

    let connection;

    try {
      connection =
        await promisePool.getConnection();

      await connection.beginTransaction();

      const [salesRows] =
        await connection.execute(
          `
            SELECT
              COALESCE(
                SUM(td.subtotal),
                0
              ) AS total_penjualan

            FROM transaction_details AS td

            INNER JOIN products AS p
              ON p.id_product =
                td.id_product

            INNER JOIN transactions AS t
              ON t.id_transaction =
                td.id_transaction

            WHERE
              p.id_user = ?
              AND t.status = 'selesai'
          `,
          [sellerId],
        );

      const [withdrawalRows] =
        await connection.execute(
          `
            SELECT
              COALESCE(
                SUM(jumlah),
                0
              ) AS total_penarikan

            FROM seller_withdrawals

            WHERE
              id_seller = ?
              AND status IN (
                'menunggu',
                'berhasil'
              )
          `,
          [sellerId],
        );

      const totalPenjualan = toNumber(
        salesRows[0]?.total_penjualan,
      );

      const totalPenarikan = toNumber(
        withdrawalRows[0]
          ?.total_penarikan,
      );

      const availableBalance = Math.max(
        totalPenjualan -
          totalPenarikan,
        0,
      );

      if (amount > availableBalance) {
        await connection.rollback();

        return res.status(400).json({
          success: false,
          message:
            "Saldo tersedia tidak mencukupi.",
          saldo_tersedia:
            availableBalance,
        });
      }

      const [result] =
        await connection.execute(
          `
            INSERT INTO seller_withdrawals (
              id_seller,
              jumlah,
              metode,
              nama_rekening,
              nomor_rekening,
              status,
              processed_at
            )
            VALUES (
              ?,
              ?,
              ?,
              ?,
              ?,
              'berhasil',
              CURRENT_TIMESTAMP
            )
          `,
          [
            sellerId,
            amount,
            method,
            accountName,
            accountNumber,
          ],
        );

      await connection.commit();

      const summary =
        await getSellerSummary(
          sellerId,
        );

      return res.status(201).json({
        success: true,
        message:
          "Penarikan saldo berhasil.",
        id_withdrawal:
          result.insertId,
        summary,
      });
    } catch (error) {
      if (connection) {
        await connection.rollback();
      }

      console.error(
        "Gagal menarik saldo:",
        error,
      );

      return res.status(500).json({
        success: false,
        message:
          "Gagal melakukan penarikan saldo.",
        error: error.message,
        code: error.code,
      });
    } finally {
      if (connection) {
        connection.release();
      }
    }
  },
);

export default router;