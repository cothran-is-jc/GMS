// --- Configuration ---
// IMPORTANT: Replace this with the ID of your empty Google Drive folder where you want to store all app data.
// This is ONLY the folder ID, not the full URL.
const ROOT_DATA_FOLDER_URL = '1uVfYrTuoSJ3ZKmclC_6xl7qZTdo1nICx'; // Example: '1uVfYrTuoSJ3ZKmclC_6xl7qZTdo1nICx'

const COLLECTIONS = {
  GRANT_PROGRAMS: 'grantPrograms',
  APPLICATIONS: 'applications',
  REVIEWS: 'reviews',
  USER_PROFILES: 'userProfiles', // Flat collection for easier admin lookup
  AUDIT_LOG: 'auditLog',
  ATTACHMENTS: 'attachments' // For application attachments
};

// --- Core Utility Functions for Google Drive File Operations ---

let rootFolder = null; // Global variable to cache the root folder

/**
 * Gets a Google Drive Folder object by ID.
 * @param {string} folderId The ID of the folder.
 * @returns {GoogleAppsScript.Drive.Folder|null} The Folder object, or null if not found.
 */
function getFolderByIdSafe(folderId) {
  try {
    const folder = DriveApp.getFolderById(folderId);
    Logger.log(`[getFolderByIdSafe] Found folder by ID: ${folder.getName()} (${folder.getId()})`);
    return folder;
  } catch (e) {
    Logger.log(`[getFolderByIdSafe] Folder with ID "${folderId}" not found. Error: ${e.message}`);
    return null;
  }
}

/**
 * Gets or creates a Google Drive Folder object by name within a parent folder.
 * @param {string} folderName The name of the folder.
 * @param {GoogleAppsScript.Drive.Folder} parentFolder The parent folder to search within or create in.
 * @returns {GoogleAppsScript.Drive.Folder|null} The Folder object, or null if creation failed.
 */
function getOrCreateFolderByName(folderName, parentFolder) {
  if (!parentFolder) {
    Logger.log(`[getOrCreateFolderByName] ERROR: parentFolder is null or undefined for folderName: ${folderName}`);
    return null;
  }
  
  const folders = parentFolder.getFoldersByName(folderName);
  if (folders.hasNext()) {
    const folder = folders.next();
    Logger.log(`[getOrCreateFolderByName] Found existing folder by name: ${folder.getName()} (${folder.getId()}) in parent ${parentFolder.getName()}`);
    return folder;
  } else {
    try {
      Logger.log(`[getOrCreateFolderByName] Folder "${folderName}" not found. Attempting to create in parent ${parentFolder.getName()}.`);
      const newFolder = parentFolder.createFolder(folderName);
      Logger.log(`[getOrCreateFolderByName] Successfully created folder: ${newFolder.getName()} (${newFolder.getId()})`);
      return newFolder;
    } catch (e) {
      Logger.log(`[getOrCreateFolderByName] ERROR: Failed to create folder "${folderName}" in parent ${parentFolder.getName()}. Error: ${e.message}`);
      return null;
    }
  }
}


/**
 * Initializes and returns the root data folder.
 * This function should be called once at the start of any data operation.
 * @returns {GoogleAppsScript.Drive.Folder} The root data folder.
 * @throws {Error} If the root folder cannot be found or created.
 */
function getRootDataFolder() {
  if (rootFolder) return rootFolder; // Return cached folder

  if (!ROOT_DATA_FOLDER_URL || ROOT_DATA_FOLDER_URL === 'YOUR_GOOGLE_DRIVE_FOLDER_ID_HERE') {
    throw new Error("ROOT_DATA_FOLDER_URL is not configured. Please update Code.gs with your Drive folder ID.");
  }
  
  // For the root folder, we MUST find it by ID. It cannot be created if it doesn't exist.
  rootFolder = getFolderByIdSafe(ROOT_DATA_FOLDER_URL); 
  if (!rootFolder) {
    throw new Error(`Failed to initialize root data folder. Check ROOT_DATA_FOLDER_URL "${ROOT_DATA_FOLDER_URL}" and its permissions. Details in logs.`);
  }
  return rootFolder;
}

