import { getDatabase } from '../db/database';
import { ipcMain } from 'electron';
import { createHash } from 'crypto';

interface SecretaryUser {
  username: string;
  password: string;
  is_active: boolean;
}

// hash password using SHA-256
function hashPassword(password: string): string {
  return createHash('sha256').update(password).digest('hex');
}

// initialize user management IPC handlers
export function initUserHandlers() {
  // get secretary accounts (admin only)
  ipcMain.handle('users:getSecretaries', async (_, adminId: number) => {
    try {
      const db = getDatabase();
      
      // verify the user is an admin
      const adminCheck = db.prepare('SELECT role FROM users WHERE id = ? AND role = ?').get(adminId, 'admin');
      
      if (!adminCheck) {
        return { success: false, message: 'Unauthorized access' };
      }
      
      const secretaries = db.prepare(`
        SELECT id, username, is_active, created_at, updated_at
        FROM users
        WHERE role = 'secretary'
        ORDER BY username
      `).all();
      
      return { success: true, secretaries };
    } catch (error) {
      console.error('Get secretaries error:', error);
      return { success: false, message: 'An error occurred while fetching secretary accounts' };
    }
  });
  
  // create secretary account (admin only)
  ipcMain.handle('users:createSecretary', async (_, adminId: number, userData: SecretaryUser) => {
    try {
      const db = getDatabase();
      
      // verify the user is an admin
      const adminCheck = db.prepare('SELECT role FROM users WHERE id = ? AND role = ?').get(adminId, 'admin');
      
      if (!adminCheck) {
        return { success: false, message: 'Unauthorized access' };
      }
      
      // check if username already exists
      const existingUser = db.prepare('SELECT id FROM users WHERE username = ?').get(userData.username);
      
      if (existingUser) {
        return { success: false, message: 'Username already exists' };
      }
      
      const hashedPassword = hashPassword(userData.password);
      
      const result = db.prepare(`
        INSERT INTO users (username, password, role, is_active)
        VALUES (?, ?, 'secretary', ?)
      `).run(userData.username, hashedPassword, userData.is_active ? 1 : 0);
      
      // Log activity
      db.prepare(`
        INSERT INTO activity_logs (user_id, action, entity_type, entity_id, details)
        VALUES (?, ?, ?, ?, ?)
      `).run(adminId, 'create', 'user', result.lastInsertRowid, 'Created secretary account');
      
      return { 
        success: true, 
        message: 'Secretary account created successfully',
        userId: result.lastInsertRowid
      };
    } catch (error) {
      console.error('Create secretary error:', error);
      return { success: false, message: 'An error occurred while creating secretary account' };
    }
  });
  
  // update secretary account (admin only)
  ipcMain.handle('users:updateSecretary', async (_, adminId: number, secretaryId: number, isActive: boolean) => {
    try {
      const db = getDatabase();
      
         // verify the user is an admin
      const adminCheck = db.prepare('SELECT role FROM users WHERE id = ? AND role = ?').get(adminId, 'admin');
      
      if (!adminCheck) {
        return { success: false, message: 'Unauthorized access' };
      }
      
      // check if secretary exists
      const secretary = db.prepare('SELECT id FROM users WHERE id = ? AND role = ?').get(secretaryId, 'secretary');
      
      if (!secretary) {
        return { success: false, message: 'Secretary account not found' };
      }
      
      db.prepare(`
        UPDATE users
        SET is_active = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(isActive ? 1 : 0, secretaryId);
      
      // log activity
      db.prepare(`
        INSERT INTO activity_logs (user_id, action, entity_type, entity_id, details)
        VALUES (?, ?, ?, ?, ?)
      `).run(adminId, 'update', 'user', secretaryId, `${isActive ? 'Activated' : 'Deactivated'} secretary account`);
      
      return { 
        success: true, 
        message: `Secretary account ${isActive ? 'activated' : 'deactivated'} successfully` 
      };
    } catch (error) {
      console.error('Update secretary error:', error);
      return { success: false, message: 'An error occurred while updating secretary account' };
    }
  });
  
  // reset secretary password (admin only)
  ipcMain.handle('users:resetSecretaryPassword', async (_, adminId: number, secretaryId: number, newPassword: string) => {
    try {
      const db = getDatabase();
      
      // verify the user is an admin
      const adminCheck = db.prepare('SELECT role FROM users WHERE id = ? AND role = ?').get(adminId, 'admin');
      
      if (!adminCheck) {
        return { success: false, message: 'Unauthorized access' };
      }
      
      // check if secretary exists
      const secretary = db.prepare('SELECT id FROM users WHERE id = ? AND role = ?').get(secretaryId, 'secretary');
      
      if (!secretary) {
        return { success: false, message: 'Secretary account not found' };
      }
      
      const hashedPassword = hashPassword(newPassword);
      
      db.prepare(`
        UPDATE users
        SET password = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(hashedPassword, secretaryId);
      
      // log activity
      db.prepare(`
        INSERT INTO activity_logs (user_id, action, entity_type, entity_id, details)
        VALUES (?, ?, ?, ?, ?)
      `).run(adminId, 'update', 'user', secretaryId, 'Reset secretary password');
      
      return { success: true, message: 'Secretary password reset successfully' };
    } catch (error) {
      console.error('Reset secretary password error:', error);
      return { success: false, message: 'An error occurred while resetting secretary password' };
    }
  });
}