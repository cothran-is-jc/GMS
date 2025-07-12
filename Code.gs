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
        role: 'seeker', // Default role for new users
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
    return profile;
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
        doc.id = docId; // Ensure the ID is part of the document object
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
  UserService.authorize(['admin', 'seeker', 'manager']);
  let docs = DriveService.listCollection(collectionName);
  return docs;
}

function getRecordById(collectionName, docId) {
  UserService.authorize(['admin', 'seeker', 'manager']); 
  const doc = DriveService.readFile(collectionName, docId);
  if (!doc) {
    throw new Error(`Document with ID '${docId}' not found in collection '${collectionName}'.`);
  }
  return doc;
}

function getAllUserProfiles() {
  UserService.authorize('admin');
  return DriveService.listCollection(COLLECTIONS.USER_PROFILES);
}

function updateUserRole(userEmail, newRole) {
  UserService.authorize('admin');

  const validRoles = ['admin', 'seeker', 'manager'];
  if (!validRoles.includes(newRole)) {
    throw new Error(`Invalid role specified. Must be one of: ${validRoles.join(', ')}.`);
  }

  const profile = DriveService.readFile(COLLECTIONS.USER_PROFILES, userEmail);
  if (!profile) {
    throw new Error(`User profile for ${userEmail} not found.`);
  }

  const currentUserEmail = Session.getActiveUser().getEmail();
  if (currentUserEmail === userEmail && profile.role === 'admin' && newRole !== 'admin') {
      throw new Error("Admins cannot remove their own admin role.");
  }

  profile.role = newRole;
  profile.updatedAt = new Date().toISOString();
  profile.updatedBy = currentUserEmail;

  DriveService.writeFile(COLLECTIONS.USER_PROFILES, userEmail, profile);
  return true;
}

function createRecord(collectionName, record) {
  UserService.authorize(['admin', 'manager']);
  
  const docId = Utilities.getUuid();
  record.id = docId;
  record.createdAt = new Date().toISOString();
  record.createdBy = Session.getActiveUser().getEmail();

  DriveService.writeFile(collectionName, docId, record);
  return record;
}

function updateRecord(collectionName, record) {
  UserService.authorize(['admin', 'manager']);

  if (!record || !record.id) {
    throw new Error("Cannot update: record data and ID are required.");
  }
  
  const existingDoc = DriveService.readFile(collectionName, record.id);
  if (!existingDoc) {
      throw new Error(`Record with ID ${record.id} not found.`);
  }

  record.createdAt = existingDoc.createdAt;
  record.createdBy = existingDoc.createdBy;
  
  record.updatedAt = new Date().toISOString();
  record.updatedBy = Session.getActiveUser().getEmail();

  DriveService.writeFile(collectionName, record.id, record);
  return record;
}

function createApplication(applicationData) {
  UserService.authorize('seeker');

  if (!applicationData || !applicationData.programId || !applicationData.title || !applicationData.essay) {
    throw new Error("Missing required application data.");
  }
  
  const user = UserService.getActiveUser();
  
  const docId = Utilities.getUuid();
  const record = {
    id: docId,
    applicantId: user.getEmail(),
    programId: applicationData.programId,
    title: applicationData.title,
    essay: applicationData.essay,
    status: 'Submitted',
    fundingStatus: 'Pending',
    submittedAt: new Date().toISOString()
  };

  DriveService.writeFile(COLLECTIONS.APPLICATIONS, docId, record);
  return record;
}

/**
 * Fetches all applications submitted by the current user.
 * Enriches each application with the title of the grant program it belongs to.
 * @returns {Array<Object>} A list of the user's applications.
 */
function getMyApplications() {
  // This function is intended ONLY for seekers to view their own applications.
  const userProfile = UserService.authorize('seeker');

  const allApplications = DriveService.listCollection(COLLECTIONS.APPLICATIONS);
  
  const myApplications = allApplications.filter(app => app.applicantId === userProfile.email);

  const enrichedApplications = myApplications.map(app => {
    // FIX: Ensure default statuses exist for older application records.
    if (!app.status) {
      app.status = 'Submitted';
    }
    if (!app.fundingStatus) {
      app.fundingStatus = 'Pending';
    }

    if (app.programId) {
      const program = DriveService.readFile(COLLECTIONS.GRANT_PROGRAMS, app.programId);
      app.programTitle = program ? program.title : 'Unknown Program';
    } else {
      app.programTitle = 'Program ID Missing';
    }
    return app;
  });

  return enrichedApplications;
}

function getApplicationsForReview() {
  UserService.authorize(['admin', 'manager']);
  
  const applications = DriveService.listCollection(COLLECTIONS.APPLICATIONS);
  
  const userProfiles = {};
  const grantPrograms = {};

  const enrichedApps = applications.map(app => {
    if (!app.status) {
      app.status = 'Submitted';
    }
    if (!app.fundingStatus) {
      app.fundingStatus = 'Pending';
    }

    if (!userProfiles[app.applicantId]) {
      userProfiles[app.applicantId] = DriveService.readFile(COLLECTIONS.USER_PROFILES, app.applicantId);
    }
    const profile = userProfiles[app.applicantId];
    app.applicantDisplayName = profile ? profile.displayName : app.applicantId;

    if (!grantPrograms[app.programId]) {
      grantPrograms[app.programId] = DriveService.readFile(COLLECTIONS.GRANT_PROGRAMS, app.programId);
    }
    const program = grantPrograms[app.programId];
    app.programTitle = program ? program.title : 'Unknown Program';
    
    return app;
  });

  return enrichedApps;
}

function updateApplicationStatus(applicationId, status, fundingStatus) {
  const reviewer = UserService.authorize(['admin', 'manager']);

  const validStatuses = ['Submitted', 'Granted', 'Denied'];
  const validFundingStatuses = ['Pending', 'Funded'];

  if (!validStatuses.includes(status) || !validFundingStatuses.includes(fundingStatus)) {
    throw new Error("Invalid status or funding status value provided.");
  }
  
  const application = DriveService.readFile(COLLECTIONS.APPLICATIONS, applicationId);
  if (!application) {
    throw new Error("Application not found.");
  }
  
  application.status = status;
  application.fundingStatus = fundingStatus;
  application.reviewedBy = reviewer.email;
  application.reviewedAt = new Date().toISOString();

  DriveService.writeFile(COLLECTIONS.APPLICATIONS, applicationId, application);

  return application;
}