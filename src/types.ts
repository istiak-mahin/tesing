export type CurrencyCode = 'BDT' | 'USD' | 'EUR' | 'GBP' | 'INR' | 'JPY';
export type ThemeMode = 'dark' | 'light';
export type ExpenseCategory =
  | 'food'
  | 'transport'
  | 'rent'
  | 'shopping'
  | 'study'
  | 'entertainment'
  | 'bills'
  | 'health'
  | 'other';
export type ExpenseRecurring = 'none' | 'daily' | 'weekly' | 'monthly';
export type DebtType = 'lent' | 'borrowed';
export type DebtStatus = 'pending' | 'repaid';
export type AppPage = 'dashboard' | 'expenses' | 'budget' | 'savings' | 'debts' | 'group' | 'analytics';

export interface UserPreferences {
  name: string;
  email: string;
  currency: CurrencyCode;
  theme: ThemeMode;
  createdAt?: unknown;
}

export interface Expense {
  id: string;
  description: string;
  amount: number;
  category: ExpenseCategory;
  date: string;
  recurring?: ExpenseRecurring;
  notes?: string;
}

export interface Budget {
  id: string;
  category: ExpenseCategory;
  amount: number;
}

export interface SavingsGoal {
  id: string;
  name: string;
  target: number;
  current: number;
  targetDate?: string;
  icon?: string;
}

export interface DebtRecord {
  id: string;
  type: DebtType;
  person: string;
  amount: number;
  status: DebtStatus;
  date: string;
  dueDate?: string;
  note?: string;
}

export interface GroupExpense {
  id: string;
  description: string;
  amount: number;
  paidBy: string;
  date?: string;
}

export interface SplitGroup {
  id: string;
  name: string;
  members: string[];
  expenses: GroupExpense[];
}

export interface AppNotification {
  id?: string;
  text: string;
  createdAt?: string;
}

export interface AppState {
  user: { name: string; email: string } | null;
  uid: string | null;
  expenses: Expense[];
  budgets: Budget[];
  savingsGoals: SavingsGoal[];
  debts: DebtRecord[];
  groups: SplitGroup[];
  currency: CurrencyCode;
  theme: ThemeMode;
  budgetMonth: Date;
}
