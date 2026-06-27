import fs from "fs";
import path from "path";
import multer from "multer";

const uploadDirectory = path.join(
  process.cwd(),
  "uploads",
  "products",
);

fs.mkdirSync(uploadDirectory, {
  recursive: true,
});

const allowedExtensions = [
  ".jpg",
  ".jpeg",
  ".png",
  ".webp",
];

const allowedMimeTypes = [
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
];

const storage = multer.diskStorage({
  destination: function (
    req,
    file,
    callback,
  ) {
    callback(null, uploadDirectory);
  },

  filename: function (
    req,
    file,
    callback,
  ) {
    const originalExtension = path
      .extname(file.originalname)
      .toLowerCase();

    const extension =
      allowedExtensions.includes(
        originalExtension,
      )
        ? originalExtension
        : ".jpg";

    const fileName =
      "product-" +
      Date.now() +
      "-" +
      Math.round(
        Math.random() * 1000000000,
      ) +
      extension;

    callback(null, fileName);
  },
});

const fileFilter = function (
  req,
  file,
  callback,
) {
  if (
    !allowedMimeTypes.includes(
      file.mimetype,
    )
  ) {
    return callback(
      new Error(
        "Foto produk harus berupa JPG, JPEG, PNG, atau WEBP.",
      ),
      false,
    );
  }

  callback(null, true);
};

const uploadProductImage = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 5 * 1024 * 1024,
  },
});

export default uploadProductImage;