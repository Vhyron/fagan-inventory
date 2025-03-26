import { ipcRenderer, contextBridge } from 'electron'

// define a more comprehensive API
const electronAPI = {
  // casic IPC communication
  on: (channel: string, callback: Function) => {
    const subscription = (_event: Electron.IpcRendererEvent, ...args: any[]) => 
      callback(...args);
    ipcRenderer.on(channel, subscription);
    
    return () => {
      ipcRenderer.removeListener(channel, subscription);
    };
  },
  
  invoke: (channel: string, ...args: any[]) => {
    return ipcRenderer.invoke(channel, ...args);
  },
  
  // authentication
  auth: {
    login: (username: string, password: string) => 
      ipcRenderer.invoke('auth:login', username, password),
    
    changePassword: (userId: number, currentPassword: string, newPassword: string) => 
      ipcRenderer.invoke('auth:changePassword', userId, currentPassword, newPassword),
    
    getUserProfile: (userId: number) => 
      ipcRenderer.invoke('auth:getUserProfile', userId),
  },
  
  // user Management
  users: {
    getSecretaries: (adminId: number) => 
      ipcRenderer.invoke('users:getSecretaries', adminId),
    
    createSecretary: (adminId: number, userData: any) => 
      ipcRenderer.invoke('users:createSecretary', adminId, userData),
    
    updateSecretary: (adminId: number, secretaryId: number, isActive: boolean) => 
      ipcRenderer.invoke('users:updateSecretary', adminId, secretaryId, isActive),
    
    resetSecretaryPassword: (adminId: number, secretaryId: number, newPassword: string) => 
      ipcRenderer.invoke('users:resetSecretaryPassword', adminId, secretaryId, newPassword),
  },
  
  // stock Management
  stock: {
    // categories
    getCategories: () => 
      ipcRenderer.invoke('stock:getCategories'),
    
    createCategory: (userId: number, category: any) => 
      ipcRenderer.invoke('stock:createCategory', userId, category),
    
    updateCategory: (userId: number, categoryId: number, category: any) => 
      ipcRenderer.invoke('stock:updateCategory', userId, categoryId, category),
    
    deleteCategory: (userId: number, categoryId: number) => 
      ipcRenderer.invoke('stock:deleteCategory', userId, categoryId),
    
    // stock Items
    getItems: (filters?: any) => 
      ipcRenderer.invoke('stock:getItems', filters),
    
    getItemById: (itemId: number) => 
      ipcRenderer.invoke('stock:getItemById', itemId),
    
    createItem: (userId: number, item: any) => 
      ipcRenderer.invoke('stock:createItem', userId, item),
    
    updateItem: (userId: number, itemId: number, item: any) => 
      ipcRenderer.invoke('stock:updateItem', userId, itemId, item),
    
    updateQuantity: (userId: number, itemId: number, newQuantity: number, reason: string) => 
      ipcRenderer.invoke('stock:updateQuantity', userId, itemId, newQuantity, reason),
    
    getLowStockItems: () => 
      ipcRenderer.invoke('stock:getLowStockItems'),
  },
  
  // supply Management
  supply: {
    // suppliers
    getSuppliers: (search?: string) => 
      ipcRenderer.invoke('supply:getSuppliers', search),
    
    getSupplierById: (supplierId: number) => 
      ipcRenderer.invoke('supply:getSupplierById', supplierId),
    
    createSupplier: (userId: number, supplier: any) => 
      ipcRenderer.invoke('supply:createSupplier', userId, supplier),
    
    updateSupplier: (userId: number, supplierId: number, supplier: any) => 
      ipcRenderer.invoke('supply:updateSupplier', userId, supplierId, supplier),
    
    // purchase Orders
    getPurchaseOrders: (filters?: any) => 
      ipcRenderer.invoke('supply:getPurchaseOrders', filters),
    
    getPurchaseOrderById: (orderId: number) => 
      ipcRenderer.invoke('supply:getPurchaseOrderById', orderId),
    
    generateOrderNumber: () => 
      ipcRenderer.invoke('supply:generateOrderNumber'),
    
    createPurchaseOrder: (userId: number, order: any, items: any[]) => 
      ipcRenderer.invoke('supply:createPurchaseOrder', userId, order, items),
    
    updateOrderStatus: (userId: number, orderId: number, status: string, updateStock: boolean) => 
      ipcRenderer.invoke('supply:updateOrderStatus', userId, orderId, status, updateStock),
  },
  
  // transaction Management
  transaction: {
    getTransactions: (filters?: any) => 
      ipcRenderer.invoke('transaction:getTransactions', filters),
    
    getTransactionById: (transactionId: number) => 
      ipcRenderer.invoke('transaction:getTransactionById', transactionId),
    
    generateReferenceNumber: (type: string) => 
      ipcRenderer.invoke('transaction:generateReferenceNumber', type),
    
    createTransaction: (userId: number, transaction: any, items: any[]) => 
      ipcRenderer.invoke('transaction:createTransaction', userId, transaction, items),
    
    updateStatus: (userId: number, transactionId: number, status: string, updateStock: boolean) => 
      ipcRenderer.invoke('transaction:updateStatus', userId, transactionId, status, updateStock),
  },
  
  // reports
  reports: {
    getDashboardSummary: () => 
      ipcRenderer.invoke('reports:getDashboardSummary'),
    
    getStockLevelReport: () => 
      ipcRenderer.invoke('reports:getStockLevelReport'),
    
    getStockMovementReport: (filters: any) => 
      ipcRenderer.invoke('reports:getStockMovementReport', filters),
    
    getTransactionReport: (filters: any) => 
      ipcRenderer.invoke('reports:getTransactionReport', filters),
    
    getPurchaseOrderReport: (filters: any) => 
      ipcRenderer.invoke('reports:getPurchaseOrderReport', filters),
    
    getActivityLogReport: (filters: any) => 
      ipcRenderer.invoke('reports:getActivityLogReport', filters),
    
    getUserActivityReport: (filters: any) => 
      ipcRenderer.invoke('reports:getUserActivityReport', filters),
    
    exportToCsv: (reportData: any[], filename: string) => 
      ipcRenderer.invoke('reports:exportToCsv', reportData, filename),
  }
};

// expose protected API to the renderer process
contextBridge.exposeInMainWorld('electronAPI', electronAPI);

// for backwards compatibility
contextBridge.exposeInMainWorld('ipcRenderer', {
  on(...args: Parameters<typeof ipcRenderer.on>) {
    const [channel, listener] = args
    return ipcRenderer.on(channel, (event, ...args) => listener(event, ...args))
  },
  off(...args: Parameters<typeof ipcRenderer.off>) {
    const [channel, ...omit] = args
    return ipcRenderer.off(channel, ...omit)
  },
  send(...args: Parameters<typeof ipcRenderer.send>) {
    const [channel, ...omit] = args
    return ipcRenderer.send(channel, ...omit)
  },
  invoke(...args: Parameters<typeof ipcRenderer.invoke>) {
    const [channel, ...omit] = args
    return ipcRenderer.invoke(channel, ...omit)
  },
})

// log when preload script is loaded
console.log('Preload script loaded successfully');