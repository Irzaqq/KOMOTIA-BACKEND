import { Router } from "express";
import fs from "fs";
import path from "path";

import db from "../config/db.js";
import uploadProductImage from "../middleware/uploadProductImage.js";

const router = Router();

// ======================================================
// HELPER
// ======================================================

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

function parseNonNegativeInteger(value) {
  const parsedValue = Number(value);

  if (
    !Number.isInteger(parsedValue) ||
    parsedValue < 0
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

function removeUploadedFile(file) {
  if (!file?.path) {
    return;
  }

  fs.unlink(file.path, (error) => {
    if (
      error &&
      error.code !== "ENOENT"
    ) {
      console.error(
        "Gagal menghapus file upload:",
        error,
      );
    }
  });
}

function removeProductImage(imagePath) {
  if (
    !imagePath ||
    !imagePath.startsWith(
      "/uploads/products/",
    )
  ) {
    return;
  }

  const relativePath =
    imagePath.replace(/^\/+/, "");

  const physicalPath = path.join(
    process.cwd(),
    relativePath,
  );

  fs.unlink(physicalPath, (error) => {
    if (
      error &&
      error.code !== "ENOENT"
    ) {
      console.error(
        "Gagal menghapus foto produk:",
        error,
      );
    }
  });
}

function productImageUpload(
  req,
  res,
  next,
) {
  uploadProductImage.single("gambar")(
    req,
    res,
    (error) => {
      if (error) {
        return res.status(400).json({
          success: false,
          message: error.message,
        });
      }

      next();
    },
  );
}

function buildImageUrl(req, imagePath) {
  if (!imagePath) {
    return null;
  }

  if (
    imagePath.startsWith("http://") ||
    imagePath.startsWith("https://")
  ) {
    return imagePath;
  }

  return (
    `${req.protocol}://` +
    `${req.get("host")}` +
    imagePath
  );
}

// ======================================================
// GET SEMUA PRODUK
// GET /products
// ======================================================

router.get("/", async (req, res) => {
  try {
    const [products] = await db
      .promise()
      .execute(`
        SELECT
          id_product,
          nama_product,
          deskripsi,

          harga,
          harga AS price,

          stok,
          satuan,
          gambar,
          id_user,
          id_category,

          NULL AS category
        FROM products
        ORDER BY id_product DESC
      `);

    const result = products.map(
      (product) => ({
        ...product,
        gambar_url: buildImageUrl(
          req,
          product.gambar,
        ),
      }),
    );

    return res.status(200).json(result);
  } catch (error) {
    console.error(
      "Gagal mengambil semua produk:",
      error,
    );

    return res.status(500).json({
      success: false,
      message:
        "Gagal mengambil data produk.",
      error: error.message,
      code: error.code,
    });
  }
});

// ======================================================
// GET PRODUK BERDASARKAN PENJUAL
// GET /products/seller/:idUser
// ======================================================

router.get(
  "/seller/:idUser",
  async (req, res) => {
    const userId =
      parsePositiveInteger(
        req.params.idUser,
      );

    if (userId === null) {
      return res.status(400).json({
        success: false,
        message:
          "ID penjual tidak valid.",
      });
    }

    try {
      const [products] = await db
        .promise()
        .execute(
          `
            SELECT
              id_product,
              nama_product,
              deskripsi,

              harga,
              harga AS price,

              stok,
              satuan,
              gambar,
              id_user,
              id_category,

              NULL AS category
            FROM products
            WHERE id_user = ?
            ORDER BY id_product DESC
          `,
          [userId],
        );

      const result = products.map(
        (product) => ({
          ...product,
          gambar_url: buildImageUrl(
            req,
            product.gambar,
          ),
        }),
      );

      return res
        .status(200)
        .json(result);
    } catch (error) {
      console.error(
        "Gagal mengambil produk penjual:",
        error,
      );

      return res.status(500).json({
        success: false,
        message:
          "Gagal mengambil produk penjual.",
        error: error.message,
        code: error.code,
      });
    }
  },
);

// ======================================================
// GET SATU PRODUK
// GET /products/:id
// ======================================================

router.get("/:id", async (req, res) => {
  const productId =
    parsePositiveInteger(
      req.params.id,
    );

  if (productId === null) {
    return res.status(400).json({
      success: false,
      message:
        "ID produk tidak valid.",
    });
  }

  try {
    const [products] = await db
      .promise()
      .execute(
        `
          SELECT
            id_product,
            nama_product,
            deskripsi,

            harga,
            harga AS price,

            stok,
            satuan,
            gambar,
            id_user,
            id_category,

            NULL AS category
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

    const product = products[0];

    return res.status(200).json({
      success: true,
      product: {
        ...product,
        gambar_url: buildImageUrl(
          req,
          product.gambar,
        ),
      },
    });
  } catch (error) {
    console.error(
      "Gagal mengambil produk:",
      error,
    );

    return res.status(500).json({
      success: false,
      message:
        "Gagal mengambil produk.",
      error: error.message,
      code: error.code,
    });
  }
});

// ======================================================
// TAMBAH PRODUK BESERTA FOTO
// POST /products
// FIELD FOTO MULTIPART: gambar
// ======================================================

router.post(
  "/",
  productImageUpload,
  async (req, res) => {
    const productName =
      req.body.nama_product
        ?.toString()
        .trim();

    const description =
      normalizeOptionalText(
        req.body.deskripsi,
      );

    /*
     * Flutter masih boleh mengirim field
     * harga dan price.
     *
     * Namun database hanya menyimpan ke
     * kolom harga.
     */
    const price =
      parsePositiveNumber(
        req.body.harga ??
          req.body.price,
      );

    const stock =
      parseNonNegativeInteger(
        req.body.stok,
      );

    const unit =
      req.body.satuan
        ?.toString()
        .trim();

    const userId =
      parsePositiveInteger(
        req.body.id_user,
      );

    const categoryId =
      parsePositiveInteger(
        req.body.id_category,
      );

    if (!productName) {
      removeUploadedFile(req.file);

      return res.status(400).json({
        success: false,
        message:
          "Nama produk wajib diisi.",
      });
    }

    if (price === null) {
      removeUploadedFile(req.file);

      return res.status(400).json({
        success: false,
        message:
          "Harga produk tidak valid.",
      });
    }

    if (stock === null) {
      removeUploadedFile(req.file);

      return res.status(400).json({
        success: false,
        message:
          "Stok produk tidak valid.",
      });
    }

    if (!unit) {
      removeUploadedFile(req.file);

      return res.status(400).json({
        success: false,
        message:
          "Satuan produk wajib dipilih.",
      });
    }

    if (userId === null) {
      removeUploadedFile(req.file);

      return res.status(400).json({
        success: false,
        message:
          "ID penjual tidak valid.",
      });
    }

    if (categoryId === null) {
      removeUploadedFile(req.file);

      return res.status(400).json({
        success: false,
        message:
          "Kategori produk tidak valid.",
      });
    }

    if (!req.file) {
      return res.status(400).json({
        success: false,
        message:
          "Foto produk wajib dipilih.",
      });
    }

    const imagePath =
      `/uploads/products/${req.file.filename}`;

    try {
      /*
       * Kolom yang benar-benar tersedia:
       *
       * nama_product
       * deskripsi
       * harga
       * stok
       * satuan
       * gambar
       * id_user
       * id_category
       *
       * Tidak ada kolom price dan category.
       */
      const [result] = await db
        .promise()
        .execute(
          `
            INSERT INTO products (
              nama_product,
              deskripsi,
              harga,
              stok,
              satuan,
              gambar,
              id_user,
              id_category
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          `,
          [
            productName,
            description,
            price,
            stock,
            unit,
            imagePath,
            userId,
            categoryId,
          ],
        );

      return res.status(201).json({
        success: true,
        message:
          "Produk berhasil ditambahkan.",
        id_product: result.insertId,
        gambar: imagePath,
        gambar_url: buildImageUrl(
          req,
          imagePath,
        ),
        product: {
          id_product: result.insertId,
          nama_product: productName,
          deskripsi: description,
          harga: price,
          price,
          stok: stock,
          satuan: unit,
          gambar: imagePath,
          gambar_url: buildImageUrl(
            req,
            imagePath,
          ),
          id_user: userId,
          id_category: categoryId,
          category: null,
        },
      });
    } catch (error) {
      removeUploadedFile(req.file);

      console.error(
        "Gagal menambahkan produk:",
        error,
      );

      return res.status(500).json({
        success: false,
        message:
          "Gagal menambahkan produk.",
        error: error.message,
        code: error.code,
      });
    }
  },
);

// ======================================================
// UPDATE PRODUK
// PUT /products/:id
// FOTO BARU OPSIONAL
// ======================================================

router.put(
  "/:id",
  productImageUpload,
  async (req, res) => {
    const productId =
      parsePositiveInteger(
        req.params.id,
      );

    if (productId === null) {
      removeUploadedFile(req.file);

      return res.status(400).json({
        success: false,
        message:
          "ID produk tidak valid.",
      });
    }

    try {
      const [existingProducts] =
        await db
          .promise()
          .execute(
            `
              SELECT
                id_product,
                gambar
              FROM products
              WHERE id_product = ?
              LIMIT 1
            `,
            [productId],
          );

      if (
        existingProducts.length === 0
      ) {
        removeUploadedFile(req.file);

        return res.status(404).json({
          success: false,
          message:
            "Produk tidak ditemukan.",
        });
      }

      const oldImage =
        existingProducts[0].gambar;

      const productName =
        req.body.nama_product
          ?.toString()
          .trim();

      const description =
        normalizeOptionalText(
          req.body.deskripsi,
        );

      const price =
        parsePositiveNumber(
          req.body.harga ??
            req.body.price,
        );

      const stock =
        parseNonNegativeInteger(
          req.body.stok,
        );

      const unit =
        req.body.satuan
          ?.toString()
          .trim();

      const categoryId =
        parsePositiveInteger(
          req.body.id_category,
        );

      if (!productName) {
        removeUploadedFile(req.file);

        return res.status(400).json({
          success: false,
          message:
            "Nama produk wajib diisi.",
        });
      }

      if (price === null) {
        removeUploadedFile(req.file);

        return res.status(400).json({
          success: false,
          message:
            "Harga produk tidak valid.",
        });
      }

      if (stock === null) {
        removeUploadedFile(req.file);

        return res.status(400).json({
          success: false,
          message:
            "Stok produk tidak valid.",
        });
      }

      if (!unit) {
        removeUploadedFile(req.file);

        return res.status(400).json({
          success: false,
          message:
            "Satuan produk wajib dipilih.",
        });
      }

      if (categoryId === null) {
        removeUploadedFile(req.file);

        return res.status(400).json({
          success: false,
          message:
            "Kategori produk tidak valid.",
        });
      }

      const newImagePath = req.file
        ? `/uploads/products/${req.file.filename}`
        : oldImage;

      await db
        .promise()
        .execute(
          `
            UPDATE products
            SET
              nama_product = ?,
              deskripsi = ?,
              harga = ?,
              stok = ?,
              satuan = ?,
              gambar = ?,
              id_category = ?
            WHERE id_product = ?
          `,
          [
            productName,
            description,
            price,
            stock,
            unit,
            newImagePath,
            categoryId,
            productId,
          ],
        );

      if (
        req.file &&
        oldImage !== newImagePath
      ) {
        removeProductImage(oldImage);
      }

      return res.status(200).json({
        success: true,
        message:
          "Produk berhasil diperbarui.",
        gambar: newImagePath,
        gambar_url: buildImageUrl(
          req,
          newImagePath,
        ),
        product: {
          id_product: productId,
          nama_product: productName,
          deskripsi: description,
          harga: price,
          price,
          stok: stock,
          satuan: unit,
          gambar: newImagePath,
          gambar_url: buildImageUrl(
            req,
            newImagePath,
          ),
          id_category: categoryId,
          category: null,
        },
      });
    } catch (error) {
      removeUploadedFile(req.file);

      console.error(
        "Gagal memperbarui produk:",
        error,
      );

      return res.status(500).json({
        success: false,
        message:
          "Gagal memperbarui produk.",
        error: error.message,
        code: error.code,
      });
    }
  },
);

// ======================================================
// HAPUS PRODUK
// DELETE /products/:id
// ======================================================

router.delete(
  "/:id",
  async (req, res) => {
    const productId =
      parsePositiveInteger(
        req.params.id,
      );

    if (productId === null) {
      return res.status(400).json({
        success: false,
        message:
          "ID produk tidak valid.",
      });
    }

    try {
      const [products] = await db
        .promise()
        .execute(
          `
            SELECT
              id_product,
              gambar
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

      await db
        .promise()
        .execute(
          `
            DELETE FROM products
            WHERE id_product = ?
          `,
          [productId],
        );

      removeProductImage(
        products[0].gambar,
      );

      return res.status(200).json({
        success: true,
        message:
          "Produk berhasil dihapus.",
      });
    } catch (error) {
      console.error(
        "Gagal menghapus produk:",
        error,
      );

      return res.status(500).json({
        success: false,
        message:
          "Gagal menghapus produk.",
        error: error.message,
        code: error.code,
      });
    }
  },
);

export default router;
