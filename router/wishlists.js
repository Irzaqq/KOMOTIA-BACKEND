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

function buildImageUrl(req, imagePath) {
  if (!imagePath) {
    return null;
  }

  const value = String(imagePath).trim();

  if (
    value.startsWith("http://") ||
    value.startsWith("https://")
  ) {
    return value;
  }

  if (
    value === "default.jpg" ||
    value === "default.jpeg" ||
    value === "default.png"
  ) {
    return null;
  }

  const normalizedPath =
    value.startsWith("/")
      ? value
      : `/${value}`;

  return (
    `${req.protocol}://` +
    `${req.get("host")}` +
    normalizedPath
  );
}

// ======================================================
// GET WISHLIST PENGGUNA
// GET /wishlists/user/:idUser
// ======================================================

router.get(
  "/user/:idUser",
  async (req, res) => {
    const userId =
      parsePositiveInteger(
        req.params.idUser,
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
              w.id_wishlist,
              w.created_at,

              p.id_product,
              p.nama_product,
              p.deskripsi,

              p.harga,
              p.harga AS price,

              p.stok,
              p.satuan,
              p.gambar,
              p.id_user,
              p.id_category,

              NULL AS category

            FROM wishlists AS w

            INNER JOIN products AS p
              ON p.id_product =
                w.id_product

            WHERE w.id_user = ?

            ORDER BY
              w.id_wishlist DESC
          `,
          [userId],
        );

      const wishlist = rows.map(
        (row) => ({
          ...row,
          gambar_url: buildImageUrl(
            req,
            row.gambar,
          ),
        }),
      );

      return res.status(200).json({
        success: true,
        count: wishlist.length,
        wishlist,
      });
    } catch (error) {
      console.error(
        "Gagal mengambil wishlist:",
        error,
      );

      return res.status(500).json({
        success: false,
        message:
          "Gagal mengambil wishlist.",
        error: error.message,
        code: error.code,
      });
    }
  },
);

// ======================================================
// CEK PRODUK DI WISHLIST
// GET /wishlists/user/:idUser/product/:idProduct
// ======================================================

router.get(
  "/user/:idUser/product/:idProduct",
  async (req, res) => {
    const userId =
      parsePositiveInteger(
        req.params.idUser,
      );

    const productId =
      parsePositiveInteger(
        req.params.idProduct,
      );

    if (
      userId === null ||
      productId === null
    ) {
      return res.status(400).json({
        success: false,
        message:
          "ID pengguna atau produk tidak valid.",
      });
    }

    try {
      const [rows] = await db
        .promise()
        .execute(
          `
            SELECT
              id_wishlist
            FROM wishlists
            WHERE
              id_user = ?
              AND id_product = ?
            LIMIT 1
          `,
          [
            userId,
            productId,
          ],
        );

      return res.status(200).json({
        success: true,
        is_wishlisted:
          rows.length > 0,
        id_wishlist:
          rows.length > 0
            ? Number(
                rows[0].id_wishlist,
              )
            : null,
      });
    } catch (error) {
      console.error(
        "Gagal memeriksa wishlist:",
        error,
      );

      return res.status(500).json({
        success: false,
        message:
          "Gagal memeriksa wishlist.",
        error: error.message,
        code: error.code,
      });
    }
  },
);

// ======================================================
// TAMBAH PRODUK KE WISHLIST
// POST /wishlists
// ======================================================

router.post("/", async (req, res) => {
  const userId =
    parsePositiveInteger(
      req.body.id_user,
    );

  const productId =
    parsePositiveInteger(
      req.body.id_product,
    );

  if (
    userId === null ||
    productId === null
  ) {
    return res.status(400).json({
      success: false,
      message:
        "ID pengguna atau produk tidak valid.",
    });
  }

  try {
    const [users] = await db
      .promise()
      .execute(
        `
          SELECT id_user
          FROM users
          WHERE id_user = ?
          LIMIT 1
        `,
        [userId],
      );

    if (users.length === 0) {
      return res.status(404).json({
        success: false,
        message:
          "Pengguna tidak ditemukan.",
      });
    }

    const [products] = await db
      .promise()
      .execute(
        `
          SELECT id_product
          FROM products
          WHERE id_product = ?
          LIMIT 1
        `,
        [productId],
      );

    if (products.length === 0) {
      return res.status(404).json({
        success: false,
        message:
          "Produk tidak ditemukan.",
      });
    }

    const [existingRows] = await db
      .promise()
      .execute(
        `
          SELECT id_wishlist
          FROM wishlists
          WHERE
            id_user = ?
            AND id_product = ?
          LIMIT 1
        `,
        [
          userId,
          productId,
        ],
      );

    if (existingRows.length > 0) {
      return res.status(200).json({
        success: true,
        already_exists: true,
        message:
          "Produk sudah ada di wishlist.",
        id_wishlist: Number(
          existingRows[0].id_wishlist,
        ),
      });
    }

    const [result] = await db
      .promise()
      .execute(
        `
          INSERT INTO wishlists (
            id_user,
            id_product
          )
          VALUES (?, ?)
        `,
        [
          userId,
          productId,
        ],
      );

    return res.status(201).json({
      success: true,
      already_exists: false,
      message:
        "Produk berhasil ditambahkan ke wishlist.",
      id_wishlist:
        result.insertId,
    });
  } catch (error) {
    console.error(
      "Gagal menambahkan wishlist:",
      error,
    );

    return res.status(500).json({
      success: false,
      message:
        "Gagal menambahkan produk ke wishlist.",
      error: error.message,
      code: error.code,
    });
  }
});

// ======================================================
// HAPUS PRODUK DARI WISHLIST
// DELETE /wishlists/user/:idUser/product/:idProduct
// ======================================================

router.delete(
  "/user/:idUser/product/:idProduct",
  async (req, res) => {
    const userId =
      parsePositiveInteger(
        req.params.idUser,
      );

    const productId =
      parsePositiveInteger(
        req.params.idProduct,
      );

    if (
      userId === null ||
      productId === null
    ) {
      return res.status(400).json({
        success: false,
        message:
          "ID pengguna atau produk tidak valid.",
      });
    }

    try {
      const [result] = await db
        .promise()
        .execute(
          `
            DELETE FROM wishlists
            WHERE
              id_user = ?
              AND id_product = ?
          `,
          [
            userId,
            productId,
          ],
        );

      return res.status(200).json({
        success: true,
        removed:
          result.affectedRows > 0,
        message:
          result.affectedRows > 0
            ? "Produk berhasil dihapus dari wishlist."
            : "Produk tidak ada di wishlist.",
      });
    } catch (error) {
      console.error(
        "Gagal menghapus wishlist:",
        error,
      );

      return res.status(500).json({
        success: false,
        message:
          "Gagal menghapus produk dari wishlist.",
        error: error.message,
        code: error.code,
      });
    }
  },
);

// ======================================================
// HAPUS SEMUA WISHLIST
// DELETE /wishlists/user/:idUser
// ======================================================

router.delete(
  "/user/:idUser",
  async (req, res) => {
    const userId =
      parsePositiveInteger(
        req.params.idUser,
      );

    if (userId === null) {
      return res.status(400).json({
        success: false,
        message:
          "ID pengguna tidak valid.",
      });
    }

    try {
      const [result] = await db
        .promise()
        .execute(
          `
            DELETE FROM wishlists
            WHERE id_user = ?
          `,
          [userId],
        );

      return res.status(200).json({
        success: true,
        deleted_count:
          result.affectedRows,
        message:
          "Wishlist berhasil dikosongkan.",
      });
    } catch (error) {
      console.error(
        "Gagal mengosongkan wishlist:",
        error,
      );

      return res.status(500).json({
        success: false,
        message:
          "Gagal mengosongkan wishlist.",
        error: error.message,
        code: error.code,
      });
    }
  },
);

export default router;

