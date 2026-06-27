import { Router } from "express";
import db from "../config/db.js";

const router = Router();

const RETRYABLE_DATABASE_ERRORS = new Set([
  "ECONNRESET",
  "ETIMEDOUT",
  "EPIPE",
  "PROTOCOL_CONNECTION_LOST",
]);

// Status selesai hanya dapat diberikan melalui konfirmasi pembeli.
const DIRECT_UPDATE_STATUSES = [
  "pending",
  "dibayar",
  "diproses",
  "dikirim",
  "dibatalkan",
];

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

      const delay =
        300 * (attempt + 1);

      console.warn(
        `[TRANSACTION DB] ${error.code}. ` +
          `Percobaan ulang ${attempt + 1}/` +
          `${maxRetries} dalam ${delay} ms.`,
      );

      await wait(delay);
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

function parseNonNegativeNumber(value) {
  const parsedValue = Number(value);

  if (
    !Number.isFinite(parsedValue) ||
    parsedValue < 0
  ) {
    return null;
  }

  return parsedValue;
}

function normalizeOptionalText(value) {
  if (
    value === undefined ||
    value === null
  ) {
    return null;
  }

  const text = String(value).trim();

  return text === "" ? null : text;
}

function normalizeStatus(value) {
  return String(
    value ?? "pending",
  )
    .trim()
    .toLowerCase();
}

function mapSellerOrders(rows) {
  const orderMap = new Map();

  for (const row of rows) {
    const transactionId = Number(
      row.id_transaction,
    );

    if (!orderMap.has(transactionId)) {
      orderMap.set(transactionId, {
        id_transaction: transactionId,

        id_pembeli: Number(
          row.id_pembeli,
        ),

        nama_pembeli:
          row.nama_pembeli ??
          "Pembeli",

        no_telp_pembeli:
          row.no_telp_pembeli ??
          null,

        total_harga: Number(
          row.total_harga ?? 0,
        ),

        total_penjual: 0,

        status: normalizeStatus(
          row.status,
        ),

        alamat_pengiriman:
          row.alamat_pengiriman ??
          "-",

        metode_pembayaran:
          row.metode_pembayaran ??
          "-",

        created_at:
          row.created_at ?? null,

        items: [],
      });
    }

    const order = orderMap.get(
      transactionId,
    );

    const subtotal = Number(
      row.subtotal ?? 0,
    );

    order.total_penjual += subtotal;

    order.items.push({
      id_detail: Number(
        row.id_detail,
      ),

      id_product: Number(
        row.id_product,
      ),

      nama_product:
        row.nama_product ??
        "Produk",

      deskripsi:
        row.deskripsi ?? null,

      jumlah: Number(
        row.jumlah ?? 0,
      ),

      harga_satuan: Number(
        row.harga_satuan ?? 0,
      ),

      subtotal,

      satuan:
        row.satuan ?? "pcs",

      gambar:
        row.gambar ?? null,

      id_category:
        row.id_category === null ||
        row.id_category === undefined
          ? null
          : Number(
              row.id_category,
            ),
    });
  }

  return Array.from(
    orderMap.values(),
  );
}

function mapBuyerOrders(rows) {
  const orderMap = new Map();

  for (const row of rows) {
    const transactionId = Number(
      row.id_transaction,
    );

    if (!orderMap.has(transactionId)) {
      orderMap.set(transactionId, {
        id_transaction: transactionId,

        id_pembeli: Number(
          row.id_pembeli,
        ),

        total_harga: Number(
          row.total_harga ?? 0,
        ),

        status: normalizeStatus(
          row.status,
        ),

        alamat_pengiriman:
          row.alamat_pengiriman ??
          "-",

        metode_pembayaran:
          row.metode_pembayaran ??
          "-",

        created_at:
          row.created_at ?? null,

        items: [],
      });
    }

    orderMap
      .get(transactionId)
      .items
      .push({
        id_detail: Number(
          row.id_detail,
        ),

        id_product: Number(
          row.id_product,
        ),

        nama_product:
          row.nama_product ??
          "Produk",

        deskripsi:
          row.deskripsi ?? null,

        jumlah: Number(
          row.jumlah ?? 0,
        ),

        harga_satuan: Number(
          row.harga_satuan ?? 0,
        ),

        subtotal: Number(
          row.subtotal ?? 0,
        ),

        satuan:
          row.satuan ?? "pcs",

        gambar:
          row.gambar ?? null,

        id_penjual: Number(
          row.id_penjual,
        ),

        nama_toko:
          row.nama_toko ??
          row.nama_penjual ??
          "Toko Komotia",
      });
  }

  return Array.from(
    orderMap.values(),
  );
}