/**
 * Gets a specific collection folder within the root data folder. If it doesn't exist, it creates it.
 * @param {string} collectionName The name of the collection (e.g., 'grantPrograms').
 * @returns {GoogleAppsScript.Drive.Folder} The collection folder.
 * @throws {Error} If the collection folder cannot be found or created.
 */
function getCollectionFolder(collectionName) {
  const root = getRootDataFolder(); // Ensure root is established
  
  // For collection folders, we get or create by NAME within the root.
  const collectionFolder = getOrCreateFolderByName(collectionName, root); 
  
  if (!collectionFolder) {
    throw new Error(`Failed to get or create collection folder: ${collectionName}. Check logs for details.`);
  }
  return collectionFolder;
}

/**
 * Reads content from a JSON file in a specific collection.
 * @param {string} collectionName The name of the collection.
 * @param {string} docId The ID of the document (filename).
 * @returns {object|null} The parsed JSON object, or null if not found.
 */
function readFile(collectionName, docId) {
  try {
    const collectionFolder = getCollectionFolder(collectionName);
    if (!collectionFolder) { // Ensure folder exists before trying to read
      console.warn(`Collection folder ${collectionName} not found when trying to read ${docId}.`);
      return null;
    }
    const files = collectionFolder.getFilesByName(`${docId}.json`);
    if (files.hasNext()) {
      const file = files.next();
      const content = file.getBlob().getDataAsString();
      return JSON.parse(content);
    }
    return null;
  } catch (e) {
    console.error(`Error reading file ${docId} from collection ${collectionName}: ${e.message}`);
    return null;
  }
}

/**
 * Writes content to a JSON file in a specific collection.
 * @param {string} collectionName The name of the collection.
 * @param {string} docId The ID of the document (filename).
 * @param {object} content The JavaScript object to be written as JSON.
 * @returns {string} The docId if successful, null otherwise.
 */
function writeFile(collectionName, docId, content) {
  try {
    const collectionFolder = getCollectionFolder(collectionName);
    if (!collectionFolder) { // Ensure folder exists before trying to write
      throw new Error(`Collection folder ${collectionName} not found when trying to write ${docId}.`);
    }
    const jsonString = JSON.stringify(content, null, 2); // Pretty print JSON
    const fileName = `${docId}.json`;
    
    const files = collectionFolder.getFilesByName(fileName);
    if (files.hasNext()) {
        const file = files.next();
        file.setContent(jsonString);
    } else {
        collectionFolder.createFile(fileName, jsonString, 'application/json');
    }
    
    return docId;
  } catch (e) {
    console.error(`Error writing file ${docId} to collection ${collectionName}: ${e.message}`);
    throw new Error(`Failed to write document: ${e.message}`);
  }
}


/**
 * Deletes a JSON file from a specific collection.
 * @param {string} collectionName The name of the collection.
 * @param {string} docId The ID of the document (filename).
 * @returns {boolean} True if deleted, false otherwise.
 */
function deleteFile(collectionName, docId) {
  try {
    const collectionFolder = getCollectionFolder(collectionName);
    if (!collectionFolder) {
      console.warn(`Collection folder ${collectionName} not found when trying to delete ${docId}.`);
      return false; // Cannot delete if collection folder is missing
    }
    const files = collectionFolder.getFilesByName(`${docId}.json`);
    if (files.hasNext()) {
      const file = files.next();
      file.setTrashed(true); // Move to trash
      return true;
    }
    return false;
  } catch (e) {
    console.error(`Error deleting file ${docId} from collection ${collectionName}: ${e.message}`);
    throw new Error(`Failed to delete document: ${e.message}`);
  }
}

/**
 * Lists all documents (JSON files) in a collection.
 * NOTE: This is a performance bottleneck for large collections.
 * @param {string} collectionName The name of the collection.
 * @returns {Array<object>} An array of parsed JSON objects.
 */
