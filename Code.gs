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

/**
 * Serves the main HTML page of the web application.
 */
function doGet() {
  return HtmlService.createTemplateFromFile('Index')
      .evaluate()
      .setTitle('GrantMaster App')
      .setSandboxMode(HtmlService.SandboxMode.IFRAME);
}

/**

 * Includes HTML partials into the main template.
 * @param {string} filename The name of the HTML file to include.
 * @returns {string} The HTML content.
 */
function include(filename) {
  return HtmlService.createTemplateFromFile(filename).evaluate().getContent();
}


// =================================================================
// --- AUTHENTICATION & USER SERVICE ---
// =================================================================

const UserService = {
  /**
   * Gets the active user's email and basic info.
   * @returns {GoogleAppsScript.Base.User} The active user object.
   * @throws {Error} If the user is not accessing the script.
   */
  getActiveUser: function() {
    const user = Session.getActiveUser();
    if (!user || !user.getEmail()) {
      throw new Error("Could not identify the active user. Please ensure you are logged in.");
    }
    Logger.log(`[AUTH] Active user identified: ${user.getEmail()}`);
    return user;
  },

  /**
   * Retrieves or creates a user profile from the 'userProfiles' collection.
   * @param {GoogleAppsScript.Base.User} user The active user object.
   * @returns {object} The user's profile data.
   */
  getUserProfile: function(user) {
    const userEmail = user.getEmail();
    Logger.log(`[AUTH] Getting profile for: ${userEmail}`);
    let profile = DriveService.readFile(COLLECTIONS.USER_PROFILES, userEmail);

    if (profile) {
      Logger.log(`[AUTH] Found existing profile. Role: '${profile.role}'. Data: ${JSON.stringify(profile)}`);
    } else {
      // Create a new profile for a first-time user
      profile = {
        uid: userEmail,
        email: userEmail,
        displayName: user.getUsername().split('@')[0],
        role: 'seeker', // Default role for new users
        createdAt: new Date().toISOString()
      };
      Logger.log(`[AUTH] No profile found. Creating new profile with default 'seeker' role.`);
      DriveService.writeFile(COLLECTIONS.USER_PROFILES, userEmail, profile);
    }
    return profile;
  },

  /**
   * Checks if the current user has the required role.
   * @param {string|Array<string>} requiredRole The role(s) to check for.
   * @throws {Error} If the user is not authorized.
   */
  authorize: function(requiredRole) {
    const user = this.getActiveUser();
    const profile = this.getUserProfile(user);
    const roles = Array.isArray(requiredRole) ? requiredRole : [requiredRole];

    if (!roles.includes(profile.role)) {
      Logger.log(`[AUTH] Authorization FAILED. User role '${profile.role}' is not in required roles '${roles.join(', ')}'.`);
      throw new Error(`Authorization Error: Role '${roles.join(', ')}' is required.`);
    }
    Logger.log(`[AUTH] Authorization SUCCESS. User role '${profile.role}' is valid.`);
  }
};


// =================================================================
// --- DRIVE DATABASE SERVICE ---
// =================================================================