// =====================================================
// GET SEMUA TRANSAKSI
// GET /transactions
// =====================================================

router.get("/", async (req, res) => {
  try {
    const [transactions] =
      await executeWithRetry(`
        SELECT
          id_transaction,
          id_user,
          total_harga,
          status,
          alamat_pengiriman,
          metode_pembayaran,
          created_at
        FROM transactions
        ORDER BY
          created_at DESC,
          id_transaction DESC
      `);

    return res
      .status(200)
      .json(transactions);
  } catch (error) {
    console.error(
      "Gagal mengambil transaksi:",
      error,
    );

    return res.status(500).json({
      success: false,
      message:
        "Gagal mengambil data transaksi.",
      error: error.message,
      code: error.code,
    });
  }
});

// =====================================================
// GET PESANAN PENJUAL
// GET /transactions/seller/:id_user
// =====================================================

router.get(
  "/seller/:id_user",
  async (req, res) => {
    const sellerId =
      parsePositiveInteger(
        req.params.id_user,
      );

    if (sellerId === null) {
      return res.status(400).json({
        success: false,
        message:
          "ID penjual tidak valid.",
      });
    }

    try {
      const [rows] =
        await executeWithRetry(
          `
            SELECT
              t.id_transaction,
              t.id_user AS id_pembeli,

              u.nama AS nama_pembeli,
              u.no_telp AS no_telp_pembeli,

              t.total_harga,
              t.status,
              t.alamat_pengiriman,
              t.metode_pembayaran,
              t.created_at,

              td.id_detail,
              td.id_product,
              td.jumlah,
              td.harga_satuan,
              td.subtotal,

              p.nama_product,
              p.deskripsi,
              p.satuan,
              p.gambar,
              p.id_category

            FROM transactions AS t

            INNER JOIN transaction_details AS td
              ON td.id_transaction =
                t.id_transaction

            INNER JOIN products AS p
              ON p.id_product =
                td.id_product

            LEFT JOIN users AS u
              ON u.id_user =
                t.id_user

            WHERE p.id_user = ?

            ORDER BY
              t.created_at DESC,
              t.id_transaction DESC,
              td.id_detail ASC
          `,
          [sellerId],
        );

      return res.status(200).json({
        success: true,
        orders:
          mapSellerOrders(rows),
      });
    } catch (error) {
      console.error(
        "Gagal mengambil pesanan penjual:",
        error,
      );

      return res.status(500).json({
        success: false,
        message:
          "Gagal mengambil pesanan penjual.",
        error: error.message,
        code: error.code,
      });
    }
  },
);

// =====================================================
// GET PESANAN PEMBELI BESERTA PRODUK
// GET /transactions/buyer/:id_user
// =====================================================

router.get(
  "/buyer/:id_user",
  async (req, res) => {
    const buyerId =
      parsePositiveInteger(
        req.params.id_user,
      );

    if (buyerId === null) {
      return res.status(400).json({
        success: false,
        message:
          "ID pembeli tidak valid.",
      });
    }

    try {
      const [rows] =
        await executeWithRetry(
          `
            SELECT
              t.id_transaction,
              t.id_user AS id_pembeli,
              t.total_harga,
              t.status,
              t.alamat_pengiriman,
              t.metode_pembayaran,
              t.created_at,

              td.id_detail,
              td.id_product,
              td.jumlah,
              td.harga_satuan,
              td.subtotal,

              p.nama_product,
              p.deskripsi,
              p.satuan,
              p.gambar,
              p.id_user AS id_penjual,

              seller.nama AS nama_penjual,
              seller.nama_toko

            FROM transactions AS t

            INNER JOIN transaction_details AS td
              ON td.id_transaction =
                t.id_transaction

            INNER JOIN products AS p
              ON p.id_product =
                td.id_product

            LEFT JOIN users AS seller
              ON seller.id_user =
                p.id_user

            WHERE t.id_user = ?

            ORDER BY
              t.created_at DESC,
              t.id_transaction DESC,
              td.id_detail ASC
          `,
          [buyerId],
        );

      return res.status(200).json({
        success: true,
        orders:
          mapBuyerOrders(rows),
      });
    } catch (error) {
      console.error(
        "Gagal mengambil pesanan pembeli:",
        error,
      );

      return res.status(500).json({
        success: false,
        message:
          "Gagal mengambil pesanan pembeli.",
        error: error.message,
        code: error.code,
      });
    }
  },
);

