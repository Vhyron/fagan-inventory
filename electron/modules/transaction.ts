import { getDatabase } from '../db/database';
import { ipcMain } from 'electron';

// transaction interface
interface Transaction {
  id?: number;
  transaction_type: 'issuance' | 'return' | 'adjustment';
  reference_number: string;
  created_by: number;
  approved_by?: number;
  status: 'pending' | 'approved' | 'cancelled';
  notes?: string;
}

// transaction item interface
interface TransactionItem {
  id?: number;
  transaction_id: number;
  stock_item_id: number;
  quantity: number;
  unit_price?: number;
  total_price?: number;
}

// initialize transaction management IPC handlers
export function initTransactionHandlers() {
  // get transactions
  ipcMain.handle('transaction:getTransactions', async (_, 
    filters?: { 
      type?: string, 
      status?: string, 
      startDate?: string, 
      endDate?: string,
      createdBy?: number
    }
  ) => {
    try {
      const db = getDatabase();
      
      let query = `
        SELECT t.*, 
               u1.username as created_by_username,
               u2.username as approved_by_username
        FROM transactions t
        LEFT JOIN users u1 ON t.created_by = u1.id
        LEFT JOIN users u2 ON t.approved_by = u2.id
        WHERE 1=1
      `;
      
      const params: any[] = [];
      
      if (filters?.type) {
        query += ' AND t.transaction_type = ?';
        params.push(filters.type);
      }
      
      if (filters?.status) {
        query += ' AND t.status = ?';
        params.push(filters.status);
      }
      
      if (filters?.startDate) {
        query += ' AND t.created_at >= ?';
        params.push(filters.startDate);
      }
      
      if (filters?.endDate) {
        query += ' AND t.created_at <= ?';
        params.push(filters.endDate);
      }
      
      if (filters?.createdBy) {
        query += ' AND t.created_by = ?';
        params.push(filters.createdBy);
      }
      
      query += ' ORDER BY t.created_at DESC';
      
      const transactions = db.prepare(query).all(...params);
      
      return { success: true, transactions };
    } catch (error) {
      console.error('Get transactions error:', error);
      return { success: false, message: 'An error occurred while fetching transactions' };
    }
  });
  
  // get transaction by ID with items
  ipcMain.handle('transaction:getTransactionById', async (_, transactionId: number) => {
    try {
      const db = getDatabase();
      
      // get transaction
      const transaction = db.prepare(`
        SELECT t.*, 
               u1.username as created_by_username,
               u2.username as approved_by_username
        FROM transactions t
        LEFT JOIN users u1 ON t.created_by = u1.id
        LEFT JOIN users u2 ON t.approved_by = u2.id
        WHERE t.id = ?
      `).get(transactionId);
      
      if (!transaction) {
        return { success: false, message: 'Transaction not found' };
      }
      
      // get transaction items
      const items = db.prepare(`
        SELECT ti.*, si.name as item_name, si.sku, si.unit, si.current_quantity as available_quantity
        FROM transaction_items ti
        LEFT JOIN stock_items si ON ti.stock_item_id = si.id
        WHERE ti.transaction_id = ?
        ORDER BY ti.id
      `).all(transactionId);
      
      return { 
        success: true, 
        transaction, 
        items 
      };
    } catch (error) {
      console.error('Get transaction error:', error);
      return { success: false, message: 'An error occurred while fetching transaction' };
    }
  });
  
  // generate unique reference number for transaction
  ipcMain.handle('transaction:generateReferenceNumber', async (_, type: 'issuance' | 'return' | 'adjustment') => {
    try {
      const db = getDatabase();
      
      // get current year and month
      const date = new Date();
      const year = date.getFullYear().toString().slice(-2);
      const month = (date.getMonth() + 1).toString().padStart(2, '0');
      
      // generate prefix based on transaction type
      let prefix = '';
      
      switch (type) {
        case 'issuance':
          prefix = `ISS-${year}${month}-`;
          break;
        case 'return':
          prefix = `RET-${year}${month}-`;
          break;
        case 'adjustment':
          prefix = `ADJ-${year}${month}-`;
          break;
        default:
          prefix = `TRX-${year}${month}-`;
      }
      
      // get latest reference number with same prefix
      const latestTransaction = db.prepare(`
        SELECT reference_number 
        FROM transactions 
        WHERE reference_number LIKE ? 
        ORDER BY id DESC LIMIT 1
      `).get(`${prefix}%`) as { reference_number: string } | undefined;
      
      let sequence = 1;
      
      if (latestTransaction) {
        // extract sequence number and increment
        const match = latestTransaction.reference_number.match(/\d+$/);
        if (match) {
          sequence = parseInt(match[0], 10) + 1;
        }
      }
      
      // format new reference number
      const referenceNumber = `${prefix}${sequence.toString().padStart(4, '0')}`;
      
      return { 
        success: true, 
        referenceNumber 
      };
    } catch (error) {
      console.error('Generate reference number error:', error);
      return { 
        success: false, 
        message: 'An error occurred while generating reference number',
        // fallback reference number with timestamp
        referenceNumber: `TRX-${new Date().getTime()}`
      };
    }
  });
  
  // create transaction
  ipcMain.handle('transaction:createTransaction', async (
    _, 
    userId: number, 
    transaction: Transaction, 
    items: Omit<TransactionItem, 'transaction_id'>[]
  ) => {
    try {
      const db = getDatabase();
      
      // start transaction
      db.prepare('BEGIN TRANSACTION').run();
      
      try {
        // insert transaction
        const transactionResult = db.prepare(`
          INSERT INTO transactions (
            transaction_type, reference_number, created_by,
            status, notes
          )
          VALUES (?, ?, ?, ?, ?)
        `).run(
          transaction.transaction_type,
          transaction.reference_number,
          userId,
          'pending', // always start as pending
          transaction.notes || null
        );
        
        const transactionId = transactionResult.lastInsertRowid as number;
        
        // insert transaction items
        const insertItem = db.prepare(`
          INSERT INTO transaction_items (
            transaction_id, stock_item_id, quantity, unit_price, total_price
          )
          VALUES (?, ?, ?, ?, ?)
        `);
        
        items.forEach(item => {
          insertItem.run(
            transactionId,
            item.stock_item_id,
            item.quantity,
            item.unit_price || null,
            item.total_price || null
          );
        });
        
        // log activity
        db.prepare(`
          INSERT INTO activity_logs (user_id, action, entity_type, entity_id, details)
          VALUES (?, ?, ?, ?, ?)
        `).run(
          userId, 
          'create', 
          'transaction', 
          transactionId, 
          `Created ${transaction.transaction_type} transaction: ${transaction.reference_number}`
        );
        
        // commit transaction
        db.prepare('COMMIT').run();
        
        return { 
          success: true, 
          message: 'Transaction created successfully',
          transactionId 
        };
      } catch (err) {
        // rollback on error
        db.prepare('ROLLBACK').run();
        throw err;
      }
    } catch (error) {
      console.error('Create transaction error:', error);
      return { success: false, message: 'An error occurred while creating transaction' };
    }
  });
  
  // update transaction status
  ipcMain.handle('transaction:updateStatus', async (
    _, 
    userId: number, 
    transactionId: number, 
    status: 'approved' | 'cancelled',
    updateStock: boolean = true
  ) => {
    try {
      const db = getDatabase();
      
      // start transaction
      db.prepare('BEGIN TRANSACTION').run();
      
      try {
        // check if transaction exists
        const transaction = db.prepare(`
          SELECT id, reference_number, transaction_type, status, created_by
          FROM transactions
          WHERE id = ?
        `).get(transactionId) as { 
          id: number, 
          reference_number: string, 
          transaction_type: string, 
          status: string,
          created_by: number
        } | undefined;
        
        if (!transaction) {
          db.prepare('ROLLBACK').run();
          return { success: false, message: 'Transaction not found' };
        }
        
        // prevent changing status if already approved or cancelled
        if (transaction.status === 'approved' || transaction.status === 'cancelled') {
          db.prepare('ROLLBACK').run();
          return { 
            success: false, 
            message: `Cannot change status of ${transaction.status} transaction` 
          };
        }
        
        // update status
        let updateQuery = '';
        let params: any[] = [];
        
        if (status === 'approved') {
          updateQuery = `
            UPDATE transactions
            SET status = ?, approved_by = ?, updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
          `;
          params = [status, userId, transactionId];
        } else {
          updateQuery = `
            UPDATE transactions
            SET status = ?, updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
          `;
          params = [status, transactionId];
        }
        
        db.prepare(updateQuery).run(...params);
        
        // if status is 'approved' and updateStock is true, update stock quantities
        if (status === 'approved' && updateStock) {
          // get transaction items
          const items = db.prepare(`
            SELECT ti.stock_item_id, ti.quantity
            FROM transaction_items ti
            WHERE ti.transaction_id = ?
          `).all(transactionId) as Array<{stock_item_id: number, quantity: number}>;
          
          // update stock quantities based on transaction type
          const factor = transaction.transaction_type === 'issuance' ? -1 : 1;
          
          const updateStockStmt = db.prepare(`
            UPDATE stock_items
            SET current_quantity = current_quantity + ?, updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
          `);
          
          // for each item, update stock
          for (const item of items) {
            // if issuance, check available quantity
            if (transaction.transaction_type === 'issuance') {
              const stockItem = db.prepare(`
                SELECT current_quantity FROM stock_items WHERE id = ?
              `).get(item.stock_item_id) as { current_quantity: number } | undefined;
              
              if (!stockItem || stockItem.current_quantity < item.quantity) {
                db.prepare('ROLLBACK').run();
                return { 
                  success: false, 
                  message: `Insufficient stock quantity for item ID ${item.stock_item_id}` 
                };
              }
            }
            
            // apply update
            updateStockStmt.run(item.quantity * factor, item.stock_item_id);
            
            // log stock update activity
            db.prepare(`
              INSERT INTO activity_logs (user_id, action, entity_type, entity_id, details)
              VALUES (?, ?, ?, ?, ?)
            `).run(
              userId, 
              'update', 
              'stock_item', 
              item.stock_item_id, 
              `Updated quantity (${factor >= 0 ? '+' : ''}${item.quantity * factor}) from ${status} ${transaction.transaction_type} transaction: ${transaction.reference_number}`
            );
          }
        }
        
        // log activity
        db.prepare(`
          INSERT INTO activity_logs (user_id, action, entity_type, entity_id, details)
          VALUES (?, ?, ?, ?, ?)
        `).run(
          userId, 
          'update', 
          'transaction', 
          transactionId, 
          `Updated ${transaction.transaction_type} transaction status to ${status}: ${transaction.reference_number}`
        );
        
        // commit transaction
        db.prepare('COMMIT').run();
        
        return { 
          success: true, 
          message: `Transaction ${status === 'approved' ? 'approved' : 'cancelled'} successfully` 
        };
      } catch (err) {
        // rollback on error
        db.prepare('ROLLBACK').run();
        throw err;
      }
    } catch (error) {
      console.error('Update transaction status error:', error);
      return { success: false, message: 'An error occurred while updating transaction status' };
    }
  });
}