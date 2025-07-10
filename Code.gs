// =================================================================
// --- CONFIGURATION ---
// =================================================================

// ID of the Google Sheet to use as a database
const DATABASE_SHEET_ID = '1Z3Bob6FK8jhU3m-bmy6AEF51YLzgw5yWGkumd1OilKc/edit?gid=0#gid=0'; 

const COLLECTIONS = {
  GRANT_PROGRAMS: 'grantPrograms',
  // You would add other sheet names here, like 'applications', etc.
};


// =================================================================
// --- WEB APP & HTML SERVICE ---
// =================================================================
function doGet() {
  return HtmlService.createTemplateFromFile('Index')
      .evaluate()
      .setTitle('GrantMaster App')
      .setSandboxMode(HtmlService.SandboxMode.IFRAME);
}

function include(filename) {
  return HtmlService.createTemplateFromFile(filename).evaluate().getContent();
}


// =================================================================
// --- AUTHENTICATION & USER SERVICE ---
// (No changes from the previous version)
// =================================================================
const UserService = {
  getActiveUser: function() { /* ... */ },
  getUserProfile: function(user) { /* ... */ }, // Note: This still uses DriveService
  authorize: function(requiredRole) { /* ... */ }
};


// =================================================================
// --- SHEET DATABASE SERVICE ---
// This service replaces most of the DriveService functionality for structured data.
// =================================================================
const SheetService = {
  _spreadsheet: null,

  getSpreadsheet: function() {
    if (this._spreadsheet) return this._spreadsheet;
    if (DATABASE_SHEET_ID === 'YOUR_GOOGLE_SHEET_ID_HERE') {
      throw new Error("DATABASE_SHEET_ID is not configured in Code.gs");
    }
    try {
      this._spreadsheet = SpreadsheetApp.openById(DATABASE_SHEET_ID);
      return this._spreadsheet;
    } catch (e) {
      throw new Error("Could not open the Google Sheet. Check the ID and permissions.");
    }
  },
  
  getSheet: function(sheetName) {
    const ss = this.getSpreadsheet();
    const sheet = ss.getSheetByName(sheetName);
    if (!sheet) throw new Error(`Sheet "${sheetName}" not found in the database.`);
    return sheet;
  },
  
  // Converts a sheet's data to an array of objects
  sheetToObjects: function(sheet) {
    const data = sheet.getDataRange().getValues();
    const headers = data.shift();
    return data.map(row => {
      const obj = {};
      headers.forEach((header, i) => obj[header] = row[i]);
      return obj;
    });
  },

  // Appends a new record object to a sheet
  appendObject: function(sheetName, obj) {
    const sheet = this.getSheet(sheetName);
    const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    const row = headers.map(header => obj[header] || "");
    sheet.appendRow(row);
    return obj;
  },

  // Updates an existing record
  updateObject: function(sheetName, id, updatedObject) {
    const sheet = this.getSheet(sheetName);
    const data = sheet.getDataRange().getValues();
    const headers = data.shift();
    const idColumnIndex = headers.indexOf('id');
    if (idColumnIndex === -1) throw new Error("No 'id' column found.");

    const rowIndex = data.findIndex(row => row[idColumnIndex] === id);
    if (rowIndex === -1) throw new Error(`Record with id ${id} not found.`);
    
    const rowToUpdate = headers.map(header => updatedObject[header] || "");
    sheet.getRange(rowIndex + 2, 1, 1, headers.length).setValues([rowToUpdate]);
    return updatedObject;
  },

  // Finds a single object by its ID
  findObjectById: function(sheetName, id) {
    const sheet = this.getSheet(sheetName);
    const data = this.sheetToObjects(sheet);
    return data.find(item => item.id === id) || null;
  }
};


// =================================================================
// --- API ENDPOINTS (Now using SheetService) ---
// =================================================================
function getCurrentUser() { /* ... no change ... */ }

function addDoc(collectionName, data) {
  UserService.authorize(['admin', 'seeker']);
  const user = UserService.getActiveUser();
  
  const dataToSave = { ...data };
  dataToSave.id = Utilities.getUuid(); // Generate ID for the sheet
  dataToSave.createdAt = new Date().toISOString();
  dataToSave.createdBy = user.getEmail();
  
  return SheetService.appendObject(collectionName, dataToSave);
}

function updateDoc(collectionName, docId, data) {
  UserService.authorize('admin');
  const user = UserService.getActiveUser();

  const dataToUpdate = { ...data };
  dataToUpdate.updatedAt = new Date().toISOString();
  dataToUpdate.updatedBy = user.getEmail();

  return SheetService.updateObject(collectionName, docId, dataToUpdate);
}

function getDoc(collectionName, docId) {
  UserService.authorize(['admin', 'seeker']);
  return SheetService.findObjectById(collectionName, docId);
}

function queryCollection(collectionName, filters = [], orderBy = []) {
  UserService.authorize(['admin', 'seeker']);
  const sheet = SheetService.getSheet(collectionName);
  let docs = SheetService.sheetToObjects(sheet);

  // Filtering and sorting logic remains the same for now, but operates on
  // the data from the sheet, which is loaded much more quickly.
  filters.forEach(filter => { /* ... */ });
  orderBy.forEach(sortRule => { /* ... */ });

  return docs;
}