// =====================================================
// GET TRANSAKSI PEMBELI
// GET /transactions/user/:id_user
// =====================================================

router.get(
  "/user/:id_user",
  async (req, res) => {
    const userId =
      parsePositiveInteger(
        req.params.id_user,
      );

    if (userId === null) {
      return res.status(400).json({
        success: false,
        message:
          "ID pengguna tidak valid.",
      });
    }

    try {
      const [transactions] =
        await executeWithRetry(
          `
            SELECT
              id_transaction,
              id_user,
              total_harga,
              status,
              alamat_pengiriman,
              metode_pembayaran,
              created_at
            FROM transactions
            WHERE id_user = ?
            ORDER BY
              created_at DESC,
              id_transaction DESC
          `,
          [userId],
        );

      return res
        .status(200)
        .json(transactions);
    } catch (error) {
      console.error(
        "Gagal mengambil transaksi pengguna:",
        error,
      );

      return res.status(500).json({
        success: false,
        message:
          "Gagal mengambil transaksi pengguna.",
        error: error.message,
        code: error.code,
      });
    }
  },
);

// =====================================================
// GET TRANSAKSI BERDASARKAN ID
// GET /transactions/:id
// =====================================================

router.get(
  "/:id",
  async (req, res) => {
    const transactionId =
      parsePositiveInteger(
        req.params.id,
      );

    if (transactionId === null) {
      return res.status(400).json({
        success: false,
        message:
          "ID transaksi tidak valid.",
      });
    }

    try {
      const [transactions] =
        await executeWithRetry(
          `
            SELECT
              id_transaction,
              id_user,
              total_harga,
              status,
              alamat_pengiriman,
              metode_pembayaran,
              created_at
            FROM transactions
            WHERE id_transaction = ?
            LIMIT 1
          `,
          [transactionId],
        );

      if (
        transactions.length === 0
      ) {
        return res.status(404).json({
          success: false,
          message:
            "Transaksi tidak ditemukan.",
        });
      }

      return res
        .status(200)
        .json(transactions[0]);
    } catch (error) {
      console.error(
        "Gagal mengambil transaksi:",
        error,
      );

      return res.status(500).json({
        success: false,
        message:
          "Gagal mengambil transaksi.",
        error: error.message,
        code: error.code,
      });
    }
  },
);

// =====================================================
// BUAT TRANSAKSI
// POST /transactions
// =====================================================

router.post("/", async (req, res) => {
  const userId =
    parsePositiveInteger(
      req.body.id_user,
    );

  const totalHarga =
    parseNonNegativeNumber(
      req.body.total_harga,
    );

  const status =
    normalizeStatus(
      req.body.status,
    );

  const alamatPengiriman =
    normalizeOptionalText(
      req.body.alamat_pengiriman,
    );

  const metodePembayaran =
    normalizeOptionalText(
      req.body.metode_pembayaran,
    );

  if (userId === null) {
    return res.status(400).json({
      success: false,
      message:
        "ID pengguna tidak valid.",
    });
  }

  if (totalHarga === null) {
    return res.status(400).json({
      success: false,
      message:
        "Total harga tidak valid.",
    });
  }

  if (
    !DIRECT_UPDATE_STATUSES.includes(
      status,
    )
  ) {
    return res.status(400).json({
      success: false,
      message:
        `Status awal tidak valid. ` +
        `Pilihan: ` +
        `${DIRECT_UPDATE_STATUSES.join(", ")}.`,
    });
  }

  try {
    const [result] =
      await executeWithRetry(
        `
          INSERT INTO transactions (
            id_user,
            total_harga,
            status,
            alamat_pengiriman,
            metode_pembayaran
          )
          VALUES (?, ?, ?, ?, ?)
        `,
        [
          userId,
          totalHarga,
          status,
          alamatPengiriman,
          metodePembayaran,
        ],
      );

    return res.status(201).json({
      success: true,
      message:
        "Transaksi berhasil dibuat.",
      id_transaction:
        result.insertId,
    });
  } catch (error) {
    console.error(
      "Gagal membuat transaksi:",
      error,
    );

    return res.status(500).json({
      success: false,
      message:
        "Gagal membuat transaksi.",
      error: error.message,
      code: error.code,
    });
  }
});

