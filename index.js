const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());

// Connect to SQLite database
const dbPath = path.join(__dirname, "qwipo.db");
const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error(err.message);
        process.exit(1);
    }
    console.log('Connected to the qwipo.db database.');

    // Create tables if they don't exist
    db.serialize(() => {
        db.run(`
            CREATE TABLE IF NOT EXISTS customers (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            first_name TEXT NOT NULL,
            last_name TEXT NOT NULL,
            phone_number TEXT NOT NULL UNIQUE
            );
        `);

        db.run(`
            CREATE TABLE IF NOT EXISTS addresses (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            customer_id INTEGER,
            address_details TEXT NOT NULL,
            city TEXT NOT NULL,
            state TEXT NOT NULL,
            pin_code TEXT NOT NULL,
            FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE
            );
        `);
    });
});

function validateCustomerPayload(body) {
    const { first_name, last_name, phone_number } = body;
    if (!first_name || !first_name.trim()) return 'first_name is required';
    if (!last_name || !last_name.trim()) return 'last_name is required';
    if (!phone_number || !phone_number.trim()) return 'phone_number is required';

    const phoneClean = phone_number.replace(/[+\-\s()]/g, '');
    if (!/^\d{6,15}$/.test(phoneClean)) return 'phone_number looks invalid';
    return null;
}

function validateAddressPayload(body) {
    const { address_details, city, state, pin_code } = body;
    if (!address_details || !address_details.trim()) return 'address_details is required';
    if (!city || !city.trim()) return 'city is required';
    if (!state || !state.trim()) return 'state is required';
    if (!pin_code || !pin_code.trim()) return 'pin_code is required';
    if (!/^\d{3,10}$/.test(pin_code.trim())) return 'pin_code looks invalid';
    return null;
}

// Customer Routes

// POST /api/customers - create customer
app.post('/api/customers', (request, response) => {
    try {
        const errMsg = validateCustomerPayload(request.body);
        if (errMsg) return response.status(400).json({ error: errMsg });

        const { first_name, last_name, phone_number } = request.body;

        const sql = `INSERT INTO customers (first_name, last_name, phone_number) VALUES (?, ?, ?)`;
        db.run(sql, [first_name.trim(), last_name.trim(), phone_number.trim()], function (err) {
            if (err) {
                if (err.code === 'SQLITE_CONSTRAINT') {
                    return response.status(400).json({ error: 'phone_number must be unique' });
                }
                console.log(err);
                return response.status(500).json({ error: "Internal server error" });
            }

            const createdId = this.lastID;
            db.get('SELECT * FROM customers WHERE id = ?', [createdId], (err2, row) => {
                if (err2) {
                    console.log(err2);
                    return response.status(500).json({ error: "Internal server error" });
                }
                return response.status(201).json({ message: 'Customer created', data: row });
            });
        });
    } catch (error) {
        console.log(error);
        return response.status(500).json({ error: "Internal server error" });
    }
});

// GET all customers with search, sort, and pagination
app.get('/api/customers', (request, response) => {
    try {
        let { page = 1, limit = 10, search = "", sortBy = "id", order = "ASC" } = request.query;

        page = parseInt(page);
        limit = parseInt(limit);
        const offset = (page - 1) * limit;

        let sql = `SELECT * FROM customers`;
        let countSql = `SELECT COUNT(*) as count FROM customers`;
        let params = [];
        let countParams = [];

        if (search) {
            sql += ` WHERE first_name LIKE ? OR last_name LIKE ? OR phone_number LIKE ?`;
            countSql += ` WHERE first_name LIKE ? OR last_name LIKE ? OR phone_number LIKE ?`;
            params.push(`%${search}%`, `%${search}%`, `%${search}%`);
            countParams.push(`%${search}%`, `%${search}%`, `%${search}%`);
        }

        const allowedSort = ["id", "first_name", "last_name", "phone_number"];
        const allowedOrder = ["ASC", "DESC"];

        if (!allowedSort.includes(sortBy)) sortBy = "id";
        if (!allowedOrder.includes(order.toUpperCase())) order = "ASC";

        sql += ` ORDER BY ${sortBy} ${order} LIMIT ? OFFSET ?`;
        params.push(limit, offset);

        db.all(sql, params, (err, rows) => {
            if (err) return response.status(400).json({ error: err.message });

            db.get(countSql, countParams, (err, countResult) => {
                if (err) return response.status(400).json({ error: err.message });

                return response.json({
                    message: "success",
                    data: rows,
                    pagination: {
                        total: countResult.count,
                        page,
                        limit,
                        totalPages: Math.ceil(countResult.count / limit)
                    }
                });
            });
        });
    } catch (error) {
        console.log(error);
        return response.status(500).json({ error: "Internal server error" });
    }
});

// GET a single customer by ID (with addresses)
app.get('/api/customers/:id', (request, response) => {
    try {
        const customerId = request.params.id;

        const sqlCustomer = `SELECT * FROM customers WHERE id = ?`;

        db.get(sqlCustomer, [customerId], (err, customer) => {
            if (err) return response.status(400).json({ error: err.message });
            if (!customer) return response.status(404).json({ message: "Customer not found" });

            const sqlAddresses = `SELECT * FROM addresses WHERE customer_id = ?`;

            db.all(sqlAddresses, [customerId], (err, addresses) => {
                if (err) return response.status(400).json({ error: err.message });

                return response.json({
                    message: "success",
                    data: {
                        ...customer,
                        addresses: addresses || []
                    }
                });
            });
        });
    } catch (error) {
        console.log(error);
        return response.status(500).json({ error: "Internal server error" });
    }
});

