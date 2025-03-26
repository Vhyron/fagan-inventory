import { getDatabase } from '../db/database';
import { ipcMain } from 'electron';
import path from 'path';
import fs from 'fs';
import { app } from 'electron';

// initialize reports IPC handlers
export function initReportsHandlers() {
  // dashboard summary data
  ipcMain.handle('reports:getDashboardSummary', async () => {
    try {
      const db = getDatabase();
      
      // get total stock items
      const stockCount = db.prepare('SELECT COUNT(*) as count FROM stock_items').get() as { count: number };
      
      // get low stock items count
      const lowStockCount = db.prepare(`
        SELECT COUNT(*) as count 
        FROM stock_items 
        WHERE current_quantity <= minimum_quantity
      `).get() as { count: number };
      
      // get pending orders count
      const pendingOrdersCount = db.prepare(`
        SELECT COUNT(*) as count 
        FROM purchase_orders 
        WHERE status = 'pending'
      `).get() as { count: number };
      
      // get pending transactions count
      const pendingTransactionsCount = db.prepare(`
        SELECT COUNT(*) as count 
        FROM transactions 
        WHERE status = 'pending'
      `).get() as { count: number };
      
      // get recent activity
      const recentActivity = db.prepare(`
        SELECT al.id, al.action, al.entity_type, al.details, al.created_at, 
               u.username as user
        FROM activity_logs al
        LEFT JOIN users u ON al.user_id = u.id
        ORDER BY al.created_at DESC
        LIMIT 10
      `).all();
      
      return { 
        success: true, 
        summary: {
          stockCount: stockCount.count,
          lowStockCount: lowStockCount.count,
          pendingOrdersCount: pendingOrdersCount.count,
          pendingTransactionsCount: pendingTransactionsCount.count,
          recentActivity
        }
      };
    } catch (error) {
      console.error('Get dashboard summary error:', error);
      return { success: false, message: 'An error occurred while fetching dashboard summary' };
    }
  });
  
  // stock level report
  ipcMain.handle('reports:getStockLevelReport', async () => {
    try {
      const db = getDatabase();
      
      const stockItems = db.prepare(`
        SELECT si.*, sc.name as category_name,
               (si.current_quantity <= si.minimum_quantity) as is_low_stock
        FROM stock_items si
        LEFT JOIN stock_categories sc ON si.category_id = sc.id
        ORDER BY sc.name, si.name
      `).all();
      
      const categorySummary = db.prepare(`
        SELECT sc.id, sc.name,
               COUNT(si.id) as item_count,
               SUM(si.current_quantity) as total_quantity,
               SUM(CASE WHEN si.current_quantity <= si.minimum_quantity THEN 1 ELSE 0 END) as low_stock_count
        FROM stock_categories sc
        LEFT JOIN stock_items si ON sc.id = si.category_id
        GROUP BY sc.id
        ORDER BY sc.name
      `).all();
      
      return { 
        success: true, 
        stockItems,
        categorySummary
      };
    } catch (error) {
      console.error('Get stock level report error:', error);
      return { success: false, message: 'An error occurred while fetching stock level report' };
    }
  });
  
  // stock movement report
  ipcMain.handle('reports:getStockMovementReport', async (_, 
    filters: { 
      startDate?: string, 
      endDate?: string,
      stockItemId?: number
    }
  ) => {
    try {
      const db = getDatabase();
      
      let query = `
        SELECT al.id, al.action, al.details, al.created_at, 
               si.id as stock_item_id, si.name as stock_item_name, si.sku,
               u.username as user
        FROM activity_logs al
        JOIN users u ON al.user_id = u.id
        JOIN stock_items si ON al.entity_id = si.id
        WHERE al.entity_type = 'stock_item' 
          AND (al.action = 'update' AND al.details LIKE '%quantity%')
      `;
      
      const params: any[] = [];
      
      if (filters.stockItemId) {
        query += ' AND si.id = ?';
        params.push(filters.stockItemId);
      }
      
      if (filters.startDate) {
        query += ' AND al.created_at >= ?';
        params.push(filters.startDate);
      }
      
      if (filters.endDate) {
        query += ' AND al.created_at <= ?';
        params.push(filters.endDate);
      }
      
      query += ' ORDER BY al.created_at DESC';
      
      const movements = db.prepare(query).all(...params);
      
      return { 
        success: true, 
        movements
      };
    } catch (error) {
      console.error('Get stock movement report error:', error);
      return { success: false, message: 'An error occurred while fetching stock movement report' };
    }
  });
  
  // transaction report
  ipcMain.handle('reports:getTransactionReport', async (_, 
    filters: { 
      startDate?: string, 
      endDate?: string,
      type?: string,
      status?: string
    }
  ) => {
    try {
      const db = getDatabase();
      
      let query = `
        SELECT t.*, 
               u1.username as created_by_username,
               u2.username as approved_by_username,
               COUNT(ti.id) as item_count,
               SUM(ti.quantity) as total_quantity
        FROM transactions t
        LEFT JOIN users u1 ON t.created_by = u1.id
        LEFT JOIN users u2 ON t.approved_by = u2.id
        LEFT JOIN transaction_items ti ON t.id = ti.transaction_id
        WHERE 1=1
      `;
      
      const params: any[] = [];
      
      if (filters.type) {
        query += ' AND t.transaction_type = ?';
        params.push(filters.type);
      }
      
      if (filters.status) {
        query += ' AND t.status = ?';
        params.push(filters.status);
      }
      
      if (filters.startDate) {
        query += ' AND t.created_at >= ?';
        params.push(filters.startDate);
      }
      
      if (filters.endDate) {
        query += ' AND t.created_at <= ?';
        params.push(filters.endDate);
      }
      
      query += ' GROUP BY t.id ORDER BY t.created_at DESC';
      
      const transactions = db.prepare(query).all(...params);
      
      // get summary statistics
      const summary = {
        total: transactions.length,
        byType: {} as Record<string, number>,
        byStatus: {} as Record<string, number>
      };
      
      transactions.forEach((t: any) => {
        // count by type
        if (!summary.byType[t.transaction_type]) {
          summary.byType[t.transaction_type] = 0;
        }
        summary.byType[t.transaction_type]++;
        
        // count by status
        if (!summary.byStatus[t.status]) {
          summary.byStatus[t.status] = 0;
        }
        summary.byStatus[t.status]++;
      });
      
      return { 
        success: true, 
        transactions,
        summary
      };
    } catch (error) {
      console.error('Get transaction report error:', error);
      return { success: false, message: 'An error occurred while fetching transaction report' };
    }
  });
  
  // purchase order report
  ipcMain.handle('reports:getPurchaseOrderReport', async (_, 
    filters: { 
      startDate?: string, 
      endDate?: string,
      supplierId?: number,
      status?: string
    }
  ) => {
    try {
      const db = getDatabase();
      
      let query = `
        SELECT po.*, s.name as supplier_name, 
               u1.username as created_by_username,
               u2.username as approved_by_username,
               COUNT(poi.id) as item_count,
               SUM(poi.quantity) as total_quantity
        FROM purchase_orders po
        LEFT JOIN suppliers s ON po.supplier_id = s.id
        LEFT JOIN users u1 ON po.created_by = u1.id
        LEFT JOIN users u2 ON po.approved_by = u2.id
        LEFT JOIN purchase_order_items poi ON po.id = poi.purchase_order_id
        WHERE 1=1
      `;
      
      const params: any[] = [];
      
      if (filters.supplierId) {
        query += ' AND po.supplier_id = ?';
        params.push(filters.supplierId);
      }
      
      if (filters.status) {
        query += ' AND po.status = ?';
        params.push(filters.status);
      }
      
      if (filters.startDate) {
        query += ' AND po.order_date >= ?';
        params.push(filters.startDate);
      }
      
      if (filters.endDate) {
        query += ' AND po.order_date <= ?';
        params.push(filters.endDate);
      }
      
      query += ' GROUP BY po.id ORDER BY po.order_date DESC';
      
      const orders = db.prepare(query).all(...params);
      
      // get summary statistics
      const summary = {
        total: orders.length,
        totalAmount: orders.reduce((sum, o: any) => sum + (o.total_amount || 0), 0),
        byStatus: {} as Record<string, number>,
        bySupplier: {} as Record<string, number>
      };
      
      orders.forEach((o: any) => {
        // count by status
        if (!summary.byStatus[o.status]) {
          summary.byStatus[o.status] = 0;
        }
        summary.byStatus[o.status]++;
        
        // count by supplier
        if (o.supplier_name && !summary.bySupplier[o.supplier_name]) {
          summary.bySupplier[o.supplier_name] = 0;
        }
        if (o.supplier_name) {
          summary.bySupplier[o.supplier_name]++;
        }
      });
      
      return { 
        success: true, 
        orders,
        summary
      };
    } catch (error) {
      console.error('Get purchase order report error:', error);
      return { success: false, message: 'An error occurred while fetching purchase order report' };
    }
  });
  
  // export report to CSV
  ipcMain.handle('reports:exportToCsv', async (_, reportData: any[], filename: string) => {
    try {
      if (!reportData || !reportData.length) {
        return { success: false, message: 'No data to export' };
      }
      
      // get headers from first row
      const headers = Object.keys(reportData[0]);
      
      // create CSV content
      let csvContent = headers.join(',') + '\n';
      
      reportData.forEach(row => {
        const values = headers.map(header => {
          const value = row[header];
          
          // handle special cases
          if (value === null || value === undefined) {
            return '';
          }
          
          if (typeof value === 'string') {
            // escape quotes and wrap in quotes
            return `"${value.replace(/"/g, '""')}"`;
          }
          
          return value;
        });
        
        csvContent += values.join(',') + '\n';
      });
      
      // determine save path
      const downloadsPath = app.getPath('downloads');
      const filePath = path.join(downloadsPath, `${filename}.csv`);
      
      // save file
      fs.writeFileSync(filePath, csvContent, 'utf-8');
      
      return { 
        success: true, 
        message: 'Report exported successfully',
        filePath 
      };
    } catch (error) {
      console.error('Export to CSV error:', error);
      return { success: false, message: 'An error occurred while exporting to CSV' };
    }
  });
  
  // activity log report
  ipcMain.handle('reports:getActivityLogReport', async (_, 
    filters: { 
      startDate?: string, 
      endDate?: string,
      userId?: number,
      action?: string,
      entityType?: string
    }
  ) => {
    try {
      const db = getDatabase();
      
      let query = `
        SELECT al.*, u.username as user
        FROM activity_logs al
        LEFT JOIN users u ON al.user_id = u.id
        WHERE 1=1
      `;
      
      const params: any[] = [];
      
      if (filters.userId) {
        query += ' AND al.user_id = ?';
        params.push(filters.userId);
      }
      
      if (filters.action) {
        query += ' AND al.action = ?';
        params.push(filters.action);
      }
      
      if (filters.entityType) {
        query += ' AND al.entity_type = ?';
        params.push(filters.entityType);
      }
      
      if (filters.startDate) {
        query += ' AND al.created_at >= ?';
        params.push(filters.startDate);
      }
      
      if (filters.endDate) {
        query += ' AND al.created_at <= ?';
        params.push(filters.endDate);
      }
      
      query += ' ORDER BY al.created_at DESC';
      
      const logs = db.prepare(query).all(...params);
      
      // get summary statistics
      const summary = {
        total: logs.length,
        byUser: {} as Record<string, number>,
        byAction: {} as Record<string, number>,
        byEntityType: {} as Record<string, number>
      };
      
      logs.forEach((log: any) => {
        // count by user
        if (log.user && !summary.byUser[log.user]) {
          summary.byUser[log.user] = 0;
        }
        if (log.user) {
          summary.byUser[log.user]++;
        }
        
        // count by action
        if (!summary.byAction[log.action]) {
          summary.byAction[log.action] = 0;
        }
        summary.byAction[log.action]++;
        
        // count by entity type
        if (!summary.byEntityType[log.entity_type]) {
          summary.byEntityType[log.entity_type] = 0;
        }
        summary.byEntityType[log.entity_type]++;
      });
      
      return { 
        success: true, 
        logs,
        summary
      };
    } catch (error) {
      console.error('Get activity log report error:', error);
      return { success: false, message: 'An error occurred while fetching activity log report' };
    }
  });
  
  // user activity report
  ipcMain.handle('reports:getUserActivityReport', async (_, 
    filters: { 
      startDate?: string, 
      endDate?: string,
      userId?: number
    }
  ) => {
    try {
      const db = getDatabase();
      
      // if userId is not provided, get summary for all users
      if (!filters.userId) {
        const userQuery = `
          SELECT u.id, u.username, u.role,
                 COUNT(al.id) as activity_count,
                 MIN(al.created_at) as first_activity,
                 MAX(al.created_at) as last_activity
          FROM users u
          LEFT JOIN activity_logs al ON u.id = al.user_id
          ${filters.startDate ? 'AND al.created_at >= ?' : ''}
          ${filters.endDate ? 'AND al.created_at <= ?' : ''}
          GROUP BY u.id
          ORDER BY activity_count DESC
        `;
        
        const userParams: any[] = [];
        if (filters.startDate) userParams.push(filters.startDate);
        if (filters.endDate) userParams.push(filters.endDate);
        
        const userSummary = db.prepare(userQuery).all(...userParams);
        
        return { 
          success: true, 
          userSummary
        };
      }
      
      // get detailed activity for a specific user
      let query = `
        SELECT al.*, u.username
        FROM activity_logs al
        JOIN users u ON al.user_id = u.id
        WHERE al.user_id = ?
      `;
      
      const params: any[] = [filters.userId];
      
      if (filters.startDate) {
        query += ' AND al.created_at >= ?';
        params.push(filters.startDate);
      }
      
      if (filters.endDate) {
        query += ' AND al.created_at <= ?';
        params.push(filters.endDate);
      }
      
      query += ' ORDER BY al.created_at DESC';
      
      const logs = db.prepare(query).all(...params);
      
      // get user profile
      const user = db.prepare('SELECT id, username, role FROM users WHERE id = ?').get(filters.userId);
      
      // get summary statistics
      const summary = {
        total: logs.length,
        byAction: {} as Record<string, number>,
        byEntityType: {} as Record<string, number>
      };
      
      logs.forEach((log: any) => {
        // count by action
        if (!summary.byAction[log.action]) {
          summary.byAction[log.action] = 0;
        }
        summary.byAction[log.action]++;
        
        // count by entity type
        if (!summary.byEntityType[log.entity_type]) {
          summary.byEntityType[log.entity_type] = 0;
        }
        summary.byEntityType[log.entity_type]++;
      });
      
      return { 
        success: true, 
        user,
        logs,
        summary
      };
    } catch (error) {
      console.error('Get user activity report error:', error);
      return { success: false, message: 'An error occurred while fetching user activity report' };
    }
  });
}