// =====================================================
// UPDATE TRANSAKSI
// PUT /transactions/:id
// =====================================================

router.put(
  "/:id",
  async (req, res) => {
    const transactionId =
      parsePositiveInteger(
        req.params.id,
      );

    const totalHarga =
      parseNonNegativeNumber(
        req.body.total_harga,
      );

    const status =
      normalizeStatus(
        req.body.status,
      );

    const alamatPengiriman =
      normalizeOptionalText(
        req.body.alamat_pengiriman,
      );

    const metodePembayaran =
      normalizeOptionalText(
        req.body.metode_pembayaran,
      );

    if (transactionId === null) {
      return res.status(400).json({
        success: false,
        message:
          "ID transaksi tidak valid.",
      });
    }

    if (totalHarga === null) {
      return res.status(400).json({
        success: false,
        message:
          "Total harga tidak valid.",
      });
    }

    if (
      !DIRECT_UPDATE_STATUSES.includes(
        status,
      )
    ) {
      return res.status(403).json({
        success: false,
        message:
          "Status selesai hanya dapat " +
          "dikonfirmasi oleh pembeli.",
      });
    }

    try {
      const [result] =
        await executeWithRetry(
          `
            UPDATE transactions
            SET
              total_harga = ?,
              status = ?,
              alamat_pengiriman = ?,
              metode_pembayaran = ?
            WHERE id_transaction = ?
          `,
          [
            totalHarga,
            status,
            alamatPengiriman,
            metodePembayaran,
            transactionId,
          ],
        );

      if (
        result.affectedRows === 0
      ) {
        return res.status(404).json({
          success: false,
          message:
            "Transaksi tidak ditemukan.",
        });
      }

      return res.status(200).json({
        success: true,
        message:
          "Transaksi berhasil diperbarui.",
      });
    } catch (error) {
      console.error(
        "Gagal memperbarui transaksi:",
        error,
      );

      return res.status(500).json({
        success: false,
        message:
          "Gagal memperbarui transaksi.",
        error: error.message,
        code: error.code,
      });
    }
  },
);

// =====================================================
// UPDATE STATUS OLEH PENJUAL
// PATCH /transactions/:id/status
// =====================================================

router.patch(
  "/:id/status",
  async (req, res) => {
    const transactionId =
      parsePositiveInteger(
        req.params.id,
      );

    const status =
      normalizeStatus(
        req.body.status,
      );

    if (transactionId === null) {
      return res.status(400).json({
        success: false,
        message:
          "ID transaksi tidak valid.",
      });
    }

    if (status === "selesai") {
      return res.status(403).json({
        success: false,
        message:
          "Status selesai hanya dapat " +
          "dikonfirmasi oleh pembeli.",
      });
    }

    if (
      !DIRECT_UPDATE_STATUSES.includes(
        status,
      )
    ) {
      return res.status(400).json({
        success: false,
        message:
          `Status tidak valid. Pilihan: ` +
          `${DIRECT_UPDATE_STATUSES.join(", ")}.`,
      });
    }

    try {
      const [result] =
        await executeWithRetry(
          `
            UPDATE transactions
            SET status = ?
            WHERE id_transaction = ?
          `,
          [
            status,
            transactionId,
          ],
        );

      if (
        result.affectedRows === 0
      ) {
        return res.status(404).json({
          success: false,
          message:
            "Transaksi tidak ditemukan.",
        });
      }

      return res.status(200).json({
        success: true,
        message:
          `Status transaksi berhasil ` +
          `diubah menjadi '${status}'.`,
        status,
      });
    } catch (error) {
      console.error(
        "Gagal mengubah status transaksi:",
        error,
      );

      return res.status(500).json({
        success: false,
        message:
          "Gagal mengubah status transaksi.",
        error: error.message,
        code: error.code,
      });
    }
  },
);

