import { Router } from "express";
import db from "../config/db.js";

const router = Router();

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

async function ensureWallet(
  connection,
  userId,
) {
  await connection.execute(
    `
      INSERT IGNORE INTO user_wallets (
        id_user,
        saldo
      )
      VALUES (?, 0)
    `,
    [userId],
  );
}

async function getWalletBalance(
  connection,
  userId,
  lockWallet = false,
) {
  const lockClause = lockWallet
    ? " FOR UPDATE"
    : "";

  const [rows] =
    await connection.execute(
      `
        SELECT
          id_user,
          saldo,
          created_at,
          updated_at
        FROM user_wallets
        WHERE id_user = ?
        ${lockClause}
      `,
      [userId],
    );

  if (rows.length === 0) {
    return null;
  }

  return {
    id_user: Number(rows[0].id_user),
    saldo: toNumber(rows[0].saldo),
    created_at: rows[0].created_at,
    updated_at: rows[0].updated_at,
  };
}

// ======================================================
// GET SALDO
// GET /wallets/:userId
// ======================================================

router.get(
  "/:userId",
  async (req, res) => {
    const userId =
      parsePositiveInteger(
        req.params.userId,
      );

    if (userId === null) {
      return res.status(400).json({
        success: false,
        message:
          "ID pengguna tidak valid.",
      });
    }

    try {
      const pool = db.promise();

      await pool.execute(
        `
          INSERT IGNORE INTO user_wallets (
            id_user,
            saldo
          )
          VALUES (?, 0)
        `,
        [userId],
      );

      const [rows] =
        await pool.execute(
          `
            SELECT
              id_user,
              saldo,
              created_at,
              updated_at
            FROM user_wallets
            WHERE id_user = ?
            LIMIT 1
          `,
          [userId],
        );

      return res.status(200).json({
        success: true,
        wallet: {
          id_user: Number(
            rows[0].id_user,
          ),
          saldo: toNumber(
            rows[0].saldo,
          ),
          created_at:
            rows[0].created_at,
          updated_at:
            rows[0].updated_at,
        },
      });
    } catch (error) {
      console.error(
        "Gagal mengambil saldo:",
        error,
      );

      return res.status(500).json({
        success: false,
        message:
          "Gagal mengambil saldo Komotia.",
        error: error.message,
        code: error.code,
      });
    }
  },
);

// ======================================================
// RIWAYAT SALDO
// GET /wallets/:userId/history
// ======================================================

