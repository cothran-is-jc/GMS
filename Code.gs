// === CONFIGURATION ===
const ROOT_DATA_FOLDER_URL = 'PASTE_YOUR_FOLDER_ID_OR_URL_HERE';

const COLLECTIONS = {
  USER_PROFILES: 'userProfiles',
  GRANT_PROGRAMS: 'grantPrograms',
  APPLICATIONS: 'applications',
  REVIEWS: 'reviews',
  AUDIT_LOG: 'auditLog',
  ATTACHMENTS: 'attachments',
  DISBURSEMENTS: 'disbursements',
  NOTIFICATIONS: 'notifications',
  EMAIL_TEMPLATES: 'emailTemplates'
};

// === DRIVE UTILITIES ===
function extractFolderId(idOrUrl) {
  const match = idOrUrl.match(/[-\w]{25,}/);
  if (!match) throw new Error('Invalid folder ID or URL');
  return match[0];
}

function getRootDataFolder() {
  const folderId = extractFolderId(ROOT_DATA_FOLDER_URL);
  return DriveApp.getFolderById(folderId);
}

function getOrCreateFolderByName(parentFolder, folderName) {
  const existing = parentFolder.getFoldersByName(folderName);
  if (existing.hasNext()) return existing.next();

  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(5000); // wait up to 5s
    const recheck = parentFolder.getFoldersByName(folderName);
    if (recheck.hasNext()) return recheck.next();

    return parentFolder.createFolder(folderName);
  } catch (e) {
    throw new Error(`Could not create folder '${folderName}': ${e.message}`);
  } finally {
    lock.releaseLock();
  }
}

function getCollectionFolder(collectionName) {
  const root = getRootDataFolder();
  return getOrCreateFolderByName(root, collectionName);
}

// === FILE CRUD HELPERS ===
function writeFile(collectionName, docId, content) {
  const folder = getCollectionFolder(collectionName);
  const existing = folder.getFilesByName(docId + '.json');
  while (existing.hasNext()) existing.next().setTrashed(true);

  const file = folder.createFile(docId + '.json', JSON.stringify(content, null, 2), MimeType.PLAIN_TEXT);
  return { success: true, fileId: file.getId() };
}

function readFile(collectionName, docId) {
  const folder = getCollectionFolder(collectionName);
  const files = folder.getFilesByName(docId + '.json');
  if (!files.hasNext()) throw new Error(`File '${docId}' not found in '${collectionName}'`);
  const file = files.next();
  return JSON.parse(file.getBlob().getDataAsString());
}

function deleteFile(collectionName, docId) {
  const folder = getCollectionFolder(collectionName);
  const files = folder.getFilesByName(docId + '.json');
  while (files.hasNext()) files.next().setTrashed(true);
  return { success: true };
}

function listCollection(collectionName) {
  const folder = getCollectionFolder(collectionName);
  const files = folder.getFiles();
  const result = [];

  while (files.hasNext()) {
    const file = files.next();
    try {
      result.push(JSON.parse(file.getBlob().getDataAsString()));
    } catch (e) {
      Logger.log(`Error parsing file '${file.getName()}': ${e}`);
    }
  }
  return result;
}

// === USER AUTH / RBAC ===
let _cachedUser = null;

function getAuthenticatedUser() {
  if (_cachedUser) return _cachedUser;

  const email = Session.getActiveUser().getEmail();
  Logger.log("DEBUG: Session email = " + email);
  if (!email) throw new Error("User not authenticated");

  const uid = Utilities.base64Encode(email);
  Logger.log("DEBUG: UID = " + uid);

  const collection = COLLECTIONS.USER_PROFILES;

  try {
    let profile = readFile(collection, uid);
    Logger.log("DEBUG: Found user profile for " + email);
    _cachedUser = profile;
    return profile;
  } catch (e) {
    Logger.log("DEBUG: Creating new profile for " + email);
    const existingUsers = listCollection(collection);
    const role = existingUsers.length === 0 ? 'admin' : 'seeker';
    const profile = { uid, email, displayName: email.split('@')[0], role };
    writeFile(collection, uid, profile);
    Logger.log("DEBUG: New user created with role: " + role);
    _cachedUser = profile;
    return profile;
  }
}



function authorize(requiredRole) {
  const user = getAuthenticatedUser();
  const roles = Array.isArray(requiredRole) ? requiredRole : [requiredRole];
  if (!roles.includes(useFr.role)) {
    throw new Error(`Unauthorized. Requires role: ${roles.join(', ')}`);
  }
}

function getCurrentUser() {
  try {
    const user = getAuthenticatedUser();

    const currentUser = {
      email: user.email,
      role: user.role
    };

    Logger.log("DEBUG: Returning currentUser = " + JSON.stringify(currentUser));
    return { currentUser, userData: user };
  } catch (e) {
    Logger.log("ERROR in getCurrentUser: " + e.toString());
    return { currentUser: null, userData: null };
  }
}


// === GENERIC COLLECTION QUERY ===
function queryCollection(collectionName, filters = [], orderBy = null) {
  authorize(['admin', 'manager', 'seeker', 'reviewer']); // Adjust as needed

  const allDocs = listCollection(collectionName);

  const filtered = filters.length
    ? allDocs.filter(doc =>
        filters.every(f => doc[f.field] === f.value)
      )
    : allDocs;

  if (orderBy) {
    const { field, direction = 'asc' } = orderBy;
    filtered.sort((a, b) => {
      const aVal = a[field], bVal = b[field];
      if (aVal < bVal) return direction === 'asc' ? -1 : 1;
      if (aVal > bVal) return direction === 'asc' ? 1 : -1;
      return 0;
    });
  }

  return filtered;
}

// === HTML TEMPLATING ===
function doGet(e) {
  const template = HtmlService.createTemplateFromFile('Index');
  return template.evaluate()
    .setTitle('Grant Management System')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}
