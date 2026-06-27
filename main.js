import "dotenv/config";

import path from "path";
import cors from "cors";
import express from "express";

import productRouter from "./router/products.js";
import usersRouter from "./router/users.js";
import transactionRouter from "./router/transaction.js";
import transactionDetailRouter from "./router/transaction_details.js";
import paymentsRouter from "./router/payments.js";
import reviewsRouter from "./router/reviews.js";
import cartsRouter from "./router/carts.js";
import cartDetailsRouter from "./router/cart_details.js";
import categoriesRouter from "./router/categories.js";
import sellerBalanceRouter from "./router/seller_balance.js";
import walletRouter from "./router/wallets.js";
import wishlistRouter from "./router/wishlists.js";

const app = express();

const port = Number(
  process.env.APP_PORT || 3000,
);

// ======================================================
// MIDDLEWARE
// ======================================================

app.use(
  cors({
    origin: true,
    credentials: true,
  }),
);

app.use(
  express.json({
    limit: "10mb",
  }),
);

app.use(
  express.urlencoded({
    extended: true,
    limit: "10mb",
  }),
);

// ======================================================
// STATIC FILE UPLOAD
// ======================================================

app.use(
  "/uploads",
  express.static(
    path.join(
      process.cwd(),
      "uploads",
    ),
  ),
);

// ======================================================
// ROUTE UTAMA
// ======================================================

app.get("/", (req, res) => {
  return res.status(200).json({
    success: true,
    message: "Komotia API berjalan.",
  });
});

app.get("/health", (req, res) => {
  return res.status(200).json({
    success: true,
    message: "Server dalam kondisi aktif.",
    timestamp: new Date().toISOString(),
  });
});

// ======================================================
// ROUTER
// ======================================================

app.use(
  "/products",
  productRouter,
);

app.use(
  "/users",
  usersRouter,
);

app.use(
  "/transactions",
  transactionRouter,
);

app.use(
  "/transaction-details",
  transactionDetailRouter,
);

app.use(
  "/payments",
  paymentsRouter,
);

app.use(
  "/reviews",
  reviewsRouter,
);

app.use(
  "/carts",
  cartsRouter,
);

app.use(
  "/cart-details",
  cartDetailsRouter,
);

app.use(
  "/categories",
  categoriesRouter,
);

app.use(
  "/seller-balance",
  sellerBalanceRouter,
);

app.use(
  "/wallets",
  walletRouter,
);

app.use(
  "/wishlists",
  wishlistRouter,
);

// ======================================================
// ENDPOINT TIDAK DITEMUKAN
// ======================================================

app.use((req, res) => {
  return res.status(404).json({
    success: false,
    message: "Endpoint tidak ditemukan.",
    method: req.method,
    path: req.originalUrl,
  });
});

// ======================================================
// GLOBAL ERROR HANDLER
// ======================================================

app.use(
  (
    error,
    req,
    res,
    next,
  ) => {
    console.error(
      "SERVER ERROR:",
      error,
    );

    if (res.headersSent) {
      return next(error);
    }

    return res.status(
      error.status || 500,
    ).json({
      success: false,
      message:
        error.message ||
        "Terjadi kesalahan pada server.",
      error:
        process.env.NODE_ENV ===
        "development"
          ? error.stack
          : undefined,
    });
  },
);

// ======================================================
// JALANKAN SERVER
// ======================================================

app.listen(port, () => {
  console.log(
    `Komotia API berjalan di http://localhost:${port}`,
  );

  console.log(
    `Folder upload tersedia di http://localhost:${port}/uploads`,
  );

  console.log(
    `Wallet API tersedia di http://localhost:${port}/wallets`,
  );

  console.log(
    `Wishlist API tersedia di http://localhost:${port}/wishlists`,
  );

  console.log(
    `Seller Balance API tersedia di http://localhost:${port}/seller-balance`,
  );
});

