import { Router } from "express";
import fs from "fs";
import path from "path";

import db from "../config/db.js";
import uploadProfile from "../middleware/uploadProfile.js";
import uploadStoreLogo from "../middleware/uploadStoreLogo.js";

const router = Router();

const TRANSIENT_DATABASE_ERRORS = [
  "ECONNRESET",
  "ETIMEDOUT",
  "EPIPE",
  "PROTOCOL_CONNECTION_LOST",
];

// ======================================================
// HELPER DATABASE RETRY
// ======================================================

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
      const [result] = await db
        .promise()
        .execute(sql, values);

      return result;
    } catch (error) {
      lastError = error;

      const canRetry =
        TRANSIENT_DATABASE_ERRORS.includes(
          error.code,
        );

      if (!canRetry || attempt >= maxRetries) {
        throw error;
      }

      const delay = 500 * (attempt + 1);

      console.warn(
        `Koneksi database terputus. Percobaan ulang ${
          attempt + 1
        }/${maxRetries} dalam ${delay} ms...`,
      );

      await new Promise((resolve) => {
        setTimeout(resolve, delay);
      });
    }
  }

  throw lastError;
}

function parsePositiveId(value) {
  const parsed = Number(value);

  return Number.isInteger(parsed) &&
    parsed > 0
    ? parsed
    : null;
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

function normalizeStoreStatus(value) {
  return value === true ||
    value === 1 ||
    value === "1" ||
    String(value).toLowerCase() === "true"
    ? 1
    : 0;
}

function deleteStoredFile(
  storedPath,
  allowedPrefix,
) {
  if (
    !storedPath ||
    !storedPath.startsWith(allowedPrefix)
  ) {
    return;
  }

  const filePath = path.join(
    process.cwd(),
    storedPath.replace(/^\/+/, ""),
  );

  fs.unlink(filePath, (error) => {
    if (
      error &&
      error.code !== "ENOENT"
    ) {
      console.error(
        `Gagal menghapus file ${storedPath}:`,
        error,
      );
    }
  });
}

function sendDatabaseError(
  res,
  message,
  error,
) {
  console.error(
    message,
    error.code,
    error.message,
  );

  const isConnectionError =
    TRANSIENT_DATABASE_ERRORS.includes(
      error.code,
    );

  return res.status(500).json({
    success: false,
    message: isConnectionError
      ? "Koneksi database sedang terganggu. Silakan coba kembali."
      : message,
    error: error.message,
    code: error.code,
  });
}

// ======================================================
// LOGIN
// POST /users/login
// ======================================================

router.post("/login", async (req, res) => {
  const email =
    req.body.email?.toString().trim();

  const password =
    req.body.password?.toString();

  if (!email || !password) {
    return res.status(400).json({
      success: false,
      message:
        "Email dan password harus diisi.",
    });
  }

  try {
    const results =
      await executeWithRetry(
        `
          SELECT
            id_user,
            nama,
            email,
            no_telp,
            alamat,
            role,
            foto_profil,
            logo_toko,
            nama_toko,
            deskripsi_toko,
            status_toko
          FROM users
          WHERE email = ?
            AND password = ?
          LIMIT 1
        `,
        [email, password],
      );

    if (results.length === 0) {
      return res.status(401).json({
        success: false,
        message:
          "Email atau password salah.",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Login berhasil.",
      user: results[0],
    });
  } catch (error) {
    return sendDatabaseError(
      res,
      "Gagal melakukan login.",
      error,
    );
  }
});

// ======================================================
// UPGRADE PEMBELI MENJADI PENJUAL
// PATCH /users/:id/upgrade-seller
// ======================================================

router.patch(
  "/:id/upgrade-seller",
  async (req, res) => {
    const userId = parsePositiveId(
      req.params.id,
    );

    if (userId === null) {
      return res.status(400).json({
        success: false,
        message:
          "ID pengguna tidak valid.",
      });
    }

    try {
      const users =
        await executeWithRetry(
          `
            SELECT
              id_user,
              nama,
              role
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

      const user = users[0];

      if (user.role === "penjual") {
        return res.status(200).json({
          success: true,
          message:
            "Pengguna sudah memiliki toko.",
          user,
        });
      }

      await executeWithRetry(
        `
          UPDATE users
          SET
            role = 'penjual',
            status_toko =
              COALESCE(status_toko, 1)
          WHERE id_user = ?
        `,
        [userId],
      );

      return res.status(200).json({
        success: true,
        message:
          "Selamat! Toko berhasil dibuat.",
        user: {
          id_user: userId,
          nama: user.nama,
          role: "penjual",
        },
      });
    } catch (error) {
      return sendDatabaseError(
        res,
        "Gagal membuat toko.",
        error,
      );
    }
  },
);

// ======================================================
// UPLOAD FOTO PROFIL
// POST /users/:id/foto-profil
// Field multipart: foto
// ======================================================

router.post(
  "/:id/foto-profil",
  (req, res) => {
    const userId = parsePositiveId(
      req.params.id,
    );

    if (userId === null) {
      return res.status(400).json({
        success: false,
        message:
          "ID pengguna tidak valid.",
      });
    }

    uploadProfile.single("foto")(
      req,
      res,
      async (uploadError) => {
        if (uploadError) {
          return res.status(400).json({
            success: false,
            message:
              uploadError.message,
          });
        }

        if (!req.file) {
          return res.status(400).json({
            success: false,
            message:
              "Foto profil belum dipilih.",
          });
        }

        try {
          const users =
            await executeWithRetry(
              `
                SELECT foto_profil
                FROM users
                WHERE id_user = ?
                LIMIT 1
              `,
              [userId],
            );

          if (users.length === 0) {
            fs.unlink(
              req.file.path,
              () => {},
            );

            return res.status(404).json({
              success: false,
              message:
                "Pengguna tidak ditemukan.",
            });
          }

          const oldPhoto =
            users[0].foto_profil;

          const photoPath =
            `/uploads/profiles/` +
            req.file.filename;

          await executeWithRetry(
            `
              UPDATE users
              SET foto_profil = ?
              WHERE id_user = ?
            `,
            [
              photoPath,
              userId,
            ],
          );

          deleteStoredFile(
            oldPhoto,
            "/uploads/profiles/",
          );

          return res.status(200).json({
            success: true,
            message:
              "Foto profil berhasil diperbarui.",
            foto_profil: photoPath,
            foto_url:
              `${req.protocol}://` +
              `${req.get("host")}` +
              photoPath,
          });
        } catch (error) {
          fs.unlink(
            req.file.path,
            () => {},
          );

          return sendDatabaseError(
            res,
            "Gagal menyimpan foto profil.",
            error,
          );
        }
      },
    );
  },
);

