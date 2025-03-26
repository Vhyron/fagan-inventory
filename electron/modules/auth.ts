import { getDatabase } from '../db/database';
import { ipcMain } from 'electron';
import { createHash } from 'crypto';

export interface User {
  id: number;
  username: string;
  role: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

// hash password using SHA-256
function hashPassword(password: string): string {
  return createHash('sha256').update(password).digest('hex');
}

// initialize authentication IPC handlers
export function initAuthHandlers() {
  // login handler
  ipcMain.handle('auth:login', async (_, username: string, password: string) => {
    try {
      const db = getDatabase();
      const hashedPassword = hashPassword(password);
      
      const user = db.prepare(`
        SELECT id, username, role, is_active, created_at, updated_at
        FROM users
        WHERE username = ? AND password = ? AND is_active = 1
      `).get(username, hashedPassword) as User | undefined;
      
      if (!user) {
        return { success: false, message: 'Invalid credentials or account is inactive' };
      }
      
      // log successful login
      db.prepare(`
        INSERT INTO activity_logs (user_id, action, entity_type, entity_id, details)
        VALUES (?, ?, ?, ?, ?)
      `).run(user.id, 'login', 'user', user.id, 'User logged in');
      
      return {
        success: true,
        user: {
          id: user.id,
          username: user.username,
          role: user.role,
        }
      };
    } catch (error) {
      console.error('Login error:', error);
      return { success: false, message: 'An error occurred during login' };
    }
  });
  
  // change password handler
  ipcMain.handle('auth:changePassword', async (_, userId: number, currentPassword: string, newPassword: string) => {
    try {
      const db = getDatabase();
      const hashedCurrentPassword = hashPassword(currentPassword);
      
      // verify current password
      const user = db.prepare(`
        SELECT id FROM users
        WHERE id = ? AND password = ?
      `).get(userId, hashedCurrentPassword);
      
      if (!user) {
        return { success: false, message: 'Current password is incorrect' };
      }
      
      // update password
      const hashedNewPassword = hashPassword(newPassword);
      db.prepare(`
        UPDATE users
        SET password = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(hashedNewPassword, userId);
      
      // log password change
      db.prepare(`
        INSERT INTO activity_logs (user_id, action, entity_type, entity_id, details)
        VALUES (?, ?, ?, ?, ?)
      `).run(userId, 'update', 'user', userId, 'Password changed');
      
      return { success: true, message: 'Password updated successfully' };
    } catch (error) {
      console.error('Change password error:', error);
      return { success: false, message: 'An error occurred while changing password' };
    }
  });
  
  // get user profile handler
  ipcMain.handle('auth:getUserProfile', async (_, userId: number) => {
    try {
      const db = getDatabase();
      
      const user = db.prepare(`
        SELECT id, username, role, is_active, created_at, updated_at
        FROM users
        WHERE id = ?
      `).get(userId) as User | undefined;
      
      if (!user) {
        return { success: false, message: 'User not found' };
      }
      
      return {
        success: true,
        user: {
          id: user.id,
          username: user.username,
          role: user.role,
          created_at: user.created_at,
          updated_at: user.updated_at
        }
      };
    } catch (error) {
      console.error('Get user profile error:', error);
      return { success: false, message: 'An error occurred while fetching user profile' };
    }
  });
}