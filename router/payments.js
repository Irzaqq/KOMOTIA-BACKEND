import fs from "fs";
import path from "path";
import { Router } from "express";

import db from "../config/db.js";
import uploadPayment from "../middleware/uploadPayment.js";

const router = Router();
// 1. GET ALL
router.get("/", (req, res) => {
  db.query("SELECT * FROM payments", (err, results) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(results);
  });
});

// 2. GET BY ID
router.get("/:id", (req, res) => {
  const { id } = req.params;
  db.query("SELECT * FROM payments WHERE id_payment=?", [id], (err, results) => {
    if (err) return res.status(500).json({ error: err.message });
    if (results.length === 0) return res.status(404).json({ message: "Payment tidak ditemukan" });
    res.json(results[0]);
  });
});

// 3. GET BY TRANSACTION
router.get("/transaction/:id_transaction", (req, res) => {
  const { id_transaction } = req.params;
  db.query("SELECT * FROM payments WHERE id_transaction=?", [id_transaction], (err, results) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(results);
  });
});

// 4. POST
router.post(
  "/",
  uploadPayment.single("bukti"),
  (req, res) => {
    const {
      id_transaction,
      jumlah_bayar,
      status_verifikasi,
    } = req.body;

    console.log("BODY PAYMENT:", req.body);
    console.log("FILE PAYMENT:", req.file);

    const parsedIdTransaction =
      Number(id_transaction);

    const parsedJumlahBayar =
      Number(jumlah_bayar);

    if (
      !Number.isInteger(parsedIdTransaction) ||
      parsedIdTransaction <= 0
    ) {
      if (req.file) {
        fs.unlink(req.file.path, () => {});
      }

      return res.status(400).json({
        success: false,
        message: "ID transaksi tidak valid.",
      });
    }

    if (
      !Number.isFinite(parsedJumlahBayar) ||
      parsedJumlahBayar <= 0
    ) {
      if (req.file) {
        fs.unlink(req.file.path, () => {});
      }

      return res.status(400).json({
        success: false,
        message: "Jumlah pembayaran tidak valid.",
      });
    }

    if (!req.file) {
      return res.status(400).json({
        success: false,
        message:
            "Bukti pembayaran wajib diunggah.",
      });
    }

    const buktiTransfer =
        `/uploads/payments/${req.file.filename}`;

    const sql = `
      INSERT INTO payments (
        id_transaction,
        tanggal_bayar,
        jumlah_bayar,
        bukti_transfer,
        status_verifikasi
      )
      VALUES (?, NOW(), ?, ?, ?)
    `;

    db.query(
      sql,
      [
        parsedIdTransaction,
        parsedJumlahBayar,
        buktiTransfer,
        status_verifikasi || "menunggu",
      ],
      (error, result) => {
        if (error) {
          console.error(
            "ERROR INSERT PAYMENT:",
            error,
          );

          if (req.file) {
            fs.unlink(req.file.path, () => {});
          }

          return res.status(500).json({
            success: false,
            message:
                "Gagal menyimpan pembayaran.",
            error: error.message,
          });
        }

        return res.status(201).json({
          success: true,
          message:
              "Bukti pembayaran berhasil dikirim.",
          id_payment: result.insertId,
          tanggal_bayar:
              new Date().toISOString(),
          bukti_transfer: buktiTransfer,
          status_verifikasi:
              status_verifikasi || "menunggu",
        });
      },
    );
  },
);

// 5. PUT
router.put("/:id", (req, res) => {
  const { id } = req.params;
  const { id_transaction, tanggal_bayar, jumlah_bayar, bukti_transfer, status_verifikasi } = req.body;

  const sql = `UPDATE payments SET 
    id_transaction=?, tanggal_bayar=?, jumlah_bayar=?, bukti_transfer=?, status_verifikasi=? 
    WHERE id_payment=?`;

  db.query(sql, [id_transaction, tanggal_bayar, jumlah_bayar, bukti_transfer, status_verifikasi, id], (err, result) => {
    if (err) return res.status(500).json({ error: err.message });
    if (result.affectedRows > 0) {
      res.json({ message: "Payment berhasil diperbarui!" });
    } else {
      res.status(404).json({ message: "Payment tidak ditemukan" });
    }
  });
});

// 6. PATCH (update status verifikasi only)
router.patch("/:id/status", (req, res) => {
  const { id } = req.params;
  const { status_verifikasi } = req.body;

  const validStatus = ["menunggu", "diterima", "ditolak"];
  if (!validStatus.includes(status_verifikasi)) {
    return res.status(400).json({ message: `Status tidak valid. Pilihan: ${validStatus.join(", ")}` });
  }

  db.query(
    "UPDATE payments SET status_verifikasi=? WHERE id_payment=?",
    [status_verifikasi, id],
    (err, result) => {
      if (err) return res.status(500).json({ error: err.message });
      if (result.affectedRows > 0) {
        res.json({ message: `Status verifikasi berhasil diubah menjadi '${status_verifikasi}'` });
      } else {
        res.status(404).json({ message: "Payment tidak ditemukan" });
      }
    }
  );
});

// 7. DELETE
router.delete("/:id", (req, res) => {
  const { id } = req.params;
  db.query("DELETE FROM payments WHERE id_payment=?", [id], (err, result) => {
    if (err) return res.status(500).json({ error: err.message });
    if (result.affectedRows > 0) {
      res.json({ message: `Payment dengan id ${id} berhasil dihapus` });
    } else {
      res.status(404).json({ message: "Payment tidak ditemukan" });
    }
  });
});

export default router;