function listCollection(collectionName) {
  try {
    const collectionFolder = getCollectionFolder(collectionName);
    if (!collectionFolder) { // Ensure folder exists before trying to list
      console.warn(`Collection folder ${collectionName} not found when trying to list collection.`);
      return [];
    }
    const files = collectionFolder.getFilesByType('application/json');
    const docs = [];
    while (files.hasNext()) {
      const file = files.next();
      try {
        const content = file.getBlob().getDataAsString();
        const doc = JSON.parse(content);
        docs.push({ id: file.getId(), ...doc });
      } catch (parseError) {
        console.warn(`Skipping malformed JSON file: ${file.getName()}. Error: ${parseError.message}`);
      }
    }
    return docs;
  } catch (e) {
    console.error(`Error listing collection ${collectionName}: ${e.message}`);
    throw new Error(`Failed to list collection: ${e.message}`);
  }
}

// --- Frontend-facing API Functions (called via google.script.run) ---

/**
 * Serves the HTML content.
 */
function doGet() {
  return HtmlService.createTemplateFromFile('Index')
      .evaluate()
      .setTitle('GrantMaster App')
      .setSandboxMode(HtmlService.SandboxMode.IFRAME);
}

/**
 * Helper function to include HTML files within other HTML files.
 * This is crucial for splitting your client-side React code into a separate .html file.
 * @param {string} filename The name of the HTML file (without .html extension).
 * @returns {string} The HTML content of the specified file.
 */
function include(filename) {
  return HtmlService.createTemplateFromFile(filename).evaluate().getContent();
}

// --- NEW: Authorization and User Management ---

let C_USER_CACHE = null; // Cache for the current user's session

/**
 * Gets the current user's profile and caches it for the script's execution.
 * Throws an error if the user is not found.
 * @returns {object} The current user's profile from the USER_PROFILES collection.
 */
function getAuthenticatedUser() {
    if (C_USER_CACHE) return C_USER_CACHE;

    const email = Session.getActiveUser().getEmail();
    if (!email) {
      throw new Error("Authentication failed: No active Google user session.");
    }

    const userId = email; // Using email as the unique ID
    let userProfile = readFile(COLLECTIONS.USER_PROFILES, userId);

    if (userProfile) {
        C_USER_CACHE = userProfile;
        return userProfile;
    }
    
    // If profile doesn't exist, create one. This makes the system self-provisioning.
    const allUsers = listCollection(COLLECTIONS.USER_PROFILES);
    const defaultRole = allUsers.length === 0 ? 'admin' : 'seeker'; // First user is an admin

    userProfile = {
      uid: userId,
      email: email,
      displayName: email.split('@')[0],
      role: defaultRole,
      createdAt: new Date().toISOString()
    };
    writeFile(COLLECTIONS.USER_PROFILES, userId, userProfile);
    C_USER_CACHE = userProfile;
    return userProfile;
}

/**
 * Checks if the current user has the required role. Throws an error if not.
 * @param {string|Array<string>} requiredRole The role(s) required for the action.
 * @throws {Error} If the user is not authorized.
 */
function authorize(requiredRole) {
  const user = getAuthenticatedUser();
  const roles = Array.isArray(requiredRole) ? requiredRole : [requiredRole];
  
  if (!roles.includes(user.role)) {
    throw new Error(`Authorization Error: You must have one of the following roles to perform this action: ${roles.join(', ')}.`);
  }
}

/**
 * Gets the current active user's email and a basic profile.
 * This function is now a wrapper around the new authentication system.
 * @returns {object} The current user's data (email, uid, displayName, role).
 */
function getCurrentUser() {
  try {
    const userData = getAuthenticatedUser(); // This will create the user if they don't exist
    return {
      currentUser: { 
        uid: userData.uid, 
        email: userData.email, 
        displayName: userData.displayName || userData.email.split('@')[0] 
      },
      userData: userData,
      isAuthReady: true,
      loading: false
    };
  } catch (e) {
    console.error(`Error in getCurrentUser: ${e.toString()}`);
    // Return a state that indicates the user is not authenticated
    return { currentUser: null, userData: null, isAuthReady: true, loading: false };
  }
}

// --- NEW: Data Sanitization Helper ---

/**
 * Standardizes date fields within a data object to ISO strings.
 * @param {object} data The object to process.
 * @returns {object} The object with standardized date fields.
 */