router.get(
  "/:userId/history",
  async (req, res) => {
    const userId =
      parsePositiveInteger(
        req.params.userId,
      );

    if (userId === null) {
      return res.status(400).json({
        success: false,
        message:
          "ID pengguna tidak valid.",
      });
    }

    try {
      const [rows] = await db
        .promise()
        .execute(
          `
            SELECT
              id_wallet_transaction,
              id_user,
              jenis,
              jumlah,
              saldo_sebelum,
              saldo_setelah,
              id_transaction,
              metode,
              keterangan,
              created_at
            FROM wallet_transactions
            WHERE id_user = ?
            ORDER BY
              id_wallet_transaction DESC
          `,
          [userId],
        );

      const history = rows.map(
        (row) => ({
          id_wallet_transaction:
            Number(
              row.id_wallet_transaction,
            ),
          id_user:
            Number(row.id_user),
          jenis: row.jenis,
          jumlah:
            toNumber(row.jumlah),
          saldo_sebelum:
            toNumber(
              row.saldo_sebelum,
            ),
          saldo_setelah:
            toNumber(
              row.saldo_setelah,
            ),
          id_transaction:
            row.id_transaction == null
              ? null
              : Number(
                  row.id_transaction,
                ),
          metode: row.metode,
          keterangan:
            row.keterangan,
          created_at:
            row.created_at,
        }),
      );

      return res.status(200).json({
        success: true,
        history,
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
// TOP UP SALDO
// POST /wallets/:userId/topup
// ======================================================

router.post(
  "/:userId/topup",
  async (req, res) => {
    const userId =
      parsePositiveInteger(
        req.params.userId,
      );

    const amount =
      parsePositiveNumber(
        req.body.jumlah,
      );

    const method =
      normalizeRequiredText(
        req.body.metode,
      ) ?? "simulasi";

    if (userId === null) {
      return res.status(400).json({
        success: false,
        message:
          "ID pengguna tidak valid.",
      });
    }

    if (amount === null) {
      return res.status(400).json({
        success: false,
        message:
          "Nominal top up tidak valid.",
      });
    }

    if (amount < 10000) {
      return res.status(400).json({
        success: false,
        message:
          "Minimal top up Rp 10.000.",
      });
    }

    let connection;

    try {
      connection = await db
        .promise()
        .getConnection();

      await connection
        .beginTransaction();

      await ensureWallet(
        connection,
        userId,
      );

      const wallet =
        await getWalletBalance(
          connection,
          userId,
          true,
        );

      const previousBalance =
        wallet?.saldo ?? 0;

      const newBalance =
        previousBalance + amount;

      await connection.execute(
        `
          UPDATE user_wallets
          SET saldo = ?
          WHERE id_user = ?
        `,
        [
          newBalance,
          userId,
        ],
      );

      const [historyResult] =
        await connection.execute(
          `
            INSERT INTO wallet_transactions (
              id_user,
              jenis,
              jumlah,
              saldo_sebelum,
              saldo_setelah,
              id_transaction,
              metode,
              keterangan
            )
            VALUES (
              ?,
              'topup',
              ?,
              ?,
              ?,
              NULL,
              ?,
              ?
            )
          `,
          [
            userId,
            amount,
            previousBalance,
            newBalance,
            method,
            `Top up melalui ${method}`,
          ],
        );

      await connection.commit();

      return res.status(201).json({
        success: true,
        message:
          "Top up saldo berhasil.",
        id_wallet_transaction:
          historyResult.insertId,
        saldo_sebelum:
          previousBalance,
        jumlah: amount,
        saldo: newBalance,
      });
    } catch (error) {
      if (connection) {
        await connection.rollback();
      }

      console.error(
        "Gagal top up saldo:",
        error,
      );

      return res.status(500).json({
        success: false,
        message:
          "Gagal melakukan top up saldo.",
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

// ======================================================
// CHECKOUT MENGGUNAKAN SALDO
// POST /wallets/:userId/pay-checkout
// ======================================================

router.post(
  "/:userId/pay-checkout",
  async (req, res) => {
    const userId =
      parsePositiveInteger(
        req.params.userId,
      );

    const address =
      normalizeRequiredText(
        req.body.alamat_pengiriman,
      );

    const rawItems =
      req.body.items;

    if (userId === null) {
      return res.status(400).json({
        success: false,
        message:
          "ID pengguna tidak valid.",
      });
    }

    if (!address) {
      return res.status(400).json({
        success: false,
        message:
          "Alamat pengiriman wajib diisi.",
      });
    }

    if (
      !Array.isArray(rawItems) ||
      rawItems.length === 0
    ) {
      return res.status(400).json({
        success: false,
        message:
          "Produk checkout tidak tersedia.",
      });
    }

    const normalizedItems = [];

    for (const rawItem of rawItems) {
      const productId =
        parsePositiveInteger(
          rawItem.id_product,
        );

      const quantity =
        parsePositiveInteger(
          rawItem.jumlah,
        );

      if (
        productId === null ||
        quantity === null
      ) {
        return res.status(400).json({
          success: false,
          message:
            "Data produk checkout tidak valid.",
        });
      }

      normalizedItems.push({
        id_product: productId,
        jumlah: quantity,
      });
    }

    let connection;

    try {
      connection = await db
        .promise()
        .getConnection();

      await connection
        .beginTransaction();

      await ensureWallet(
        connection,
        userId,
      );

      const wallet =
        await getWalletBalance(
          connection,
          userId,
          true,
        );

      const productIds = [
        ...new Set(
          normalizedItems.map(
            (item) =>
              item.id_product,
          ),
        ),
      ];

      const placeholders =
        productIds
          .map(() => "?")
          .join(",");

      const [products] =
        await connection.query(
          `
            SELECT
              id_product,
              nama_product,
              harga,
              stok
            FROM products
            WHERE id_product IN (
              ${placeholders}
            )
            FOR UPDATE
          `,
          productIds,
        );

      if (
        products.length !==
        productIds.length
      ) {
        await connection.rollback();

        return res.status(404).json({
          success: false,
          message:
            "Salah satu produk tidak ditemukan.",
        });
      }

      const productMap = new Map();

      for (const product of products) {
        productMap.set(
          Number(product.id_product),
          product,
        );
      }

      let subtotal = 0;

      const checkoutItems = [];

      for (
        const item
        of normalizedItems
      ) {
        const product =
          productMap.get(
            item.id_product,
          );

        const price =
          toNumber(product.harga);

        const stock =
          Number(product.stok ?? 0);

        if (
          stock < item.jumlah
        ) {
          await connection.rollback();

          return res.status(400).json({
            success: false,
            message:
              `Stok ${product.nama_product} ` +
              `tidak mencukupi.`,
          });
        }

        const itemSubtotal =
          price * item.jumlah;

        subtotal += itemSubtotal;

        checkoutItems.push({
          id_product:
            item.id_product,
          jumlah:
            item.jumlah,
          harga_satuan:
            price,
          subtotal:
            itemSubtotal,
        });
      }

      const shippingCost = 25000;

      const tax = Math.round(
        subtotal * 0.11,
      );

      const total =
        subtotal +
        shippingCost +
        tax;

      const previousBalance =
        wallet?.saldo ?? 0;

      if (previousBalance < total) {
        await connection.rollback();

        return res.status(400).json({
          success: false,
          message:
            "Saldo Komotia tidak mencukupi.",
          saldo:
            previousBalance,
          total_pembayaran:
            total,
          kekurangan:
            total - previousBalance,
        });
      }

      const [transactionResult] =
        await connection.execute(
          `
            INSERT INTO transactions (
              id_user,
              total_harga,
              status,
              alamat_pengiriman,
              metode_pembayaran
            )
            VALUES (
              ?,
              ?,
              'dibayar',
              ?,
              'saldo'
            )
          `,
          [
            userId,
            total,
            address,
          ],
        );

      const transactionId =
        transactionResult.insertId;

      for (
        const item
        of checkoutItems
      ) {
        await connection.execute(
          `
            INSERT INTO transaction_details (
              id_transaction,
              id_product,
              jumlah,
              harga_satuan,
              subtotal
            )
            VALUES (?, ?, ?, ?, ?)
          `,
          [
            transactionId,
            item.id_product,
            item.jumlah,
            item.harga_satuan,
            item.subtotal,
          ],
        );

        const [stockResult] =
          await connection.execute(
            `
              UPDATE products
              SET stok = stok - ?
              WHERE
                id_product = ?
                AND stok >= ?
            `,
            [
              item.jumlah,
              item.id_product,
              item.jumlah,
            ],
          );

        if (
          stockResult.affectedRows === 0
        ) {
          throw new Error(
            "Stok produk berubah saat checkout.",
          );
        }
      }

      const [paymentResult] =
        await connection.execute(
          `
            INSERT INTO payments (
              id_transaction,
              tanggal_bayar,
              jumlah_bayar,
              bukti_transfer,
              status_verifikasi
            )
            VALUES (
              ?,
              CURRENT_TIMESTAMP,
              ?,
              NULL,
              'diterima'
            )
          `,
          [
            transactionId,
            total,
          ],
        );

      const newBalance =
        previousBalance - total;

      const [walletUpdateResult] =
        await connection.execute(
          `
            UPDATE user_wallets
            SET saldo = saldo - ?
            WHERE
              id_user = ?
              AND saldo >= ?
          `,
          [
            total,
            userId,
            total,
          ],
        );

      if (
        walletUpdateResult.affectedRows ===
        0
      ) {
        throw new Error(
          "Saldo berubah saat pembayaran.",
        );
      }

      const [historyResult] =
        await connection.execute(
          `
            INSERT INTO wallet_transactions (
              id_user,
              jenis,
              jumlah,
              saldo_sebelum,
              saldo_setelah,
              id_transaction,
              metode,
              keterangan
            )
            VALUES (
              ?,
              'pembayaran',
              ?,
              ?,
              ?,
              ?,
              'saldo',
              ?
            )
          `,
          [
            userId,
            total,
            previousBalance,
            newBalance,
            transactionId,
            `Pembayaran pesanan #${transactionId}`,
          ],
        );

      await connection.commit();

      return res.status(201).json({
        success: true,
        message:
          "Pembayaran dengan Saldo Komotia berhasil.",
        id_transaction:
          transactionId,
        id_payment:
          paymentResult.insertId,
        id_wallet_transaction:
          historyResult.insertId,
        subtotal,
        pengiriman:
          shippingCost,
        pajak: tax,
        total_bayar: total,
        saldo_sebelum:
          previousBalance,
        saldo_tersisa:
          newBalance,
        status:
          "dibayar",
        status_verifikasi:
          "diterima",
      });
    } catch (error) {
      if (connection) {
        await connection.rollback();
      }

      console.error(
        "Gagal checkout dengan saldo:",
        error,
      );

      return res.status(500).json({
        success: false,
        message:
          "Gagal melakukan pembayaran dengan saldo.",
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