// ======================================================
// HAPUS FOTO PROFIL
// DELETE /users/:id/foto-profil
// ======================================================

router.delete(
  "/:id/foto-profil",
  async (req, res) => {
    const userId = parsePositiveId(
      req.params.id,
    );

    if (userId === null) {
      return res.status(400).json({
        success: false,
        message:
          "ID pengguna tidak valid.",
      });
    }

    try {
      const users =
        await executeWithRetry(
          `
            SELECT foto_profil
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

      const oldPhoto =
        users[0].foto_profil;

      await executeWithRetry(
        `
          UPDATE users
          SET foto_profil = NULL
          WHERE id_user = ?
        `,
        [userId],
      );

      deleteStoredFile(
        oldPhoto,
        "/uploads/profiles/",
      );

      return res.status(200).json({
        success: true,
        message:
          "Foto profil berhasil dihapus.",
      });
    } catch (error) {
      return sendDatabaseError(
        res,
        "Gagal menghapus foto profil.",
        error,
      );
    }
  },
);

// ======================================================
// UPLOAD LOGO TOKO
// POST /users/:id/logo-toko
// Field multipart: logo
// ======================================================

router.post(
  "/:id/logo-toko",
  (req, res) => {
    const userId = parsePositiveId(
      req.params.id,
    );

    if (userId === null) {
      return res.status(400).json({
        success: false,
        message:
          "ID pengguna tidak valid.",
      });
    }

    uploadStoreLogo.single("logo")(
      req,
      res,
      async (uploadError) => {
        if (uploadError) {
          return res.status(400).json({
            success: false,
            message:
              uploadError.message,
          });
        }

        if (!req.file) {
          return res.status(400).json({
            success: false,
            message:
              "File logo toko belum dipilih.",
          });
        }

        try {
          const users =
            await executeWithRetry(
              `
                SELECT
                  role,
                  logo_toko
                FROM users
                WHERE id_user = ?
                LIMIT 1
              `,
              [userId],
            );

          if (users.length === 0) {
            fs.unlink(
              req.file.path,
              () => {},
            );

            return res.status(404).json({
              success: false,
              message:
                "Pengguna tidak ditemukan.",
            });
          }

          if (
            users[0].role !==
            "penjual"
          ) {
            fs.unlink(
              req.file.path,
              () => {},
            );

            return res.status(403).json({
              success: false,
              message:
                "Pengguna belum terdaftar sebagai penjual.",
            });
          }

          const oldLogo =
            users[0].logo_toko;

          const logoPath =
            `/uploads/stores/` +
            req.file.filename;

          await executeWithRetry(
            `
              UPDATE users
              SET logo_toko = ?
              WHERE id_user = ?
            `,
            [
              logoPath,
              userId,
            ],
          );

          deleteStoredFile(
            oldLogo,
            "/uploads/stores/",
          );

          return res.status(200).json({
            success: true,
            message:
              "Logo toko berhasil diperbarui.",
            logo_toko: logoPath,
            logo_url:
              `${req.protocol}://` +
              `${req.get("host")}` +
              logoPath,
          });
        } catch (error) {
          fs.unlink(
            req.file.path,
            () => {},
          );

          return sendDatabaseError(
            res,
            "Gagal menyimpan logo toko.",
            error,
          );
        }
      },
    );
  },
);