const DriveService = {
  _rootFolder: null,
  _collectionFolders: {},

  /**
   * Gets the root data folder for the application.
   * @returns {GoogleAppsScript.Drive.Folder} The root folder object.
   */
  getRootFolder: function() {
    if (this._rootFolder) return this._rootFolder;
    try {
      this._rootFolder = DriveApp.getFolderById(ROOT_DATA_FOLDER_ID);
      return this._rootFolder;
    } catch (e) {
      throw new Error(`Failed to find root data folder. Check ID: ${ROOT_DATA_FOLDER_ID}`);
    }
  },

  /**
   * Gets or creates a collection folder within the root folder.
   * @param {string} collectionName The name of the collection.
   * @returns {GoogleAppsScript.Drive.Folder} The collection folder object.
   */
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

  /**
   * Reads and parses a JSON file from a collection.
   * @param {string} collectionName The name of the collection.
   * @param {string} docId The ID/filename of the document.
   * @returns {object|null} The parsed JSON object or null if not found.
   */
  readFile: function(collectionName, docId) {
    try {
      const collectionFolder = this.getCollectionFolder(collectionName);
      const files = collectionFolder.getFilesByName(`${docId}.json`);
      if (files.hasNext()) {
        const content = files.next().getBlob().getDataAsString();
        return JSON.parse(content);
      }
      return null;
    } catch (e) {
      Logger.log(`Error reading ${collectionName}/${docId}: ${e.message}`);
      return null;
    }
  },

  /**
   * Writes an object to a JSON file in a collection.
   * @param {string} collectionName The name of the collection.
   * @param {string} docId The ID/filename for the document.
   * @param {object} content The object to serialize and write.
   * @returns {string} The docId.
   */
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

  /**
   * Deletes a file from a collection.
   * @param {string} collectionName The name of the collection.
   * @param {string} docId The ID/filename of the document.
   * @returns {boolean} True if the file was trashed.
   */
  deleteFile: function(collectionName, docId) {
    const collectionFolder = this.getCollectionFolder(collectionName);
    const files = collectionFolder.getFilesByName(`${docId}.json`);
    if (files.hasNext()) {
      files.next().setTrashed(true);
      return true;
    }
    return false;
  },
  
  /**
   * Lists all documents in a collection.
   * @param {string} collectionName The name of the collection.
   * @returns {Array<object>} An array of document objects.
   */
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
      isAuthReady: true,
      loading: false
    };
  } catch (e) {
    Logger.log(`Error in getCurrentUser: ${e.toString()}`);
    return { currentUser: null, userData: null, isAuthReady: true, loading: false };
  }
}

function addDoc(collectionName, data) {
  UserService.authorize(['admin', 'seeker']);
  const user = UserService.getActiveUser();
  const newId = Utilities.getUuid();
  const dataToSave = { ...data, createdAt: new Date().toISOString(), createdBy: user.getEmail() };
  DriveService.writeFile(collectionName, newId, dataToSave);
  return { id: newId, ...dataToSave };
}

function updateDoc(collectionName, docId, data) {
  UserService.authorize('admin');
  const user = UserService.getActiveUser();
  const existingDoc = DriveService.readFile(collectionName, docId);
  if (!existingDoc) throw new Error(`Document ${docId} not found.`);
  const dataToUpdate = { ...existingDoc, ...data, updatedAt: new Date().toISOString(), updatedBy: user.getEmail() };
  DriveService.writeFile(collectionName, docId, dataToUpdate);
  return true;
}

function deleteDoc(collectionName, docId) {
    UserService.authorize('admin');
    return DriveService.deleteFile(collectionName, docId);
}

function getDoc(collectionName, docId) {
  UserService.authorize(['admin', 'seeker']);
  return DriveService.readFile(collectionName, docId);
}

function queryCollection(collectionName, filters = [], orderBy = []) {
  UserService.authorize(['admin', 'seeker']);
  let docs = DriveService.listCollection(collectionName);
  filters.forEach(filter => {
    docs = docs.filter(doc => {
      const docValue = doc[filter.field];
      switch (filter.operator) {
        case '==': return docValue === filter.value;
        case 'array-contains': return Array.isArray(docValue) && docValue.includes(filter.value);
        case 'in': return Array.isArray(filter.value) && filter.value.includes(docValue);
        default: return false;
      }
    });
  });

  // ... (keep getCurrentUser, addDoc, updateDoc, deleteDoc, getDoc, queryCollection functions)

/**
 * Gets all user profiles. ADMIN ONLY.
 */
function getAllUserProfiles() {
  UserService.authorize('admin');
  // NOTE: This uses the Drive-based user profile system.
  // This is acceptable as the number of users is likely to be small.
  return DriveService.listCollection(COLLECTIONS.USER_PROFILES);
}

  orderBy.forEach(sortRule => {
    docs.sort((a, b) => {
      if (a[sortRule.field] < b[sortRule.field]) return sortRule.direction === 'asc' ? -1 : 1;
      if (a[sortRule.field] > b[sortRule.field]) return sortRule.direction === 'asc' ? 1 : -1;
      return 0;
    });
  });
  return docs;
}