// =====================================================
// KONFIRMASI PESANAN SELESAI OLEH PEMBELI
// PATCH /transactions/:id/confirm-complete
// =====================================================

router.patch(
  "/:id/confirm-complete",
  async (req, res) => {
    const transactionId =
      parsePositiveInteger(
        req.params.id,
      );

    const buyerId =
      parsePositiveInteger(
        req.body.id_user,
      );

    if (transactionId === null) {
      return res.status(400).json({
        success: false,
        message:
          "ID transaksi tidak valid.",
      });
    }

    if (buyerId === null) {
      return res.status(400).json({
        success: false,
        message:
          "ID pembeli tidak valid.",
      });
    }

    try {
      const [transactions] =
        await executeWithRetry(
          `
            SELECT
              id_transaction,
              id_user,
              status
            FROM transactions
            WHERE id_transaction = ?
            LIMIT 1
          `,
          [transactionId],
        );

      if (
        transactions.length === 0
      ) {
        return res.status(404).json({
          success: false,
          message:
            "Transaksi tidak ditemukan.",
        });
      }

      const transaction =
        transactions[0];

      if (
        Number(transaction.id_user) !==
        buyerId
      ) {
        return res.status(403).json({
          success: false,
          message:
            "Hanya pembeli pemilik " +
            "transaksi yang dapat " +
            "menyelesaikan pesanan.",
        });
      }

      const currentStatus =
        normalizeStatus(
          transaction.status,
        );

      if (
        currentStatus === "selesai"
      ) {
        return res.status(200).json({
          success: true,
          message:
            "Pesanan sudah berstatus selesai.",
          status: "selesai",
        });
      }

      if (
        currentStatus !== "dikirim"
      ) {
        return res.status(409).json({
          success: false,
          message:
            "Pesanan hanya dapat " +
            "diselesaikan setelah " +
            "berstatus dikirim.",
          status: currentStatus,
        });
      }

      const [result] =
        await executeWithRetry(
          `
            UPDATE transactions
            SET status = 'selesai'
            WHERE id_transaction = ?
              AND id_user = ?
              AND status = 'dikirim'
          `,
          [
            transactionId,
            buyerId,
          ],
        );

      if (
        result.affectedRows === 0
      ) {
        return res.status(409).json({
          success: false,
          message:
            "Status transaksi berubah. " +
            "Muat ulang data pesanan dan coba lagi.",
        });
      }

      return res.status(200).json({
        success: true,
        message:
          "Pesanan berhasil dikonfirmasi " +
          "telah diterima.",
        status: "selesai",
      });
    } catch (error) {
      console.error(
        "Gagal menyelesaikan pesanan:",
        error,
      );

      return res.status(500).json({
        success: false,
        message:
          "Gagal menyelesaikan pesanan.",
        error: error.message,
        code: error.code,
      });
    }
  },
);

// =====================================================
// HAPUS TRANSAKSI
// DELETE /transactions/:id
// =====================================================

router.delete(
  "/:id",
  async (req, res) => {
    const transactionId =
      parsePositiveInteger(
        req.params.id,
      );

    if (transactionId === null) {
      return res.status(400).json({
        success: false,
        message:
          "ID transaksi tidak valid.",
      });
    }

    try {
      const [result] =
        await executeWithRetry(
          `
            DELETE FROM transactions
            WHERE id_transaction = ?
          `,
          [transactionId],
        );

      if (
        result.affectedRows === 0
      ) {
        return res.status(404).json({
          success: false,
          message:
            "Transaksi tidak ditemukan.",
        });
      }

      return res.status(200).json({
        success: true,
        message:
          `Transaksi dengan ID ` +
          `${transactionId} berhasil dihapus.`,
      });
    } catch (error) {
      console.error(
        "Gagal menghapus transaksi:",
        error,
      );

      return res.status(500).json({
        success: false,
        message:
          "Gagal menghapus transaksi.",
        error: error.message,
        code: error.code,
      });
    }
  },
);

export default router;