// ======================================================
// HAPUS LOGO TOKO
// DELETE /users/:id/logo-toko
// ======================================================

router.delete(
  "/:id/logo-toko",
  async (req, res) => {
    const userId = parsePositiveId(
      req.params.id,
    );

    if (userId === null) {
      return res.status(400).json({
        success: false,
        message:
          "ID pengguna tidak valid.",
      });
    }

    try {
      const users =
        await executeWithRetry(
          `
            SELECT logo_toko
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

      const oldLogo =
        users[0].logo_toko;

      await executeWithRetry(
        `
          UPDATE users
          SET logo_toko = NULL
          WHERE id_user = ?
        `,
        [userId],
      );

      deleteStoredFile(
        oldLogo,
        "/uploads/stores/",
      );

      return res.status(200).json({
        success: true,
        message:
          "Logo toko berhasil dihapus.",
      });
    } catch (error) {
      return sendDatabaseError(
        res,
        "Gagal menghapus logo toko.",
        error,
      );
    }
  },
);

// ======================================================
// SIMPAN PENGATURAN TOKO
// PUT /users/:id/store-settings
// ======================================================

router.put(
  "/:id/store-settings",
  async (req, res) => {
    const userId = parsePositiveId(
      req.params.id,
    );

    if (userId === null) {
      return res.status(400).json({
        success: false,
        message:
          "ID pengguna tidak valid.",
      });
    }

    const storeName =
      req.body.nama_toko
        ?.toString()
        .trim();

    if (!storeName) {
      return res.status(400).json({
        success: false,
        message:
          "Nama toko wajib diisi.",
      });
    }

    const phone =
      normalizeOptionalText(
        req.body.no_telp,
      );

    const address =
      normalizeOptionalText(
        req.body.alamat,
      );

    const description =
      normalizeOptionalText(
        req.body.deskripsi_toko,
      );

    const storeStatus =
      normalizeStoreStatus(
        req.body.status_toko,
      );

    try {
      const users =
        await executeWithRetry(
          `
            SELECT
              id_user,
              role
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

      if (
        users[0].role !==
        "penjual"
      ) {
        return res.status(403).json({
          success: false,
          message:
            "Pengguna belum terdaftar sebagai penjual.",
        });
      }

      await executeWithRetry(
        `
          UPDATE users
          SET
            nama_toko = ?,
            no_telp = ?,
            alamat = ?,
            deskripsi_toko = ?,
            status_toko = ?
          WHERE id_user = ?
        `,
        [
          storeName,
          phone,
          address,
          description,
          storeStatus,
          userId,
        ],
      );

      const updatedUsers =
        await executeWithRetry(
          `
            SELECT
              id_user,
              nama_toko,
              no_telp,
              alamat,
              deskripsi_toko,
              status_toko,
              logo_toko
            FROM users
            WHERE id_user = ?
            LIMIT 1
          `,
          [userId],
        );

      return res.status(200).json({
        success: true,
        message:
          "Pengaturan toko berhasil disimpan.",
        store: updatedUsers[0],
      });
    } catch (error) {
      return sendDatabaseError(
        res,
        "Gagal menyimpan pengaturan toko.",
        error,
      );
    }
  },
);

// ======================================================
// GET SEMUA USER
// GET /users
// ======================================================

router.get("/", async (req, res) => {
  try {
    const users =
      await executeWithRetry(
        `
          SELECT
            id_user,
            nama,
            email,
            no_telp,
            alamat,
            role,
            foto_profil,
            logo_toko,
            nama_toko,
            deskripsi_toko,
            status_toko
          FROM users
          ORDER BY id_user DESC
        `,
      );

    return res.status(200).json(
      users,
    );
  } catch (error) {
    return sendDatabaseError(
      res,
      "Gagal mengambil data pengguna.",
      error,
    );
  }
});

// ======================================================
// REGISTER USER
// POST /users
// ======================================================

router.post("/", async (req, res) => {
  const name =
    req.body.nama?.toString().trim();

  const email =
    req.body.email?.toString().trim();

  const password =
    req.body.password?.toString();

  const phone =
    normalizeOptionalText(
      req.body.no_telp,
    );

  const address =
    normalizeOptionalText(
      req.body.alamat,
    );

  const role =
    req.body.role === "penjual"
      ? "penjual"
      : "pembeli";

  if (
    !name ||
    !email ||
    !password
  ) {
    return res.status(400).json({
      success: false,
      message:
        "Nama, email, dan password harus diisi.",
    });
  }

  try {
    const result =
      await executeWithRetry(
        `
          INSERT INTO users (
            nama,
            email,
            password,
            no_telp,
            alamat,
            role
          )
          VALUES (?, ?, ?, ?, ?, ?)
        `,
        [
          name,
          email,
          password,
          phone,
          address,
          role,
        ],
      );

    return res.status(201).json({
      success: true,
      message:
        "Pengguna berhasil didaftarkan.",
      id_user: result.insertId,
    });
  } catch (error) {
    if (
      error.code ===
      "ER_DUP_ENTRY"
    ) {
      return res.status(409).json({
        success: false,
        message:
          "Email sudah digunakan.",
      });
    }

    return sendDatabaseError(
      res,
      "Gagal mendaftarkan pengguna.",
      error,
    );
  }
});

// ======================================================
// GET USER BERDASARKAN ID
// GET /users/:id
// ======================================================

router.get("/:id", async (req, res) => {
  const userId = Number(req.params.id);

  if (!Number.isInteger(userId) || userId <= 0) {
    return res.status(400).json({
      success: false,
      message: "ID pengguna tidak valid.",
    });
  }

  try {
    const users = await executeWithRetry(
      `
        SELECT
          id_user,
          nama,
          email,
          no_telp,
          alamat,
          role,
          foto_profil,
          logo_toko,
          nama_toko,
          deskripsi_toko,
          status_toko
        FROM users
        WHERE id_user = ?
        LIMIT 1
      `,
      [userId],
    );

    if (users.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Pengguna tidak ditemukan.",
      });
    }

    return res.status(200).json({
      success: true,
      user: users[0],
    });
  } catch (error) {
    console.error(
      "GET USER ERROR:",
      error.code,
      error.message,
    );

    return res.status(500).json({
      success: false,
      message: "Gagal mengambil data pengguna.",
      error: error.message,
      code: error.code,
    });
  }
});

