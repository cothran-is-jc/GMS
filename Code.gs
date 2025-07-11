// =================================================================
// --- CONFIGURATION ---
// =================================================================

// IMPORTANT: Ensure this is the ID of your Google Drive folder.
const ROOT_DATA_FOLDER_ID = '1uVfYrTuoSJ3ZKmclC_6xl7qZTdo1nICx';

const COLLECTIONS = {
  GRANT_PROGRAMS: 'grantPrograms',
  APPLICATIONS: 'applications',
  REVIEWS: 'reviews',
  USER_PROFILES: 'userProfiles',
  ATTACHMENTS: 'attachments'
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
// =================================================================

const UserService = {
  getActiveUser: function() {
    const user = Session.getActiveUser();
    if (!user || !user.getEmail()) {
      throw new Error("Could not identify the active user. Please ensure you are logged in.");
    }
    return user;
  },

  getUserProfile: function(user) {
    const userEmail = user.getEmail();
    let profile = DriveService.readFile(COLLECTIONS.USER_PROFILES, userEmail);

    if (!profile) {
      profile = {
        uid: userEmail,
        email: userEmail,
        displayName: user.getUsername().split('@')[0],
        role: 'seeker',
        createdAt: new Date().toISOString()
      };
      DriveService.writeFile(COLLECTIONS.USER_PROFILES, userEmail, profile);
    }
    return profile;
  },

  authorize: function(requiredRole) {
    const user = this.getActiveUser();
    const profile = this.getUserProfile(user);
    const roles = Array.isArray(requiredRole) ? requiredRole : [requiredRole];

    if (!roles.includes(profile.role)) {
      throw new Error(`Authorization Error: Role '${roles.join(', ')}' is required.`);
    }
  }
};


// =================================================================
// --- DRIVE DATABASE SERVICE ---
// =================================================================

const DriveService = {
  _rootFolder: null,
  _collectionFolders: {},

  getRootFolder: function() {
    if (this._rootFolder) return this._rootFolder;
    try {
      this._rootFolder = DriveApp.getFolderById(ROOT_DATA_FOLDER_ID);
      return this._rootFolder;
    } catch (e) {
      throw new Error(`Failed to find root data folder. Check ID: ${ROOT_DATA_FOLDER_ID}`);
    }
  },

  getCollectionFolder: function(collectionName) {
    if (this._collectionFolders[collectionName]) {
      return this._collectionFolders[collectionName];
    }
    const root = this.getRootFolder();
    const lock = LockService.getScriptLock();
    lock.waitLock(30000);
    try {
      const folders = root.getFoldersByName(collectionName);
      if (folders.hasNext()) {
        this._collectionFolders[collectionName] = folders.next();
      } else {
        this._collectionFolders[collectionName] = root.createFolder(collectionName);
      }
      return this._collectionFolders[collectionName];
    } finally {
      lock.releaseLock();
    }
  },

  readFile: function(collectionName, docId) {
    try {
      const collectionFolder = this.getCollectionFolder(collectionName);
      const files = collectionFolder.getFilesByName(`${docId}.json`);
      if (files.hasNext()) {
        const content = files.next().getBlob().getDataAsString();
        const doc = JSON.parse(content);
        // This is the corrected line that adds the ID
        doc.id = docId; 
        return doc;
      }
      return null;
    } catch (e) {
      console.error(`Failed to read file ${docId}.json in ${collectionName}:`, e);
      return null;
    }
  },

  writeFile: function(collectionName, docId, content) {
    const collectionFolder = this.getCollectionFolder(collectionName);
    const fileName = `${docId}.json`;
    const jsonString = JSON.stringify(content, null, 2);
    
    const files = collectionFolder.getFilesByName(fileName);
    if (files.hasNext()) {
      files.next().setContent(jsonString);
    } else {
      collectionFolder.createFile(fileName, jsonString, 'application/json');
    }
    return docId;
  },
  
  listCollection: function(collectionName) {
    const collectionFolder = this.getCollectionFolder(collectionName);
    const files = collectionFolder.getFilesByType('application/json');
    const docs = [];
    while(files.hasNext()) {
      const file = files.next();
      try {
        const doc = JSON.parse(file.getBlob().getDataAsString());
        doc.id = file.getName().replace('.json', '');
        docs.push(doc);
      } catch(e) { /* ignore malformed json */ }
    }
    return docs;
  }
};


// =================================================================
// --- API ENDPOINTS (Exposed to Client) ---
// =================================================================

function getCurrentUser() {
  try {
    const user = UserService.getActiveUser();
    const profile = UserService.getUserProfile(user);
    return {
      currentUser: { email: user.getEmail(), displayName: profile.displayName },
      userData: profile,
    };
  } catch (e) {
    return { currentUser: null, userData: null };
  }
}

function queryCollection(collectionName, filters = [], orderBy = []) {
  UserService.authorize(['admin', 'seeker']);
  let docs = DriveService.listCollection(collectionName);
  // Filtering and sorting logic can be added here
  return docs;
}

/**
 * Retrieves a single record by its ID from a collection.
 * @param {string} collectionName The name of the collection (e.g., 'grantPrograms').
 * @param {string} docId The unique identifier for the record.
 * @returns {Object} The found record or null.
 */
function getRecordById(collectionName, docId) {
  UserService.authorize(['admin', 'seeker']); // Authorize user access
  const doc = DriveService.readFile(collectionName, docId);
  if (!doc) {
    // Optionally, throw an error if the document is not found to provide clearer
    // feedback to the client-side error handler.
    throw new Error(`Document with ID '${docId}' not found in collection '${collectionName}'.`);
  }
  return doc;
}

function getAllUserProfiles() {
  UserService.authorize('admin');
  return DriveService.listCollection(COLLECTIONS.USER_PROFILES);
}

/**
 * Updates a user's role. ADMIN ONLY.
 * @param {string} userEmail The email of the user to update.
 * @param {string} newRole The new role to assign ('admin' or 'seeker').
 * @returns {boolean} True if the update was successful.
 */
function updateUserRole(userEmail, newRole) {
  UserService.authorize('admin'); // Only admins can change roles

  if (newRole !== 'admin' && newRole !== 'seeker') {
    throw new Error("Invalid role specified. Must be 'admin' or 'seeker'.");
  }

  const profile = DriveService.readFile(COLLECTIONS.USER_PROFILES, userEmail);
  if (!profile) {
    throw new Error(`User profile for ${userEmail} not found.`);
  }

  // Prevent admin from accidentally removing their own admin status
  const currentUser = Session.getActiveUser().getEmail();
  if (currentUser === userEmail && newRole !== 'admin') {
      throw new Error("Admins cannot remove their own admin role.");
  }

  profile.role = newRole;
  profile.updatedAt = new Date().toISOString();
  profile.updatedBy = currentUser;

  DriveService.writeFile(COLLECTIONS.USER_PROFILES, userEmail, profile);
  return true;
}

/**
 * Creates a new document in a collection with a unique ID.
 * @param {string} collectionName The name of the collection (e.g., 'grantPrograms').
 * @param {Object} record The data to save.
 * @returns {Object} The saved record, including its new ID.
 */
function createRecord(collectionName, record) {
  UserService.authorize(['admin']); // Only admins can create programs
  
  // Generate a unique ID for the new record
  const docId = Utilities.getUuid();
  record.id = docId;
  record.createdAt = new Date().toISOString();
  record.createdBy = Session.getActiveUser().getEmail();

  DriveService.writeFile(collectionName, docId, record);
  return record;
}

/**
 * Updates an existing document in a collection.
 * @param {string} collectionName The name of the collection (e.g., 'grantPrograms').
 * @param {Object} record The record data to update, must include an 'id'.
 * @returns {Object} The updated record.
 */
function updateRecord(collectionName, record) {
  UserService.authorize(['admin']); // Only admins can update programs

  if (!record || !record.id) {
    throw new Error("Cannot update: record data and ID are required.");
  }
  
  // The readFile function will throw an error if the doc doesn't exist
  const existingDoc = DriveService.readFile(collectionName, record.id);

  // Preserve original creation data
  record.createdAt = existingDoc.createdAt;
  record.createdBy = existingDoc.createdBy;
  
  // Add update metadata
  record.updatedAt = new Date().toISOString();
  record.updatedBy = Session.getActiveUser().getEmail();

  DriveService.writeFile(collectionName, record.id, record);
  return record;
}

// =================================================================
// --- GRANTS.GOV INTEGRATION ---
// =================================================================

/**
 * Searches the public grants.gov API for funding opportunities.
 * @param {string} keyword The search term.
 * @returns {Array<Object>} A list of grant opportunities.
 */
function searchGrantsGov(keyword) {
  // This endpoint does not require an API key
  const endpoint = 'https://api.grants.gov/v1/api/search2';
  
  const payload = JSON.stringify({
    "keyword": keyword
  });

  const options = {
    'method': 'post',
    'contentType': 'application/json',
    'payload': payload
  };
  
  try {
    const response = UrlFetchApp.fetch(endpoint, options);
    const data = JSON.parse(response.getContentText());
    // The opportunities are in the 'opps' array of the response
    return data.opps || [];
  } catch (e) {
    console.error("Error fetching from Grants.gov API: " + e);
    return []; // Return an empty array on error
  }
}

/**
 * Fetches the full details of a single opportunity from Grants.gov.
 * @param {string} opportunityId The ID of the grant to fetch.
 * @returns {Object} The detailed grant data.
 */
function fetchGrantsGovOpportunity(opportunityId) {
  // This endpoint also does not require an API key
  const endpoint = 'https://api.grants.gov/v1/api/fetchOpportunity';
  
  const payload = JSON.stringify({
    "opportunityId": opportunityId
  });

  const options = {
    'method': 'post',
    'contentType': 'application/json',
    'payload': payload
  };
  
  try {
    const response = UrlFetchApp.fetch(endpoint, options);
    return JSON.parse(response.getContentText());
  } catch (e) {
    console.error(`Error fetching opportunity ${opportunityId}:`, e);
    throw new Error("Could not retrieve grant details from Grants.gov.");
  }
}

/**
 * Imports a grant from Grants.gov and saves it to the local system.
 * @param {string} opportunityId The ID of the grant to import.
 * @returns {Object} The newly created record.
 */
function importGrantFromGov(opportunityId) {
  UserService.authorize(['admin']); // Ensure only admins can import

  const grantDetails = fetchGrantsGovOpportunity(opportunityId);

  // Reformat the data to match your application's data structure
  const newRecord = {
    title: grantDetails.synopsis.opportunityTitle,
    description: grantDetails.synopsis.synopsisDesc,
    // You can add more fields here as needed
    source: 'Grants.gov',
    sourceId: opportunityId
  };
  
  // Use your existing createRecord function to save it
  return createRecord(COLLECTIONS.GRANT_PROGRAMS, newRecord);
}