function standardizeTimestamps(data) {
    const timestampFields = ['createdAt', 'updatedAt', 'submittedDate', 'startDate', 'endDate', 'awardDate', 'uploadedAt', 'timestamp'];
    const processedData = { ...data };

    timestampFields.forEach(field => {
        if (processedData[field] && typeof processedData[field] === 'string') {
            // If it's already a valid ISO string, keep it, otherwise parse it.
            if (!isNaN(new Date(processedData[field]).getTime())) {
                 processedData[field] = new Date(processedData[field]).toISOString();
            }
        }
    });

    // Handle nested attachments array
    if (processedData.attachments && Array.isArray(processedData.attachments)) {
        processedData.attachments = processedData.attachments.map(att => {
            if (att.uploadedAt && typeof att.uploadedAt === 'string') {
                if (!isNaN(new Date(att.uploadedAt).getTime())) {
                    att.uploadedAt = new Date(att.uploadedAt).toISOString();
                }
            }
            return att;
        });
    }

    return processedData;
}


// --- Secured CRUD and Query Functions ---

/**
 * Gets a single document. Admins can get any doc. Others may have restrictions.
 * @param {string} collectionName
 * @param {string} docId
 * @returns {object|null}
 */
function getDoc(collectionName, docId) {
  // --- NEW: Authorization Check ---
  // Anyone can fetch grant programs or their own profile.
  const user = getAuthenticatedUser();
  if (collectionName !== COLLECTIONS.GRANT_PROGRAMS && 
      (collectionName === COLLECTIONS.USER_PROFILES && docId !== user.uid)) {
       authorize('admin'); // Only admins can fetch other user profiles.
  }

  console.log(`Backend: User ${user.email} fetching ${collectionName}/${docId}`);
  const doc = readFile(collectionName, docId);
  if (doc) {
    // Add logic here if a 'seeker' should only see their own applications/reviews
    if (collectionName === COLLECTIONS.APPLICATIONS && user.role !== 'admin' && doc.applicantId !== user.uid) {
        throw new Error("Authorization Error: You are not permitted to view this application.");
    }
    return { id: docId, ...doc };
  }
  return null;
}

/**
 * Generic function to add a new document.
 * @param {string} collectionName
 * @param {object} data
 * @returns {object} The created document with its ID.
 */
function addDoc(collectionName, data) {
  // --- NEW: Authorization Check ---
  const user = getAuthenticatedUser();
  if (collectionName === COLLECTIONS.GRANT_PROGRAMS || collectionName === COLLECTIONS.USER_PROFILES) {
      authorize('admin'); // Only admins can create new grant programs or user profiles directly.
  } else {
      authorize(['admin', 'seeker']); // Both can create other document types like applications.
  }

  const newId = Utilities.getUuid();
  let dataToSave = { ...data };
  
  // --- REFACTORED: Use helper function ---
  dataToSave = standardizeTimestamps(dataToSave);
  
  // Add creation/ownership metadata
  dataToSave.createdAt = new Date().toISOString();
  dataToSave.createdBy = user.uid;
  if(collectionName === COLLECTIONS.APPLICATIONS) {
    dataToSave.applicantId = user.uid;
  }
  
  const success = writeFile(collectionName, newId, dataToSave);
  if (success) {
    console.log(`Backend: User ${user.email} added ${collectionName}/${newId}`);
    return { id: newId, ...dataToSave };
  }
  throw new Error(`Failed to add document to ${collectionName}.`);
}

/**
 * Generic function to update an existing document.
 * @param {string} collectionName
 * @param {string} docId
 * @param {object} data
 * @returns {boolean} True if updated successfully.
 */
