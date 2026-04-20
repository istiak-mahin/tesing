// @ts-nocheck
import { initializeApp } from 'firebase/app';
import {
  GoogleAuthProvider,
  browserLocalPersistence,
  getAuth,
  indexedDBLocalPersistence,
  initializeAuth,
  onAuthStateChanged,
  setPersistence,
  signInWithPopup,
  signOut,
} from 'firebase/auth';
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
import { firebaseConfig } from '../firebase';

const app = initializeApp(firebaseConfig);
const authInstance = (() => {
  try {
    return initializeAuth(app, {
      persistence: [indexedDBLocalPersistence, browserLocalPersistence],
    });
  } catch (error) {
    return getAuth(app);
  }
})();
const dbInstance = getFirestore(app);

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

class LegacyDocRef {
  constructor(private readonly path: string[]) {}

  collection(name: string) {
    return new LegacyCollectionRef([...this.path, name]);
  }

  async get() {
    return wrapDocSnapshot(await getDoc(doc(dbInstance, ...this.path)));
  }

  async set(data: Record<string, unknown>, options?: { merge?: boolean }) {
    await setDoc(doc(dbInstance, ...this.path), data, options);
  }

  async update(data: Record<string, unknown>) {
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

const legacyAuth = {
  get currentUser() {
    return authInstance.currentUser;
  },
  setPersistence(mode: string) {
    if (mode !== 'local') {
      return Promise.resolve();
    }
    return setPersistence(authInstance, browserLocalPersistence);
  },
  signInWithPopup(provider: GoogleAuthProvider) {
    return signInWithPopup(authInstance, provider);
  },
  signOut() {
    return signOut(authInstance);
  },
  onAuthStateChanged(callback: (user: any) => void) {
    return onAuthStateChanged(authInstance, callback);
  },
};

export const firebase = {
  initializeApp() {
    return app;
  },
  auth: Object.assign(() => legacyAuth, {
    Auth: {
      Persistence: {
        LOCAL: 'local',
      },
    },
    GoogleAuthProvider,
  }),
  firestore: Object.assign(() => ({
    collection(name: string) {
      return new LegacyCollectionRef([name]);
    },
  }), {
    FieldValue: {
      serverTimestamp,
    },
  }),
};

export const auth = legacyAuth;
export const db = {
  collection(name: string) {
    return new LegacyCollectionRef([name]);
  },
};