// UPDATE a customer's information
app.put('/api/customers/:id', (request, response) => {
    try {
        const customerId = request.params.id;

        const errMsg = validateCustomerPayload(request.body);
        if (errMsg) return response.status(400).json({ error: errMsg })

        const { first_name, last_name, phone_number } = request.body;

        const sql = `
            UPDATE customers 
            SET first_name = ?, last_name = ?, phone_number = ?
            WHERE id = ?
        `;

        const params = [first_name, last_name, phone_number, customerId];

        db.run(sql, params, function (err) {
            if (err) {
                if (err.code === "SQLITE_CONSTRAINT") {
                    return response.status(400).json({ error: "Phone number must be unique" });
                }
                return response.status(400).json({ error: err.message });
            }

            if (this.changes === 0) return response.status(404).json({ message: "Customer not found" });

            return response.json({
                message: "success",
                data: {
                    id: parseInt(customerId),
                    first_name,
                    last_name,
                    phone_number
                }
            });
        });
    } catch (error) {
        console.log(error);
        return response.status(500).json({ error: "Internal server error" });
    }
});

// DELETE a customer (and their addresses)
app.delete('/api/customers/:id', (request, response) => {
    try {
        const customerId = request.params.id;

        const deleteCustomer = `DELETE FROM customers WHERE id = ?`;

        db.run(deleteCustomer, [customerId], function (err) {
            if (err) return response.status(400).json({ error: err.message });

            if (this.changes === 0) return response.status(404).json({ message: "Customer not found" });

            return response.json({
                message: "success",
                deletedCustomerId: customerId
            });
        });
    } catch (error) {
        console.log(error);
        return response.status(500).json({ error: "Internal server error" });
    }
});

// Address Routes

// ADD a new address for a specific customer
app.post('/api/customers/:id/addresses', (request, response) => {
    try {
        const customerId = request.params.id;

        const errMsg = validateAddressPayload(request.body);
        if (errMsg) return response.status(400).json({ error: errMsg });

        db.get(`SELECT * FROM customers WHERE id = ?`, [customerId], (err, customer) => {
            if (err) return response.status(400).json({ error: err.message });
            if (!customer) return response.status(404).json({ message: "Customer not found" });

            const { address_details, city, state, pin_code } = request.body;

            const sql = `
                INSERT INTO addresses (customer_id, address_details, city, state, pin_code)
                VALUES (?, ?, ?, ?, ?)
            `;

            const params = [customerId, address_details, city, state, pin_code];

            db.run(sql, params, function (err) {
                if (err) return response.status(400).json({ error: err.message });

                return response.status(201).json({
                    message: "success",
                    data: {
                        id: this.lastID,
                        customer_id: parseInt(customerId),
                        address_details,
                        city,
                        state,
                        pin_code
                    }
                });
            });
        });
    } catch (error) {
        console.log(error);
        return response.status(500).json({ error: "Internal server error" });
    }
});

// GET all addresses for a specific customer
app.get('/api/customers/:id/addresses', (request, response) => {
    try {
        const customerId = request.params.id;

        db.get(`SELECT * FROM customers WHERE id = ?`, [customerId], (err, customer) => {
            if (err) return response.status(400).json({ error: err.message });
            if (!customer) return response.status(404).json({ message: "Customer not found" });

            const sqlAddresses = `SELECT * FROM addresses WHERE customer_id = ?`;

            db.all(sqlAddresses, [customerId], (err, rows) => {
                if (err) return response.status(400).json({ error: err.message });

                return response.json({
                    message: "success",
                    data: rows
                });
            });
        });
    } catch (error) {
        console.log(error);
        return response.status(500).json({ error: "Internal server error" });
    }
});

// UPDATE an address by ID
app.put('/api/addresses/:addressId', (request, response) => {
    try {
        const { addressId } = request.params;

        const errMsg = validateAddressPayload(request.body);
        if (errMsg) return response.status(400).json({ error: errMsg });

        const { address_details, city, state, pin_code } = request.body;

        const sql = `
            UPDATE addresses
            SET address_details = ?, city = ?, state = ?, pin_code = ?
            WHERE id = ?
        `;

        db.run(sql, [address_details, city, state, pin_code, addressId], function (err) {
            if (err) return response.status(400).json({ error: err.message });

            if (this.changes === 0) return response.status(404).json({ message: "Address not found" });

            return response.json({
                message: "Address updated successfully",
                data: {
                    id: addressId,
                    address_details,
                    city,
                    state,
                    pin_code
                }
            });
        });
    } catch (error) {
        console.log(error);
        return response.status(500).json({ error: "Internal server error" });
    }
});

// DELETE an address by ID
app.delete('/api/addresses/:addressId', (request, response) => {
    try {
        const { addressId } = request.params;

        const sql = `DELETE FROM addresses WHERE id = ?`;

        db.run(sql, [addressId], function (err) {
            if (err) return response.status(400).json({ error: err.message });

            if (this.changes === 0) return response.status(404).json({ message: "Address not found" });

            return response.json({ message: "Address deleted successfully" });
        });
    } catch (error) {
        console.log(error);
        return response.status(500).json({ error: "Internal server error" });
    }
});

// Start Server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});

module.exports = app;