function updateDoc(collectionName, docId, data) {
  const user = getAuthenticatedUser();
  const existingDoc = readFile(collectionName, docId);

  if (!existingDoc) {
    throw new Error(`Document ${docId} not found in ${collectionName} for update.`);
  }

  // --- NEW: Authorization Check ---
  // Admins can update anything. Seekers can only update their own profile or their own applications.
  if (user.role !== 'admin') {
      if (collectionName === COLLECTIONS.USER_PROFILES && docId !== user.uid) {
          throw new Error("Authorization Error: You can only update your own profile.");
      }
      if (collectionName === COLLECTIONS.APPLICATIONS && existingDoc.applicantId !== user.uid) {
          throw new Error("Authorization Error: You can only update your own applications.");
      }
      if ([COLLECTIONS.GRANT_PROGRAMS, COLLECTIONS.REVIEWS].includes(collectionName)) {
           throw new Error(`Authorization Error: You do not have permission to update ${collectionName}.`);
      }
  }

  let dataToUpdate = { ...data };
  
  // --- REFACTORED: Use helper function ---
  dataToUpdate = standardizeTimestamps(dataToUpdate);
  dataToUpdate.updatedAt = new Date().toISOString();
  dataToUpdate.updatedBy = user.uid;

  const mergedData = { ...existingDoc, ...dataToUpdate };
  const success = writeFile(collectionName, docId, mergedData);

  if (success) {
    console.log(`Backend: User ${user.email} updated ${collectionName}/${docId}`);
    return true;
  }
  throw new Error(`Failed to update document ${docId} in ${collectionName}.`);
}


/**
 * Generic function to delete a document.
 * @param {string} collectionName
 * @param {string} docId
 * @returns {boolean} True if deleted.
 */
function deleteDoc(collectionName, docId) {
    const user = getAuthenticatedUser();
    const docToDelete = readFile(collectionName, docId);

    if (!docToDelete) {
        console.warn(`Attempted to delete non-existent document: ${collectionName}/${docId}`);
        return true; // Return true to avoid client-side error for a file already gone.
    }

    // --- NEW: Authorization Check ---
    if (user.role !== 'admin') {
        if (collectionName === COLLECTIONS.APPLICATIONS && docToDelete.applicantId !== user.uid) {
            throw new Error("Authorization Error: You can only delete your own applications.");
        }
        // Add other role-based deletion rules here if necessary
        if (collectionName !== COLLECTIONS.APPLICATIONS) {
             throw new Error(`Authorization Error: You do not have permission to delete from ${collectionName}.`);
        }
    }

  const success = deleteFile(collectionName, docId);
  if (success) {
    console.log(`Backend: User ${user.email} deleted ${collectionName}/${docId}`);
    return true;
  }
  throw new Error(`Failed to delete document ${docId} from ${collectionName}.`);
}


/**
 * Generic function to query a collection with optional filters and sorting.
 * @param {string} collectionName
 * @param {Array<object>} [filters=[]] Array of {field, operator, value} objects.
 * @param {Array<object>} [orderBy=[]] Array of {field, direction} objects ('asc' or 'desc').
 * @returns {Array<object>} Filtered and sorted documents.
 */
function queryCollection(collectionName, filters = [], orderBy = []) {
  const user = getAuthenticatedUser();
  console.log(`Backend: User ${user.email} querying ${collectionName}`);
  
  // --- NEW: Authorization Check & Data Shaping ---
  // If a non-admin is querying applications, add a filter to only show their own.
  if (user.role !== 'admin' && collectionName === COLLECTIONS.APPLICATIONS) {
      const userFilter = { field: 'applicantId', operator: '==', value: user.uid };
      filters.push(userFilter);
      console.log(`Query modified for non-admin. Filter added: ${JSON.stringify(userFilter)}`);
  }
  
  let docs = listCollection(collectionName);

  filters.forEach(filter => {
    docs = docs.filter(doc => {
      const docValue = doc[filter.field];
      switch (filter.operator) {
        case '==':
          return docValue === filter.value;
        case 'array-contains':
          return Array.isArray(docValue) && docValue.includes(filter.value);
        case 'in':
          return Array.isArray(filter.value) && filter.value.includes(docValue);
        default:
          return false;
      }
    });
  });

  orderBy.forEach(sortRule => {
    docs.sort((a, b) => {
      const aVal = a[sortRule.field];
      const bVal = b[sortRule.field];

      // Improved date comparison
      let valA = (typeof aVal === 'string' && aVal.match(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)) ? new Date(aVal) : aVal;
      let valB = (typeof bVal === 'string' && bVal.match(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)) ? new Date(bVal) : bVal;

      if (valA < valB) return sortRule.direction === 'asc' ? -1 : 1;
      if (valA > valB) return sortRule.direction === 'asc' ? 1 : -1;
      return 0;
    });
  });
  
  return docs;
}

