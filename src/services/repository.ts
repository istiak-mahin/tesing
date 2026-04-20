// @ts-nocheck
import { db } from './firebaseCompat';
import type { Budget, DebtRecord, Expense, SavingsGoal, SplitGroup, UserPreferences } from '../types';

type Unsubscribe = () => void;

function userRef(uid: string) {
  return db.collection('users').doc(uid);
}

export function subscribeToExpenses(uid: string, onChange: (items: Expense[]) => void): Unsubscribe {
  return userRef(uid).collection('expenses').onSnapshot((snapshot) => {
    onChange(snapshot.docs.map((doc) => doc.data() as Expense));
  });
}

export function subscribeToBudgets(uid: string, onChange: (items: Budget[]) => void): Unsubscribe {
  return userRef(uid).collection('budgets').onSnapshot((snapshot) => {
    onChange(snapshot.docs.map((doc) => doc.data() as Budget));
  });
}

export function subscribeToSavingsGoals(uid: string, onChange: (items: SavingsGoal[]) => void): Unsubscribe {
  return userRef(uid).collection('savingsGoals').onSnapshot((snapshot) => {
    onChange(snapshot.docs.map((doc) => doc.data() as SavingsGoal));
  });
}

export function subscribeToDebts(uid: string, onChange: (items: DebtRecord[]) => void): Unsubscribe {
  return userRef(uid).collection('debts').onSnapshot((snapshot) => {
    onChange(snapshot.docs.map((doc) => doc.data() as DebtRecord));
  });
}

export function subscribeToGroups(uid: string, onChange: (items: SplitGroup[]) => void): Unsubscribe {
  return userRef(uid).collection('groups').onSnapshot((snapshot) => {
    onChange(snapshot.docs.map((doc) => doc.data() as SplitGroup));
  });
}

export function updateUserPreferences(uid: string, patch: Partial<UserPreferences>) {
  return userRef(uid).set(patch, { merge: true });
}

export function createExpense(uid: string, payload: Expense) {
  return userRef(uid).collection('expenses').doc(payload.id).set(payload);
}

export function createBudget(uid: string, payload: Budget) {
  return userRef(uid).collection('budgets').doc(payload.id).set(payload);
}

export function createSavingsGoal(uid: string, payload: SavingsGoal) {
  return userRef(uid).collection('savingsGoals').doc(payload.id).set(payload);
}

export function createDebtRecord(uid: string, payload: DebtRecord) {
  return userRef(uid).collection('debts').doc(payload.id).set(payload);
}

export function createSplitGroup(uid: string, payload: SplitGroup) {
  return userRef(uid).collection('groups').doc(payload.id).set(payload);
}
