import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import productRouter from './router/products.js';
import usersRouter from './router/users.js'; 
import transactionRouter from './router/transaction.js'; 
import transactionDetailRouter from './router/transaction_details.js'
import paymentsRouter from './router/payments.js';
import reviewsRouter from './router/reviews.js';
import cartsRouter from './router/carts.js';
import cartDetailsRouter from './router/cart_details.js';
import categoriesRouter from './router/categories.js';

const app = express();
const port = process.env.APP_PORT || 3000;

app.use(cors());
app.use(express.json());
app.use('/products', productRouter);
app.use('/users', usersRouter);
app.use('/transaction', transactionRouter);
app.use('/transaction-details', transactionDetailRouter);
app.use('/payments', paymentsRouter);
app.use('/reviews', reviewsRouter);
app.use('/carts', cartsRouter);
app.use('/cart-details', cartDetailsRouter);
app.use('/categories', categoriesRouter);

app.listen(port, () => {
    console.log(`app running port ${port}`);
});