import { getDatabase } from '../db/database';
import { ipcMain } from 'electron';

// stock category interface
interface StockCategory {
  id?: number;
  name: string;
  description?: string;
}

// stock item interface
interface StockItem {
  id?: number;
  category_id: number;
  name: string;
  description?: string;
  sku: string;
  current_quantity: number;
  unit: string;
  minimum_quantity: number;
}

// initialize stock management IPC handlers
export function initStockHandlers() {
  // =================== CATEGORY HANDLERS ===================
  
  // get all categories
  ipcMain.handle('stock:getCategories', async () => {
    try {
      const db = getDatabase();
      
      const categories = db.prepare(`
        SELECT id, name, description, created_at, updated_at
        FROM stock_categories
        ORDER BY name
      `).all();
      
      return { success: true, categories };
    } catch (error) {
      console.error('Get categories error:', error);
      return { success: false, message: 'An error occurred while fetching categories' };
    }
  });
  
  // create category
  ipcMain.handle('stock:createCategory', async (_, userId: number, category: StockCategory) => {
    try {
      const db = getDatabase();
      
      // check if category name already exists
      const existingCategory = db.prepare('SELECT id FROM stock_categories WHERE name = ?').get(category.name);
      
      if (existingCategory) {
        return { success: false, message: 'Category name already exists' };
      }
      
      const result = db.prepare(`
        INSERT INTO stock_categories (name, description)
        VALUES (?, ?)
      `).run(category.name, category.description || null);
      
      // log activity
      db.prepare(`
        INSERT INTO activity_logs (user_id, action, entity_type, entity_id, details)
        VALUES (?, ?, ?, ?, ?)
      `).run(userId, 'create', 'stock_category', result.lastInsertRowid, `Created category: ${category.name}`);
      
      return { 
        success: true, 
        message: 'Category created successfully',
        categoryId: result.lastInsertRowid
      };
    } catch (error) {
      console.error('Create category error:', error);
      return { success: false, message: 'An error occurred while creating category' };
    }
  });
  
  // update category
  ipcMain.handle('stock:updateCategory', async (_, userId: number, categoryId: number, category: StockCategory) => {
    try {
      const db = getDatabase();
      
      // check if category exists
      const existingCategory = db.prepare('SELECT id FROM stock_categories WHERE id = ?').get(categoryId);
      
      if (!existingCategory) {
        return { success: false, message: 'Category not found' };
      }
      
      // check if name is being changed and if it conflicts
      if (category.name) {
        const nameCheck = db.prepare('SELECT id FROM stock_categories WHERE name = ? AND id != ?').get(category.name, categoryId);
        
        if (nameCheck) {
          return { success: false, message: 'Category name already exists' };
        }
      }
      
      db.prepare(`
        UPDATE stock_categories
        SET name = ?, description = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(category.name, category.description || null, categoryId);
      
      // log activity
      db.prepare(`
        INSERT INTO activity_logs (user_id, action, entity_type, entity_id, details)
        VALUES (?, ?, ?, ?, ?)
      `).run(userId, 'update', 'stock_category', categoryId, `Updated category: ${category.name}`);
      
      return { success: true, message: 'Category updated successfully' };
    } catch (error) {
      console.error('Update category error:', error);
      return { success: false, message: 'An error occurred while updating category' };
    }
  });
  
  // delete category
  ipcMain.handle('stock:deleteCategory', async (_, userId: number, categoryId: number) => {
    try {
      const db = getDatabase();
      
      // check if category exists
      const existingCategory = db.prepare('SELECT name FROM stock_categories WHERE id = ?').get(categoryId) as { name: string } | undefined;
      
      if (!existingCategory) {
        return { success: false, message: 'Category not found' };
      }
      
      // check if category has stock items
      const itemCount = db.prepare('SELECT COUNT(*) as count FROM stock_items WHERE category_id = ?').get(categoryId) as { count: number };
      
      if (itemCount.count > 0) {
        return { success: false, message: 'Cannot delete category with existing stock items' };
      }
      
      db.prepare('DELETE FROM stock_categories WHERE id = ?').run(categoryId);
      
      // log activity
      db.prepare(`
        INSERT INTO activity_logs (user_id, action, entity_type, entity_id, details)
        VALUES (?, ?, ?, ?, ?)
      `).run(userId, 'delete', 'stock_category', categoryId, `Deleted category: ${existingCategory.name}`);
      
      return { success: true, message: 'Category deleted successfully' };
    } catch (error) {
      console.error('Delete category error:', error);
      return { success: false, message: 'An error occurred while deleting category' };
    }
  });
  
  // =================== STOCK ITEM HANDLERS ===================
  
  // get all stock items
  ipcMain.handle('stock:getItems', async (_, filters?: { categoryId?: number, search?: string, lowStock?: boolean }) => {
    try {
      const db = getDatabase();
      
      let query = `
        SELECT si.*, sc.name as category_name
        FROM stock_items si
        LEFT JOIN stock_categories sc ON si.category_id = sc.id
        WHERE 1=1
      `;
      
      const params: any[] = [];
      
      if (filters?.categoryId) {
        query += ' AND si.category_id = ?';
        params.push(filters.categoryId);
      }
      
      if (filters?.search) {
        query += ' AND (si.name LIKE ? OR si.sku LIKE ?)';
        const searchTerm = `%${filters.search}%`;
        params.push(searchTerm, searchTerm);
      }
      
      if (filters?.lowStock) {
        query += ' AND si.current_quantity <= si.minimum_quantity';
      }
      
      query += ' ORDER BY si.name';
      
      const items = db.prepare(query).all(...params);
      
      return { success: true, items };
    } catch (error) {
      console.error('Get stock items error:', error);
      return { success: false, message: 'An error occurred while fetching stock items' };
    }
  });
  
  // get stock item by ID
  ipcMain.handle('stock:getItemById', async (_, itemId: number) => {
    try {
      const db = getDatabase();
      
      const item = db.prepare(`
        SELECT si.*, sc.name as category_name
        FROM stock_items si
        LEFT JOIN stock_categories sc ON si.category_id = sc.id
        WHERE si.id = ?
      `).get(itemId);
      
      if (!item) {
        return { success: false, message: 'Stock item not found' };
      }
      
      return { success: true, item };
    } catch (error) {
      console.error('Get stock item error:', error);
      return { success: false, message: 'An error occurred while fetching stock item' };
    }
  });
  
  // create stock item
  ipcMain.handle('stock:createItem', async (_, userId: number, item: StockItem) => {
    try {
      const db = getDatabase();
      
      // check if SKU already exists
      const existingSku = db.prepare('SELECT id FROM stock_items WHERE sku = ?').get(item.sku);
      
      if (existingSku) {
        return { success: false, message: 'SKU already exists' };
      }
      
      // check if category exists
      const categoryCheck = db.prepare('SELECT id FROM stock_categories WHERE id = ?').get(item.category_id);
      
      if (!categoryCheck) {
        return { success: false, message: 'Category not found' };
      }
      
      const result = db.prepare(`
        INSERT INTO stock_items (
          category_id, name, description, sku, 
          current_quantity, unit, minimum_quantity
        )
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        item.category_id,
        item.name,
        item.description || null,
        item.sku,
        item.current_quantity,
        item.unit,
        item.minimum_quantity
      );
      
      // log activity
      db.prepare(`
        INSERT INTO activity_logs (user_id, action, entity_type, entity_id, details)
        VALUES (?, ?, ?, ?, ?)
      `).run(
        userId, 
        'create', 
        'stock_item', 
        result.lastInsertRowid, 
        `Created stock item: ${item.name} (${item.sku})`
      );
      
      return { 
        success: true, 
        message: 'Stock item created successfully',
        itemId: result.lastInsertRowid
      };
    } catch (error) {
      console.error('Create stock item error:', error);
      return { success: false, message: 'An error occurred while creating stock item' };
    }
  });
  
  // update stock item
  ipcMain.handle('stock:updateItem', async (_, userId: number, itemId: number, item: Partial<StockItem>) => {
    try {
      const db = getDatabase();
      
      // check if item exists
      const existingItem = db.prepare('SELECT name, sku FROM stock_items WHERE id = ?').get(itemId) as { name: string, sku: string } | undefined;
      
      if (!existingItem) {
        return { success: false, message: 'Stock item not found' };
      }
      
      // check if SKU is being changed and if it conflicts
      if (item.sku && item.sku !== existingItem.sku) {
        const skuCheck = db.prepare('SELECT id FROM stock_items WHERE sku = ? AND id != ?').get(item.sku, itemId);
        
        if (skuCheck) {
          return { success: false, message: 'SKU already exists' };
        }
      }
      
      // check if category exists (if being changed)
      if (item.category_id) {
        const categoryCheck = db.prepare('SELECT id FROM stock_categories WHERE id = ?').get(item.category_id);
        
        if (!categoryCheck) {
          return { success: false, message: 'Category not found' };
        }
      }
      
      // build update query dynamically based on provided fields
      let updateFields: string[] = [];
      const params: any[] = [];
      
      if (item.category_id !== undefined) {
        updateFields.push('category_id = ?');
        params.push(item.category_id);
      }
      
      if (item.name !== undefined) {
        updateFields.push('name = ?');
        params.push(item.name);
      }
      
      if (item.description !== undefined) {
        updateFields.push('description = ?');
        params.push(item.description || null);
      }
      
      if (item.sku !== undefined) {
        updateFields.push('sku = ?');
        params.push(item.sku);
      }
      
      if (item.current_quantity !== undefined) {
        updateFields.push('current_quantity = ?');
        params.push(item.current_quantity);
      }
      
      if (item.unit !== undefined) {
        updateFields.push('unit = ?');
        params.push(item.unit);
      }
      
      if (item.minimum_quantity !== undefined) {
        updateFields.push('minimum_quantity = ?');
        params.push(item.minimum_quantity);
      }
      
      // add updated_at timestamp
      updateFields.push('updated_at = CURRENT_TIMESTAMP');
      
      // add item ID to parameters
      params.push(itemId);
      
      // execute update query
      db.prepare(`
        UPDATE stock_items
        SET ${updateFields.join(', ')}
        WHERE id = ?
      `).run(...params);
      
      // log activity
      const updatedFields = Object.keys(item)
        .filter(key => key !== 'id')
        .join(', ');
      
      db.prepare(`
        INSERT INTO activity_logs (user_id, action, entity_type, entity_id, details)
        VALUES (?, ?, ?, ?, ?)
      `).run(
        userId, 
        'update', 
        'stock_item', 
        itemId, 
        `Updated stock item fields (${updatedFields}): ${existingItem.name} (${existingItem.sku})`
      );
      
      return { success: true, message: 'Stock item updated successfully' };
    } catch (error) {
      console.error('Update stock item error:', error);
      return { success: false, message: 'An error occurred while updating stock item' };
    }
  });
  
  // update stock quantity
  ipcMain.handle('stock:updateQuantity', async (_, userId: number, itemId: number, newQuantity: number, reason: string) => {
    try {
      const db = getDatabase();
      
      // check if item exists
      const existingItem = db.prepare('SELECT name, sku, current_quantity FROM stock_items WHERE id = ?').get(itemId) as { 
        name: string, 
        sku: string, 
        current_quantity: number 
      } | undefined;
      
      if (!existingItem) {
        return { success: false, message: 'Stock item not found' };
      }
      
      // calculate quantity change
      const quantityChange = newQuantity - existingItem.current_quantity;
      
      // update quantity
      db.prepare(`
        UPDATE stock_items
        SET current_quantity = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(newQuantity, itemId);
      
      // log activity
      db.prepare(`
        INSERT INTO activity_logs (user_id, action, entity_type, entity_id, details)
        VALUES (?, ?, ?, ?, ?)
      `).run(
        userId, 
        'update', 
        'stock_item', 
        itemId, 
        `Updated quantity from ${existingItem.current_quantity} to ${newQuantity} (${quantityChange >= 0 ? '+' : ''}${quantityChange}). Reason: ${reason}`
      );
      
      return { 
        success: true, 
        message: 'Stock quantity updated successfully',
        oldQuantity: existingItem.current_quantity,
        newQuantity,
        change: quantityChange
      };
    } catch (error) {
      console.error('Update stock quantity error:', error);
      return { success: false, message: 'An error occurred while updating stock quantity' };
    }
  });
  
  // get low stock items
  ipcMain.handle('stock:getLowStockItems', async () => {
    try {
      const db = getDatabase();
      
      const items = db.prepare(`
        SELECT si.*, sc.name as category_name
        FROM stock_items si
        LEFT JOIN stock_categories sc ON si.category_id = sc.id
        WHERE si.current_quantity <= si.minimum_quantity
        ORDER BY si.current_quantity / si.minimum_quantity ASC
      `).all();
      
      return { success: true, items };
    } catch (error) {
      console.error('Get low stock items error:', error);
      return { success: false, message: 'An error occurred while fetching low stock items' };
    }
  });
}