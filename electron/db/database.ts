import { app } from 'electron';
import path from 'path';
import Database from 'better-sqlite3';
import fs from 'fs';

// determine the database file path based on environment
const isDevelopment = process.env.NODE_ENV === 'development';
const dbFolder = isDevelopment 
  ? path.join(process.env.APP_ROOT || '', 'database') 
  : path.join(app.getPath('userData'), 'database');

// ensure database directory exists
if (!fs.existsSync(dbFolder)) {
  fs.mkdirSync(dbFolder, { recursive: true });
}

const dbPath = path.join(dbFolder, 'inventory.db');

// initialize database
let db: Database.Database;

export function initDatabase() {
  try {
    db = new Database(dbPath, { verbose: console.log });
    createTables();
    seedAdminUsers();
    return db;
  } catch (error) {
    console.error('Database initialization error:', error);
    throw error;
  }
}

export function getDatabase() {
  if (!db) {
    return initDatabase();
  }
  return db;
}

function createTables() {
  // create users table
  db.prepare(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      role TEXT NOT NULL,
      is_active BOOLEAN NOT NULL DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `).run();
  
  // create stock categories table
  db.prepare(`
    CREATE TABLE IF NOT EXISTS stock_categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      description TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `).run();
  
  // create stock items table
  db.prepare(`
    CREATE TABLE IF NOT EXISTS stock_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      category_id INTEGER,
      name TEXT NOT NULL,
      description TEXT,
      sku TEXT UNIQUE,
      current_quantity INTEGER DEFAULT 0,
      unit TEXT,
      minimum_quantity INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (category_id) REFERENCES stock_categories(id)
    )
  `).run();
  
  // create suppliers table
  db.prepare(`
    CREATE TABLE IF NOT EXISTS suppliers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      contact_person TEXT,
      phone TEXT,
      email TEXT,
      address TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `).run();
  
  // create purchase_orders table
  db.prepare(`
    CREATE TABLE IF NOT EXISTS purchase_orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      supplier_id INTEGER,
      order_number TEXT UNIQUE,
      status TEXT DEFAULT 'pending',
      created_by INTEGER,
      approved_by INTEGER,
      order_date DATETIME DEFAULT CURRENT_TIMESTAMP,
      expected_delivery_date DATETIME,
      total_amount REAL,
      notes TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (supplier_id) REFERENCES suppliers(id),
      FOREIGN KEY (created_by) REFERENCES users(id),
      FOREIGN KEY (approved_by) REFERENCES users(id)
    )
  `).run();
  
  // create purchase_order_items table
  db.prepare(`
    CREATE TABLE IF NOT EXISTS purchase_order_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      purchase_order_id INTEGER,
      stock_item_id INTEGER,
      quantity INTEGER,
      unit_price REAL,
      total_price REAL,
      FOREIGN KEY (purchase_order_id) REFERENCES purchase_orders(id),
      FOREIGN KEY (stock_item_id) REFERENCES stock_items(id)
    )
  `).run();
  
  // create transactions table
  db.prepare(`
    CREATE TABLE IF NOT EXISTS transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      transaction_type TEXT NOT NULL,
      reference_number TEXT UNIQUE,
      created_by INTEGER,
      approved_by INTEGER,
      status TEXT DEFAULT 'pending',
      notes TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (created_by) REFERENCES users(id),
      FOREIGN KEY (approved_by) REFERENCES users(id)
    )
  `).run();
  
  // create transaction_items table
  db.prepare(`
    CREATE TABLE IF NOT EXISTS transaction_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      transaction_id INTEGER,
      stock_item_id INTEGER,
      quantity INTEGER,
      unit_price REAL,
      total_price REAL,
      FOREIGN KEY (transaction_id) REFERENCES transactions(id),
      FOREIGN KEY (stock_item_id) REFERENCES stock_items(id)
    )
  `).run();
  
  // create activity_logs table
  db.prepare(`
    CREATE TABLE IF NOT EXISTS activity_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      action TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id INTEGER,
      details TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `).run();
}

// seed admin users if they don't exist
function seedAdminUsers() {
  const adminUsers = [
    { username: 'fagan@admin1', password: 'fagan_password1', role: 'admin' },
    { username: 'fagan@admin2', password: 'fagan_password2', role: 'admin' }
  ];

  const insertUser = db.prepare(`
    INSERT OR IGNORE INTO users (username, password, role, is_active)
    VALUES (@username, @password, @role, 1)
  `);

  const checkUserExists = db.prepare('SELECT id FROM users WHERE username = ?');

  adminUsers.forEach(user => {
    const existingUser = checkUserExists.get(user.username);
    if (!existingUser) {
      insertUser.run(user);
    }
  });
}

// clean up database connection on exit
process.on('exit', () => {
  if (db) {
    db.close();
  }
});