// ======================================================
// UPDATE USER
// PUT /users/:id
// ======================================================

router.put("/:id", async (req, res) => {
  const userId = parsePositiveId(
    req.params.id,
  );

  if (userId === null) {
    return res.status(400).json({
      success: false,
      message:
        "ID pengguna tidak valid.",
    });
  }

  const allowedFields = {
    nama: req.body.nama,
    email: req.body.email,
    password: req.body.password,
    no_telp: req.body.no_telp,
    alamat: req.body.alamat,
    role: req.body.role,
  };

  const updates = [];
  const values = [];

  for (
    const [field, rawValue]
    of Object.entries(allowedFields)
  ) {
    if (rawValue === undefined) {
      continue;
    }

    if (field === "role") {
      const role =
        rawValue === "penjual"
          ? "penjual"
          : "pembeli";

      updates.push("role = ?");
      values.push(role);
      continue;
    }

    if (
      field === "nama" ||
      field === "email" ||
      field === "password"
    ) {
      const value =
        rawValue
          ?.toString()
          .trim();

      if (!value) {
        return res.status(400).json({
          success: false,
          message:
            `${field} tidak boleh kosong.`,
        });
      }

      updates.push(
        `${field} = ?`,
      );

      values.push(value);
      continue;
    }

    updates.push(
      `${field} = ?`,
    );

    values.push(
      normalizeOptionalText(
        rawValue,
      ),
    );
  }

  if (updates.length === 0) {
    return res.status(400).json({
      success: false,
      message:
        "Tidak ada data pengguna yang diperbarui.",
    });
  }

  values.push(userId);

  try {
    const result =
      await executeWithRetry(
        `
          UPDATE users
          SET ${updates.join(", ")}
          WHERE id_user = ?
        `,
        values,
      );

    if (
      result.affectedRows === 0
    ) {
      return res.status(404).json({
        success: false,
        message:
          "Pengguna tidak ditemukan.",
      });
    }

    return res.status(200).json({
      success: true,
      message:
        "Pengguna berhasil diperbarui.",
    });
  } catch (error) {
    if (
      error.code ===
      "ER_DUP_ENTRY"
    ) {
      return res.status(409).json({
        success: false,
        message:
          "Email sudah digunakan.",
      });
    }

    return sendDatabaseError(
      res,
      "Gagal memperbarui pengguna.",
      error,
    );
  }
});

// ======================================================
// HAPUS USER
// DELETE /users/:id
// ======================================================

router.delete(
  "/:id",
  async (req, res) => {
    const userId = parsePositiveId(
      req.params.id,
    );

    if (userId === null) {
      return res.status(400).json({
        success: false,
        message:
          "ID pengguna tidak valid.",
      });
    }

    try {
      const users =
        await executeWithRetry(
          `
            SELECT
              foto_profil,
              logo_toko
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

      await executeWithRetry(
        `
          DELETE FROM users
          WHERE id_user = ?
        `,
        [userId],
      );

      deleteStoredFile(
        users[0].foto_profil,
        "/uploads/profiles/",
      );

      deleteStoredFile(
        users[0].logo_toko,
        "/uploads/stores/",
      );

      return res.status(200).json({
        success: true,
        message:
          `Pengguna dengan ID ${userId} berhasil dihapus.`,
      });
    } catch (error) {
      return sendDatabaseError(
        res,
        "Gagal menghapus pengguna.",
        error,
      );
    }
  },
);

export default router;