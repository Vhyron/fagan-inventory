import { getDatabase } from '../db/database';
import { ipcMain } from 'electron';

// supplier interface
interface Supplier {
  id?: number;
  name: string;
  contact_person?: string;
  phone?: string;
  email?: string;
  address?: string;
}

// purchase order interface
interface PurchaseOrder {
  id?: number;
  supplier_id: number;
  order_number: string;
  status: 'pending' | 'approved' | 'received' | 'cancelled';
  created_by: number;
  approved_by?: number;
  expected_delivery_date?: string;
  total_amount: number;
  notes?: string;
}

// purchase order item interface
interface PurchaseOrderItem {
  id?: number;
  purchase_order_id: number;
  stock_item_id: number;
  quantity: number;
  unit_price: number;
  total_price: number;
}

// initialize supply management IPC handlers
export function initSupplyHandlers() {
  // =================== SUPPLIER HANDLERS ===================
  
  // get all suppliers
  ipcMain.handle('supply:getSuppliers', async (_, search?: string) => {
    try {
      const db = getDatabase();
      
      let query = `
        SELECT id, name, contact_person, phone, email, address, created_at, updated_at
        FROM suppliers
      `;
      
      const params: any[] = [];
      
      if (search) {
        query += ' WHERE name LIKE ? OR contact_person LIKE ? OR email LIKE ?';
        const searchTerm = `%${search}%`;
        params.push(searchTerm, searchTerm, searchTerm);
      }
      
      query += ' ORDER BY name';
      
      const suppliers = db.prepare(query).all(...params);
      
      return { success: true, suppliers };
    } catch (error) {
      console.error('Get suppliers error:', error);
      return { success: false, message: 'An error occurred while fetching suppliers' };
    }
  });
  
  // get supplier by ID
  ipcMain.handle('supply:getSupplierById', async (_, supplierId: number) => {
    try {
      const db = getDatabase();
      
      const supplier = db.prepare(`
        SELECT id, name, contact_person, phone, email, address, created_at, updated_at
        FROM suppliers
        WHERE id = ?
      `).get(supplierId);
      
      if (!supplier) {
        return { success: false, message: 'Supplier not found' };
      }
      
      return { success: true, supplier };
    } catch (error) {
      console.error('Get supplier error:', error);
      return { success: false, message: 'An error occurred while fetching supplier' };
    }
  });
  
  // create supplier
  ipcMain.handle('supply:createSupplier', async (_, userId: number, supplier: Supplier) => {
    try {
      const db = getDatabase();
      
      const result = db.prepare(`
        INSERT INTO suppliers (name, contact_person, phone, email, address)
        VALUES (?, ?, ?, ?, ?)
      `).run(
        supplier.name,
        supplier.contact_person || null,
        supplier.phone || null,
        supplier.email || null,
        supplier.address || null
      );
      
      // log activity
      db.prepare(`
        INSERT INTO activity_logs (user_id, action, entity_type, entity_id, details)
        VALUES (?, ?, ?, ?, ?)
      `).run(
        userId, 
        'create', 
        'supplier', 
        result.lastInsertRowid, 
        `Created supplier: ${supplier.name}`
      );
      
      return { 
        success: true, 
        message: 'Supplier created successfully',
        supplierId: result.lastInsertRowid
      };
    } catch (error) {
      console.error('Create supplier error:', error);
      return { success: false, message: 'An error occurred while creating supplier' };
    }
  });
  
  // update supplier
  ipcMain.handle('supply:updateSupplier', async (_, userId: number, supplierId: number, supplier: Partial<Supplier>) => {
    try {
      const db = getDatabase();
      
      // check if supplier exists
      const existingSupplier = db.prepare('SELECT name FROM suppliers WHERE id = ?').get(supplierId) as { name: string } | undefined;
      
      if (!existingSupplier) {
        return { success: false, message: 'Supplier not found' };
      }
      
      // build update query dynamically based on provided fields
      let updateFields: string[] = [];
      const params: any[] = [];
      
      if (supplier.name !== undefined) {
        updateFields.push('name = ?');
        params.push(supplier.name);
      }
      
      if (supplier.contact_person !== undefined) {
        updateFields.push('contact_person = ?');
        params.push(supplier.contact_person || null);
      }
      
      if (supplier.phone !== undefined) {
        updateFields.push('phone = ?');
        params.push(supplier.phone || null);
      }
      
      if (supplier.email !== undefined) {
        updateFields.push('email = ?');
        params.push(supplier.email || null);
      }
      
      if (supplier.address !== undefined) {
        updateFields.push('address = ?');
        params.push(supplier.address || null);
      }
      
      // add updated_at timestamp
      updateFields.push('updated_at = CURRENT_TIMESTAMP');
      
      // add supplier ID to parameters
      params.push(supplierId);
      
      // execute update query
      db.prepare(`
        UPDATE suppliers
        SET ${updateFields.join(', ')}
        WHERE id = ?
      `).run(...params);
      
      // log activity
      const updatedFields = Object.keys(supplier)
        .filter(key => key !== 'id')
        .join(', ');
      
      db.prepare(`
        INSERT INTO activity_logs (user_id, action, entity_type, entity_id, details)
        VALUES (?, ?, ?, ?, ?)
      `).run(
        userId, 
        'update', 
        'supplier', 
        supplierId, 
        `Updated supplier fields (${updatedFields}): ${existingSupplier.name}`
      );
      
      return { success: true, message: 'Supplier updated successfully' };
    } catch (error) {
      console.error('Update supplier error:', error);
      return { success: false, message: 'An error occurred while updating supplier' };
    }
  });
  
  // =================== PURCHASE ORDER HANDLERS ===================
  
  // get purchase orders
  ipcMain.handle('supply:getPurchaseOrders', async (_, 
    filters?: { 
      supplierId?: number, 
      status?: string, 
      startDate?: string, 
      endDate?: string 
    }
  ) => {
    try {
      const db = getDatabase();
      
      let query = `
        SELECT po.*, s.name as supplier_name, 
               u1.username as created_by_username,
               u2.username as approved_by_username
        FROM purchase_orders po
        LEFT JOIN suppliers s ON po.supplier_id = s.id
        LEFT JOIN users u1 ON po.created_by = u1.id
        LEFT JOIN users u2 ON po.approved_by = u2.id
        WHERE 1=1
      `;
      
      const params: any[] = [];
      
      if (filters?.supplierId) {
        query += ' AND po.supplier_id = ?';
        params.push(filters.supplierId);
      }
      
      if (filters?.status) {
        query += ' AND po.status = ?';
        params.push(filters.status);
      }
      
      if (filters?.startDate) {
        query += ' AND po.order_date >= ?';
        params.push(filters.startDate);
      }
      
      if (filters?.endDate) {
        query += ' AND po.order_date <= ?';
        params.push(filters.endDate);
      }
      
      query += ' ORDER BY po.order_date DESC';
      
      const orders = db.prepare(query).all(...params);
      
      return { success: true, orders };
    } catch (error) {
      console.error('Get purchase orders error:', error);
      return { success: false, message: 'An error occurred while fetching purchase orders' };
    }
  });
  
  // get purchase order by ID with items
  ipcMain.handle('supply:getPurchaseOrderById', async (_, orderId: number) => {
    try {
      const db = getDatabase();
      
      // get purchase order
      const order = db.prepare(`
        SELECT po.*, s.name as supplier_name, 
               u1.username as created_by_username,
               u2.username as approved_by_username
        FROM purchase_orders po
        LEFT JOIN suppliers s ON po.supplier_id = s.id
        LEFT JOIN users u1 ON po.created_by = u1.id
        LEFT JOIN users u2 ON po.approved_by = u2.id
        WHERE po.id = ?
      `).get(orderId);
      
      if (!order) {
        return { success: false, message: 'Purchase order not found' };
      }
      
      // get purchase order items
      const items = db.prepare(`
        SELECT poi.*, si.name as item_name, si.sku, si.unit
        FROM purchase_order_items poi
        LEFT JOIN stock_items si ON poi.stock_item_id = si.id
        WHERE poi.purchase_order_id = ?
        ORDER BY poi.id
      `).all(orderId);
      
      return { 
        success: true, 
        order, 
        items 
      };
    } catch (error) {
      console.error('Get purchase order error:', error);
      return { success: false, message: 'An error occurred while fetching purchase order' };
    }
  });
  
  // generate unique order number
  ipcMain.handle('supply:generateOrderNumber', async () => {
    try {
      const db = getDatabase();
      
      // get current year and month
      const date = new Date();
      const year = date.getFullYear().toString().slice(-2);
      const month = (date.getMonth() + 1).toString().padStart(2, '0');
      
      // get latest order number with same prefix
      const prefix = `PO-${year}${month}-`;
      
      const latestOrder = db.prepare(`
        SELECT order_number 
        FROM purchase_orders 
        WHERE order_number LIKE ? 
        ORDER BY id DESC LIMIT 1
      `).get(`${prefix}%`) as { order_number: string } | undefined;
      
      let sequence = 1;
      
      if (latestOrder) {
        // extract sequence number and increment
        const match = latestOrder.order_number.match(/\d+$/);
        if (match) {
          sequence = parseInt(match[0], 10) + 1;
        }
      }
      
      // format new order number
      const orderNumber = `${prefix}${sequence.toString().padStart(4, '0')}`;
      
      return { 
        success: true, 
        orderNumber 
      };
    } catch (error) {
      console.error('Generate order number error:', error);
      return { 
        success: false, 
        message: 'An error occurred while generating order number',
        // fallback order number with timestamp
        orderNumber: `PO-${new Date().getTime()}`
      };
    }
  });
  
  // create purchase order
  ipcMain.handle('supply:createPurchaseOrder', async (
    _, 
    userId: number, 
    order: PurchaseOrder, 
    items: Omit<PurchaseOrderItem, 'purchase_order_id'>[]
  ) => {
    try {
      const db = getDatabase();
      
      // start transaction
      db.prepare('BEGIN TRANSACTION').run();
      
      try {
        // insert purchase order
        const orderResult = db.prepare(`
          INSERT INTO purchase_orders (
            supplier_id, order_number, status, created_by,
            expected_delivery_date, total_amount, notes
          )
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(
          order.supplier_id,
          order.order_number,
          'pending', // always start as pending
          userId,
          order.expected_delivery_date || null,
          order.total_amount,
          order.notes || null
        );
        
        const orderId = orderResult.lastInsertRowid as number;
        
        // insert purchase order items
        const insertItem = db.prepare(`
          INSERT INTO purchase_order_items (
            purchase_order_id, stock_item_id, quantity, unit_price, total_price
          )
          VALUES (?, ?, ?, ?, ?)
        `);
        
        items.forEach(item => {
          insertItem.run(
            orderId,
            item.stock_item_id,
            item.quantity,
            item.unit_price,
            item.total_price
          );
        });
        
        // log activity
        db.prepare(`
          INSERT INTO activity_logs (user_id, action, entity_type, entity_id, details)
          VALUES (?, ?, ?, ?, ?)
        `).run(
          userId, 
          'create', 
          'purchase_order', 
          orderId, 
          `Created purchase order: ${order.order_number}`
        );
        
        // commit transaction
        db.prepare('COMMIT').run();
        
        return { 
          success: true, 
          message: 'Purchase order created successfully',
          orderId 
        };
      } catch (err) {
        // rollback on error
        db.prepare('ROLLBACK').run();
        throw err;
      }
    } catch (error) {
      console.error('Create purchase order error:', error);
      return { success: false, message: 'An error occurred while creating purchase order' };
    }
  });
  
  // update purchase order status
  ipcMain.handle('supply:updateOrderStatus', async (
    _, 
    userId: number, 
    orderId: number, 
    status: 'approved' | 'received' | 'cancelled',
    updateStock: boolean = false
  ) => {
    try {
      const db = getDatabase();
      
      // start transaction
      db.prepare('BEGIN TRANSACTION').run();
      
      try {
        // check if order exists
        const order = db.prepare(`
          SELECT id, order_number, status, created_by, supplier_id, total_amount
          FROM purchase_orders
          WHERE id = ?
        `).get(orderId) as { 
          id: number, 
          order_number: string, 
          status: string, 
          created_by: number, 
          supplier_id: number, 
          total_amount: number 
        } | undefined;
        
        if (!order) {
          db.prepare('ROLLBACK').run();
          return { success: false, message: 'Purchase order not found' };
        }
        
        // prevent changing status if already received or cancelled
        if (order.status === 'received' || order.status === 'cancelled') {
          db.prepare('ROLLBACK').run();
          return { 
            success: false, 
            message: `Cannot change status of ${order.status} purchase order` 
          };
        }
        
        // update status and other fields
        let updateQuery = '';
        let params: any[] = [];
        
        if (status === 'approved') {
          updateQuery = `
            UPDATE purchase_orders
            SET status = ?, approved_by = ?, updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
          `;
          params = [status, userId, orderId];
        } else {
          updateQuery = `
            UPDATE purchase_orders
            SET status = ?, updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
          `;
          params = [status, orderId];
        }
        
        db.prepare(updateQuery).run(...params);
        
        // if status is 'received' and updateStock is true, update stock quantities
        if (status === 'received' && updateStock) {
          // get purchase order items
          const items = db.prepare(`
            SELECT poi.stock_item_id, poi.quantity
            FROM purchase_order_items poi
            WHERE poi.purchase_order_id = ?
          `).all(orderId) as Array<{stock_item_id: number, quantity: number}>;
          
          // update stock quantities
          const updateStockStmt = db.prepare(`
            UPDATE stock_items
            SET current_quantity = current_quantity + ?, updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
          `);
          
          items.forEach(item => {
            updateStockStmt.run(item.quantity, item.stock_item_id);
            
            // log stock update activity
            db.prepare(`
              INSERT INTO activity_logs (user_id, action, entity_type, entity_id, details)
              VALUES (?, ?, ?, ?, ?)
            `).run(
              userId, 
              'update', 
              'stock_item', 
              item.stock_item_id, 
              `Updated quantity (+${item.quantity}) from received purchase order: ${order.order_number}`
            );
          });
        }
        
        // log activity
        db.prepare(`
          INSERT INTO activity_logs (user_id, action, entity_type, entity_id, details)
          VALUES (?, ?, ?, ?, ?)
        `).run(
          userId, 
          'update', 
          'purchase_order', 
          orderId, 
          `Updated purchase order status to ${status}: ${order.order_number}`
        );
        
        // commit transaction
        db.prepare('COMMIT').run();
        
        return { 
          success: true, 
          message: `Purchase order ${status === 'approved' ? 'approved' : status === 'received' ? 'marked as received' : 'cancelled'} successfully` 
        };
      } catch (err) {
        // rollback on error
        db.prepare('ROLLBACK').run();
        throw err;
      }
    } catch (error) {
      console.error('Update purchase order status error:', error);
      return { success: false, message: 'An error occurred while updating purchase order status' };
    }
  });
}