const DATABASE_NAME = "beoneofus-mail-attachments";
const STORE_NAME = "attachments";
const DATABASE_VERSION = 1;

let databasePromise;

function openDatabase() {
  if (!("indexedDB" in window)) {
    return Promise.reject(new Error("This browser does not support local attachment storage."));
  }
  if (databasePromise) return databasePromise;

  databasePromise = new Promise((resolve, reject) => {
    const request = window.indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Could not open attachment storage."));
    request.onblocked = () => reject(new Error("Attachment storage is busy in another tab. Close other mail tabs and try again."));
  }).catch((error) => {
    databasePromise = null;
    throw error;
  });

  return databasePromise;
}

export async function saveAttachment(id, file) {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, "readwrite");
    transaction.objectStore(STORE_NAME).put({ id, blob: file });
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("Could not save this attachment."));
    transaction.onabort = () => reject(transaction.error ?? new Error("Saving this attachment was canceled."));
  });
}

export async function readAttachment(id) {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const request = database.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).get(id);
    request.onsuccess = () => {
      if (!request.result) {
        reject(new Error("This attachment is no longer available in this browser."));
        return;
      }
      resolve(request.result.blob);
    };
    request.onerror = () => reject(request.error ?? new Error("Could not read this attachment."));
  });
}

export async function removeAttachment(id) {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, "readwrite");
    transaction.objectStore(STORE_NAME).delete(id);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("Could not remove this attachment."));
    transaction.onabort = () => reject(transaction.error ?? new Error("Removing this attachment was canceled."));
  });
}
