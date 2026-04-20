// @ts-nocheck
import firebase from 'firebase/compat/app';
import 'firebase/compat/auth';

import { initializeApp, getApps, getApp } from 'firebase/app';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  getFirestore,
  onSnapshot,
  serverTimestamp,
  setDoc,
  updateDoc,
} from 'firebase/firestore';

import {
  firebaseConfig,
  firestoreDatabaseId,
} from '../firebase';

// ------------------------------------------------------------
// AUTH: use compat auth because legacyApp.ts is written in compat style
// ------------------------------------------------------------
const compatApp = firebase.apps.length
  ? firebase.app()
  : firebase.initializeApp(firebaseConfig);

const auth = firebase.auth();

// ------------------------------------------------------------
// FIRESTORE: use modular firestore with NAMED DATABASE support
// ------------------------------------------------------------
const modularApp = getApps().length ? getApp() : initializeApp(firebaseConfig);
const dbInstance = getFirestore(modularApp, firestoreDatabaseId);

// ------------------------------------------------------------
// Snapshot wrappers to mimic compat behavior
// ------------------------------------------------------------
type LegacyDocSnapshot = {
  id?: string;
  exists: boolean;
  data: () => any;
};

type LegacyQuerySnapshot = {
  docs: Array<{ id: string; data: () => any }>;
};

function wrapDocSnapshot(snapshot: any): LegacyDocSnapshot {
  return {
    id: snapshot.id,
    exists: snapshot.exists(),
    data: () => {
      const data = snapshot.data();
      if (!data) return data;
      return data.id ? data : { id: snapshot.id, ...data };
    },
  };
}

function wrapQuerySnapshot(snapshot: any): LegacyQuerySnapshot {
  return {
    docs: snapshot.docs.map((item: any) => ({
      id: item.id,
      data: () => {
        const data = item.data();
        return data?.id ? data : { id: item.id, ...data };
      },
    })),
  };
}

// ------------------------------------------------------------
// Compat-like Firestore refs
// ------------------------------------------------------------
class LegacyDocRef {
  constructor(private readonly path: string[]) {}

  collection(name: string) {
    return new LegacyCollectionRef([...this.path, name]);
  }

  async get() {
    return wrapDocSnapshot(await getDoc(doc(dbInstance, ...this.path)));
  }

  async set(data: Record<string, any>, options?: { merge?: boolean }) {
    await setDoc(doc(dbInstance, ...this.path), data, options);
  }

  async update(data: Record<string, any>) {
    await updateDoc(doc(dbInstance, ...this.path), data);
  }

  async delete() {
    await deleteDoc(doc(dbInstance, ...this.path));
  }

  onSnapshot(callback: (snapshot: LegacyDocSnapshot) => void) {
    return onSnapshot(doc(dbInstance, ...this.path), (snapshot) => {
      callback(wrapDocSnapshot(snapshot));
    });
  }
}

class LegacyCollectionRef {
  constructor(private readonly path: string[]) {}

  doc(id: string) {
    return new LegacyDocRef([...this.path, id]);
  }

  async get() {
    return wrapQuerySnapshot(await getDocs(collection(dbInstance, ...this.path)));
  }

  onSnapshot(callback: (snapshot: LegacyQuerySnapshot) => void) {
    return onSnapshot(collection(dbInstance, ...this.path), (snapshot) => {
      callback(wrapQuerySnapshot(snapshot));
    });
  }
}

// ------------------------------------------------------------
// Compat-like firebase object used by legacyApp.ts
// ------------------------------------------------------------
const firestoreCompatLike = Object.assign(
  function () {
    return {
      collection(name: string) {
        return new LegacyCollectionRef([name]);
      },
    };
  },
  {
    FieldValue: {
      serverTimestamp,
    },
  }
);

const firebaseCompatLike = {
  ...firebase,
  firestore: firestoreCompatLike,
};

const db = {
  collection(name: string) {
    return new LegacyCollectionRef([name]);
  },
};

export { firebaseCompatLike as firebase, auth, db };
export default firebaseCompatLike;