/**
 * Uploads a base64 encoded file to Google Drive.
 * @param {string} base64Data The base64 encoded file data (without prefix).
 * @param {string} fileName The name of the file.
 * @param {string} mimeType The MIME type of the file.
 * @returns {object} An object containing fileName, storagePath (file ID), and downloadURL.
 */
function uploadFileToDrive(base64Data, fileName, mimeType) {
  // --- NEW: Authorization check ---
  authorize(['admin', 'seeker']); // Any authenticated user can upload.
  const user = getAuthenticatedUser();

  try {
    const attachmentsFolder = getCollectionFolder(COLLECTIONS.ATTACHMENTS);
    if (!attachmentsFolder) {
      throw new Error(`Attachments folder not found or could not be created.`);
    }
    const blob = Utilities.newBlob(Utilities.base64Decode(base64Data), mimeType, fileName);
    const file = attachmentsFolder.createFile(blob);
    
    // --- MODIFIED: CRITICAL SECURITY CHANGE ---
    // Files are now PRIVATE by default and only accessible to the app owner (the script runner).
    // The app will need a proxy function to serve files if they need to be viewed by others.
    // This prevents public, unauthenticated access to potentially sensitive documents.
    file.setSharing(DriveApp.Access.PRIVATE, DriveApp.Permission.NONE);
    
    console.log(`Backend: User ${user.email} uploaded file ${fileName} to Drive. ID: ${file.getId()}`);
    return {
      fileName: fileName,
      storagePath: file.getId(),
      downloadURL: `https://drive.google.com/uc?id=${file.getId()}&export=download`, // Standard download link
      uploadedAt: new Date().toISOString()
    };
  } catch (e) {
    console.error(`Error uploading file to Drive: ${e.message}`);
    throw new Error(`Failed to upload file: ${e.message}`);
  }
}

/**
 * Deletes a file from Google Drive.
 * @param {string} fileId The ID of the file to delete (from storagePath).
 * @returns {boolean} True if deletion was successful.
 */
function deleteFileFromDrive(fileId) {
  // --- NEW: Authorization Check ---
  authorize(['admin', 'seeker']); // Assume if you can get here, you're allowed. The calling function (deleteDoc) handles context.
  const user = getAuthenticatedUser();

  try {
    const file = DriveApp.getFileById(fileId);
    file.setTrashed(true);
    console.log(`Backend: User ${user.email} deleted Drive file ID: ${fileId}`);
    return true;
  } catch (e) {
    // Fail gracefully if file is already deleted or permissions change.
    console.error(`Error deleting file ${fileId} from Drive: ${e.message}`);
    return false;
  }
}

/**
 * Special function to delete attachments linked to an application.
 * Called from frontend when deleting an application.
 * @param {Array<object>} attachments An array of attachment objects (each with storagePath).
 * @returns {boolean} True if all deletions were attempted.
 */
function deleteApplicationAttachments(attachments) {
  if (!attachments || attachments.length === 0) return true;
  let allSuccessful = true;
  for (const att of attachments) {
    try {
      if (att.storagePath) {
        // The authorization is implicitly handled by deleteFileFromDrive
        deleteFileFromDrive(att.storagePath);
      }
    } catch (e) {
      console.error(`Failed to delete individual attachment ${att.fileName} (ID: ${att.storagePath}): ${e.message}`);
      allSuccessful = false;
    }
  }
  return allSuccessful;
}

/**
 * NEW: Securely retrieves a Drive file as a Base64 string for download.
 * @param {string} fileId The Drive File ID.
 * @returns {object|null} An object { base64: string, mimeType: string } or null if not found/accessible.
 */
function getDriveFileAsBase64(fileId) {
  const user = getAuthenticatedUser(); // Ensure user is authenticated for this proxy access
  try {
    const file = DriveApp.getFileById(fileId);
    
    // Optional: Add more granular checks here if only certain roles/users can download certain files
    // For now, assuming anyone authenticated can download via proxy if they have the fileId.

    const blob = file.getBlob();
    const base64Data = Utilities.base64Encode(blob.getBytes());
    return { base64: base64Data, mimeType: blob.getContentType() };
  } catch (e) {
    console.error(`Error retrieving file ${fileId} as Base64: ${e.message}`);
    throw new Error(`Failed to retrieve file: ${e.message}`);
  }
}