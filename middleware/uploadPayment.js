import fs from "fs";
import path from "path";
import multer from "multer";

const uploadDirectory = path.join(
  process.cwd(),
  "uploads",
  "payments"
);

// Membuat folder uploads/payments secara otomatis.
fs.mkdirSync(uploadDirectory, {
  recursive: true,
});

const storage = multer.diskStorage({
  destination: function (req, file, callback) {
    callback(null, uploadDirectory);
  },

  filename: function (req, file, callback) {
    const originalExtension = path
      .extname(file.originalname)
      .toLowerCase();

    const allowedExtensions = [
      ".jpg",
      ".jpeg",
      ".png",
      ".webp",
    ];

    const extension = allowedExtensions.includes(
      originalExtension,
    )
      ? originalExtension
      : ".jpg";

    const uniqueName =
      "payment-" +
      Date.now() +
      "-" +
      Math.round(Math.random() * 1000000000) +
      extension;

    callback(null, uniqueName);
  },
});

const allowedMimeTypes = [
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
];

const fileFilter = function (
  req,
  file,
  callback,
) {
  if (!allowedMimeTypes.includes(file.mimetype)) {
    return callback(
      new Error(
        "Bukti pembayaran harus berupa JPG, JPEG, PNG, atau WEBP.",
      ),
      false,
    );
  }

  callback(null, true);
};

const uploadPayment = multer({
  storage: storage,
  fileFilter: fileFilter,
  limits: {
    fileSize: 5 * 1024 * 1024,
  },
});

// Baris ini wajib ada karena payments.js menggunakan default import.
export default uploadPayment;
