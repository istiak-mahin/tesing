// @ts-nocheck
import Chart from 'chart.js/auto';
import { firebase } from '../services/firebaseCompat';

(window as any).Chart = Chart;

const auth = firebase.auth();
const db = firebase.firestore();

auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL);

function getGoogleProvider() {
    return new firebase.auth.GoogleAuthProvider();
}

// ============================================================
// CONSTANTS
// ============================================================
const CATEGORIES = {
    food: { label: 'Food', emoji: '\u{1F355}', color: '#fbbf24' },
    transport: { label: 'Transport', emoji: '\u{1F697}', color: '#38bdf8' },
    rent: { label: 'Rent', emoji: '\u{1F3E0}', color: '#a78bfa' },
    shopping: { label: 'Shopping', emoji: '\u{1F6CD}', color: '#f472b6' },
    study: { label: 'Study Materials', emoji: '\u{1F4DA}', color: '#818cf8' },
    entertainment: { label: 'Entertainment', emoji: '\u{1F3AE}', color: '#4ade80' },
    bills: { label: 'Bills', emoji: '\u{1F4A1}', color: '#fb923c' },
    health: { label: 'Health', emoji: '\u{1F48A}', color: '#f87171' },
    other: { label: 'Other', emoji: '\u{1F4E6}', color: '#94a3b8' }
};

const CURRENCY_SYMBOLS = { USD: '$', EUR: '\u20AC', GBP: '\u00A3', INR: '\u20B9', JPY: '\u00A5', BDT: '\u09F3' };

const TIPS = [
    "Track every expense, no matter how small!",
    "Try the 50/30/20 rule: 50% needs, 30% wants, 20% savings.",
    "Cook at home more — it saves a lot!",
    "Use student discounts whenever possible.",
    "Set up automatic savings transfers on payday.",
    "Review your subscriptions — cancel what you don’t use.",
    "Plan meals ahead to reduce food waste and spending.",
    "Buy used textbooks or use the library.",
    "Walk or bike instead of taking transport when possible.",
    "Set a 24-hour rule before making non-essential purchases."
];

// ============================================================
// APPLICATION STATE
// ============================================================
let state = {
    user: null,
    uid: null,
    expenses: [],
    budgets: [],
    savingsGoals: [],
    debts: [],
    groups: [],
    currency: 'BDT',
    theme: 'dark',
    budgetMonth: new Date()
};

let charts = {};
let lastAlertKey = '';
let currentPage = 'dashboard';
let currentGroupId = null;
let authInitialized = false;

// ============================================================
// FIRESTORE REAL-TIME LISTENERS (SINGLE SOURCE OF TRUTH)
// ============================================================
let unsubscribers = [];
let pendingRefreshTimer = null;

function debouncedRefresh() {
    clearTimeout(pendingRefreshTimer);
    pendingRefreshTimer = setTimeout(function () {
        refreshAll();
    }, 30);
}

function subscribeToUserData() {
    unsubscribeAll();

    unsubscribers.push(
        userDocRef().onSnapshot(function (doc) {
            if (doc.exists) {
                var data = doc.data();
                var changed = false;
                if (data.currency && data.currency !== state.currency) {
                    state.currency = data.currency;
                    changed = true;
                }
                if (data.theme && data.theme !== state.theme) {
                    state.theme = data.theme;
                    document.documentElement.setAttribute('data-theme', state.theme);
                    updateThemeIcon();
                    changed = true;
                }
                var sel = document.getElementById('currency-select');
                if (sel) sel.value = state.currency;
                if (changed) debouncedRefresh();
            }
        })
    );

    unsubscribers.push(
        expensesCollectionRef().onSnapshot(function (snap) {
            state.expenses = snap.docs.map(function (d) { return d.data(); });
            debouncedRefresh();
        })
    );

    unsubscribers.push(
        budgetsCollectionRef().onSnapshot(function (snap) {
            state.budgets = snap.docs.map(function (d) { return d.data(); });
            debouncedRefresh();
        })
    );

    unsubscribers.push(
        savingsGoalsCollectionRef().onSnapshot(function (snap) {
            state.savingsGoals = snap.docs.map(function (d) { return d.data(); });
            debouncedRefresh();
        })
    );

    unsubscribers.push(
        debtsCollectionRef().onSnapshot(function (snap) {
            state.debts = snap.docs.map(function (d) { return d.data(); });
            debouncedRefresh();
        })
    );

    unsubscribers.push(
        groupsCollectionRef().onSnapshot(function (snap) {
            state.groups = snap.docs.map(function (d) { return d.data(); });
            debouncedRefresh();
        })
    );
}

function unsubscribeAll() {
    unsubscribers.forEach(function (fn) { if (typeof fn === 'function') fn(); });
    unsubscribers = [];
}

// ============================================================
// UTILITY FUNCTIONS
// ============================================================
function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

function generateId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2, 9);
}

function fmt(amount) {
    const sym = CURRENCY_SYMBOLS[state.currency] || '$';
    return sym + parseFloat(amount).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtDate(dateStr) {
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function getMonthKey(date) {
    const d = date || new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
}

function getMonthLabel(date) {
    const d = date || new Date();
    return d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

function isCurrentMonth(dateStr) {
    const d = new Date(dateStr);
    return getMonthKey(d) === getMonthKey(new Date());
}

function isThisWeek(dateStr) {
    const d = new Date(dateStr);
    const now = new Date();
    const startOfWeek = new Date(now);
    startOfWeek.setDate(now.getDate() - now.getDay());
    startOfWeek.setHours(0, 0, 0, 0);
    return d >= startOfWeek && d <= now;
}

function isToday(dateStr) {
    const d = new Date(dateStr);
    const now = new Date();
    return d.toDateString() === now.toDateString();
}

function showToast(message, type) {
    type = type || 'info';
    const container = document.getElementById('toast-container');
    if (!container) {
        console.log(type + ': ' + message);
        return;
    }
    const icons = { success: 'ri-check-line', error: 'ri-error-warning-line', warning: 'ri-alert-line', info: 'ri-information-line' };
    const toast = document.createElement('div');
    toast.className = 'toast ' + type;
    toast.innerHTML = '<i class="' + (icons[type] || icons.info) + '"></i><span>' + message + '</span>';
    container.appendChild(toast);
    setTimeout(function () {
        toast.style.opacity = '0';
        toast.style.transform = 'translateX(40px)';
        toast.style.transition = 'all 0.3s ease';
        setTimeout(function () { toast.remove(); }, 300);
    }, 3000);
}

function addNotification(text) {
    const badge = document.getElementById('notif-badge');
    if (!badge) return;
    const count = parseInt(badge.textContent || '0') + 1;
    badge.textContent = count;
    badge.style.display = 'flex';
    const list = document.getElementById('notif-list');
    if (!list) return;
    const emptyMsg = list.querySelector('.notif-empty');
    if (emptyMsg) emptyMsg.remove();
    const item = document.createElement('div');
    item.className = 'notif-item';
    item.innerHTML = '<i class="ri-notification-3-line"></i><div><p>' + escapeHtml(text) + '</p><span class="notif-time">Just now</span></div>';
    list.prepend(item);
}

function clearNotifications() {
    const badge = document.getElementById('notif-badge');
    const list = document.getElementById('notif-list');
    const panel = document.getElementById('notif-panel');
    if (badge) {
        badge.style.display = 'none';
        badge.textContent = '0';
    }
    if (list) {
        list.innerHTML = '<p class="notif-empty">No notifications</p>';
    }
    if (panel) {
        panel.style.display = 'none';
    }
}

function toggleNotifications() {
    const panel = document.getElementById('notif-panel');
    if (!panel) return;
    panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
}

document.addEventListener('click', function (e) {
    const panel = document.getElementById('notif-panel');
    const bell = document.querySelector('.notification-bell');
    if (panel && bell && !panel.contains(e.target) && !bell.contains(e.target)) {
        panel.style.display = 'none';
    }
});

// ============================================================
// AUTH - GOOGLE SIGN-IN VIA FIREBASE
// ============================================================
function showAuth() {
    const modal = document.getElementById('auth-modal');
    if (modal) modal.style.display = 'flex';
}

function closeAuth() {
    const modal = document.getElementById('auth-modal');
    if (modal) modal.style.display = 'none';
}

function handleGoogleSignIn() {
    const provider = getGoogleProvider();

    console.log('Starting Google sign-in...');
    console.log('Provider:', provider);
    console.log('Auth object:', auth);

    auth.signInWithPopup(provider)
        .then(function () {
            closeAuth();
            showToast('Signed in successfully', 'success');
        })
        .catch(function (error) {
            console.error('Google Sign-In FULL error:', error);
            console.error('Error code:', error?.code);
            console.error('Error message:', error?.message);
            console.error('Error customData:', error?.customData);

            if (error.code === 'auth/popup-closed-by-user') {
                showToast('Sign-in was cancelled', 'warning');
            } else if (error.code === 'auth/unauthorized-domain') {
                showToast('This domain is not authorized. Add localhost and 127.0.0.1 in Firebase Console > Authentication > Settings.', 'error');
            } else if (error.code === 'auth/operation-not-allowed') {
                showToast('Google sign-in is not enabled in Firebase Console.', 'error');
            } else if (error.code === 'auth/argument-error') {
                showToast('Google sign-in argument error. Check console.', 'error');
            } else {
                showToast('Sign-in failed: ' + (error.message || 'Unknown error'), 'error');
            }
        });
}

function logout() {
    unsubscribeAll();
    state.expenses = [];
    state.budgets = [];
    state.savingsGoals = [];
    state.debts = [];
    state.groups = [];
    state.currency = 'BDT';
    state.budgetMonth = new Date();
    state.user = null;
    state.uid = null;
    authInitialized = false;

    auth.signOut().then(function () {
        const appContainer = document.getElementById('app-container');
        const landingPage = document.getElementById('landing-page');
        if (appContainer) appContainer.style.display = 'none';
        if (landingPage) landingPage.style.display = 'block';
        showToast('Logged out successfully', 'info');
    }).catch(function (error) {
        console.error('Logout error:', error);
        showToast('Logout failed', 'error');
    });
}

// ============================================================
// FIRESTORE - USER DATA OPERATIONS
// ============================================================
function userDocRef() {
    return db.collection('users').doc(state.uid);
}

function expensesCollectionRef() {
    return userDocRef().collection('expenses');
}

function budgetsCollectionRef() {
    return userDocRef().collection('budgets');
}

function savingsGoalsCollectionRef() {
    return userDocRef().collection('savingsGoals');
}

function debtsCollectionRef() {
    return userDocRef().collection('debts');
}

function groupsCollectionRef() {
    return userDocRef().collection('groups');
}

async function ensureUserDoc(firebaseUser) {
    const ref = userDocRef();
    const doc = await ref.get();
    if (!doc.exists) {
        await ref.set({
            name: firebaseUser.displayName || firebaseUser.email.split('@')[0],
            email: firebaseUser.email,
            currency: 'BDT',
            theme: 'dark',
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        return {
            name: firebaseUser.displayName || firebaseUser.email.split('@')[0],
            email: firebaseUser.email,
            currency: 'BDT',
            theme: 'dark'
        };
    }
    return doc.data();
}

async function loadUserData() {
    try {
        var userData = await ensureUserDoc(auth.currentUser);
        if (userData.currency) state.currency = userData.currency;
        if (userData.theme) state.theme = userData.theme;

        document.documentElement.setAttribute('data-theme', state.theme);
        updateThemeIcon();
        document.getElementById('currency-select').value = state.currency;

        var results = await Promise.all([
            expensesCollectionRef().get(),
            budgetsCollectionRef().get(),
            savingsGoalsCollectionRef().get(),
            debtsCollectionRef().get(),
            groupsCollectionRef().get()
        ]);

        state.expenses = results[0].docs.map(function (doc) { return doc.data(); });
        state.budgets = results[1].docs.map(function (doc) { return doc.data(); });
        state.savingsGoals = results[2].docs.map(function (doc) { return doc.data(); });
        state.debts = results[3].docs.map(function (doc) { return doc.data(); });
        state.groups = results[4].docs.map(function (doc) { return doc.data(); });
    } catch (error) {
        console.error('Failed to load user data:', error);
    }
}

async function saveUserSettings() {
    if (!state.uid) return;
    try {
        await userDocRef().set({
            name: state.user.name,
            email: state.user.email,
            currency: state.currency,
            theme: state.theme
        }, { merge: true });
    } catch (error) {
        console.error('Failed to save settings:', error);
        showToast('Failed to sync settings', 'error');
    }
}

async function saveExpenseToFirestore(expense, isNew) {
    if (!state.uid) {
        showToast('Please sign in again to sync your data', 'error');
        return false;
    }
    try {
        var ref = expensesCollectionRef().doc(expense.id);
        if (isNew) {
            await ref.set(expense);
        } else {
            await ref.update(expense);
        }
        return true;
    } catch (error) {
        console.error('Failed to save expense:', error);
        showToast('Failed to sync expense to cloud', 'error');
        return false;
    }
}

async function deleteExpenseFromFirestore(id) {
    if (!state.uid) {
        showToast('Please sign in again to sync your data', 'error');
        return false;
    }
    try {
        await expensesCollectionRef().doc(id).delete();
        return true;
    } catch (error) {
        console.error('Failed to delete expense:', error);
        showToast('Failed to sync deletion', 'error');
        return false;
    }
}

async function saveBudgetToFirestore(budget, isNew) {
    if (!state.uid) {
        showToast('Please sign in again to sync your data', 'error');
        return false;
    }
    try {
        var ref = budgetsCollectionRef().doc(budget.id);
        if (isNew) {
            await ref.set(budget);
        } else {
            await ref.update(budget);
        }
        return true;
    } catch (error) {
        console.error('Failed to save budget:', error);
        showToast('Failed to sync budget to cloud', 'error');
        return false;
    }
}

async function deleteBudgetFromFirestore(id) {
    if (!state.uid) {
        showToast('Please sign in again to sync your data', 'error');
        return false;
    }
    try {
        await budgetsCollectionRef().doc(id).delete();
        return true;
    } catch (error) {
        console.error('Failed to delete budget:', error);
        showToast('Failed to sync deletion', 'error');
        return false;
    }
}

async function saveSavingsGoalToFirestore(goal, isNew) {
    if (!state.uid) {
        showToast('Please sign in again to sync your data', 'error');
        return false;
    }
    try {
        var ref = savingsGoalsCollectionRef().doc(goal.id);
        if (isNew) {
            await ref.set(goal);
        } else {
            await ref.update(goal);
        }
        return true;
    } catch (error) {
        console.error('Failed to save savings goal:', error);
        showToast('Failed to sync savings goal to cloud', 'error');
        return false;
    }
}

async function deleteSavingsGoalFromFirestore(id) {
    if (!state.uid) {
        showToast('Please sign in again to sync your data', 'error');
        return false;
    }
    try {
        await savingsGoalsCollectionRef().doc(id).delete();
        return true;
    } catch (error) {
        console.error('Failed to delete savings goal:', error);
        showToast('Failed to sync deletion', 'error');
        return false;
    }
}

async function saveDebtToFirestore(debt, isNew) {
    if (!state.uid) {
        showToast('Please sign in again to sync your data', 'error');
        return false;
    }
    try {
        var ref = debtsCollectionRef().doc(debt.id);
        if (isNew) {
            await ref.set(debt);
        } else {
            await ref.update(debt);
        }
        return true;
    } catch (error) {
        console.error('Failed to save debt:', error);
        showToast('Failed to sync debt record to cloud', 'error');
        return false;
    }
}

async function deleteDebtFromFirestore(id) {
    if (!state.uid) {
        showToast('Please sign in again to sync your data', 'error');
        return false;
    }
    try {
        await debtsCollectionRef().doc(id).delete();
        return true;
    } catch (error) {
        console.error('Failed to delete debt:', error);
        showToast('Failed to sync deletion', 'error');
        return false;
    }
}

// ============================================================
// FIREBASE AUTH STATE LISTENER
// ============================================================

auth.onAuthStateChanged(async function (firebaseUser) {
    if (firebaseUser) {
        state.uid = firebaseUser.uid;
        state.user = {
            name: firebaseUser.displayName || firebaseUser.email.split('@')[0],
            email: firebaseUser.email
        };

        enterApp();

        try {
            // First start realtime listeners
            subscribeToUserData();

            // Then load initial data once
            await loadUserData();

            // Fast first paint
            refreshAll();
        } catch (e) {
            console.error('Firestore load error:', e);
        }

        if (!authInitialized) {
            showToast('Welcome, ' + state.user.name + '!', 'success');
        }
        authInitialized = true;
    } else {
        if (authInitialized) {
            unsubscribeAll();
            state.user = null;
            state.uid = null;
            state.expenses = [];
            state.budgets = [];
            state.savingsGoals = [];
            state.debts = [];
            state.groups = [];
            state.currency = 'BDT';
            state.budgetMonth = new Date();
        }
        document.getElementById('app-container').style.display = 'none';
        document.getElementById('landing-page').style.display = 'block';
        authInitialized = true;
    }
});

// ============================================================
// APP ENTRY
// ============================================================
function enterApp() {
    document.getElementById('landing-page').style.display = 'none';
    document.getElementById('app-container').style.display = 'flex';
    document.getElementById('user-name').textContent = state.user.name;
    document.getElementById('user-email').textContent = state.user.email;
    document.getElementById('user-avatar').textContent = state.user.name.charAt(0).toUpperCase();
    if (state.theme) {
        document.documentElement.setAttribute('data-theme', state.theme);
        updateThemeIcon();
    }
    document.getElementById('currency-select').value = state.currency;
    updateDailyTip();
    refreshAll();
}

// ============================================================
// THEME & CURRENCY
// ============================================================
function toggleTheme() {
    const current = document.documentElement.getAttribute('data-theme');
    const next = current === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    state.theme = next;
    saveUserSettings();
    updateThemeIcon();
    refreshAllCharts();
}

function updateThemeIcon() {
    const icon = document.getElementById('theme-icon');
    const theme = document.documentElement.getAttribute('data-theme');
    icon.className = theme === 'dark' ? 'ri-sun-line' : 'ri-moon-line';
}

function changeCurrency(val) {
    state.currency = val;
    saveUserSettings();
    refreshAll();
}

function updateDailyTip() {
    const dayIndex = new Date().getDate() % TIPS.length;
    document.getElementById('daily-tip').textContent = TIPS[dayIndex];
}

// ============================================================
// SIDEBAR & NAVIGATION
// ============================================================
function toggleSidebar() {
    const sidebar = document.getElementById('sidebar');
    const isMobile = window.innerWidth <= 768;
    if (isMobile) {
        sidebar.classList.toggle('mobile-open');
        let overlay = document.querySelector('.sidebar-overlay');
        if (!overlay) {
            overlay = document.createElement('div');
            overlay.className = 'sidebar-overlay';
            overlay.onclick = function () {
                sidebar.classList.remove('mobile-open');
                overlay.classList.remove('active');
            };
            document.body.appendChild(overlay);
        }
        const isOpen = sidebar.classList.contains('mobile-open');
        overlay.classList.toggle('active', isOpen);
        if (!isOpen) {
            setTimeout(function () { overlay.remove(); }, 300);
        }
    } else {
        sidebar.classList.toggle('collapsed');
    }
}

function navigateTo(page, e) {
    if (e) e.preventDefault();
    currentPage = page;
    document.querySelectorAll('.page').forEach(function (p) { p.classList.remove('active'); });
    document.getElementById('page-' + page).classList.add('active');
    document.querySelectorAll('.nav-item').forEach(function (n) { n.classList.remove('active'); });
    document.querySelectorAll('.nav-item[data-page="' + page + '"]').forEach(function (n) { n.classList.add('active'); });
    document.querySelectorAll('.mobile-nav-item').forEach(function (n) { n.classList.remove('active'); });
    document.querySelectorAll('.mobile-nav-item[data-page="' + page + '"]').forEach(function (n) { n.classList.add('active'); });
    const titles = { dashboard: 'Dashboard', expenses: 'Expense Tracker', budget: 'Budget Planner', savings: 'Savings Goals', debts: 'Borrow & Lend', group: 'Group Split', analytics: 'Analytics' };
    document.getElementById('page-title').textContent = titles[page] || 'Dashboard';
    const sidebar = document.getElementById('sidebar');
    sidebar.classList.remove('mobile-open');
    const overlay = document.querySelector('.sidebar-overlay');
    if (overlay) {
        overlay.classList.remove('active');
        overlay.remove();
    }
    refreshPage(page);
}

// ============================================================
// REFRESH / RENDER HELPERS
// ============================================================
function refreshAll() {
    updateDashboard();
    updateExpensesPage();
    updateBudgetPage();
    updateSavingsPage();
    updateDebtsPage();
    updateGroupPage();
    checkBudgetAlerts();
    generateInsight();
    if (currentPage === 'analytics') updateAnalyticsPage();
}

function refreshPage(page) {
    switch (page) {
        case 'dashboard': updateDashboard(); generateInsight(); break;
        case 'expenses': updateExpensesPage(); break;
        case 'budget': updateBudgetPage(); break;
        case 'savings': updateSavingsPage(); break;
        case 'debts': updateDebtsPage(); break;
        case 'group': updateGroupPage(); break;
        case 'analytics': updateAnalyticsPage(); break;
    }
    checkBudgetAlerts();
}

function getMonthlyExpenses(date) {
    const mk = getMonthKey(date || new Date());
    return state.expenses.filter(function (e) {
        const ek = getMonthKey(new Date(e.date));
        return ek === mk;
    });
}

// ============================================================
// DASHBOARD
// ============================================================
function updateDashboard() {
    const monthly = getMonthlyExpenses();
    const totalBudget = state.budgets.reduce(function (s, b) { return s + b.amount; }, 0);
    const totalSpent = monthly.reduce(function (s, e) { return s + e.amount; }, 0);
    const totalSavings = state.savingsGoals.reduce(function (s, g) { return s + g.current; }, 0);
    const remaining = totalBudget - totalSpent;

    animateCounter(document.querySelector('[data-counter="budget"]'), totalBudget);
    animateCounter(document.querySelector('[data-counter="spent"]'), totalSpent);
    animateCounter(document.querySelector('[data-counter="remaining"]'), Math.max(0, remaining));
    animateCounter(document.querySelector('[data-counter="savings"]'), totalSavings);

    const spentTrend = document.getElementById('spent-trend');
    if (totalSpent > totalBudget && totalBudget > 0) {
        spentTrend.className = 'card-trend';
        spentTrend.innerHTML = '<i class="ri-arrow-up-s-line"></i> Over budget!';
    } else {
        spentTrend.className = 'card-trend up';
        spentTrend.innerHTML = '<i class="ri-arrow-down-s-line"></i> This month';
    }

    updateDashChart();
    updateDashSavingsList();
    updateDashRecentExpenses();
    updateDashBudgetList();
}

function animateCounter(el, target) {
    if (!el) return;
    const duration = 600;
    const start = parseFloat(el.dataset.currentVal || '0');
    const startTime = performance.now();
    el.dataset.currentVal = target;

    function tick(now) {
        const elapsed = now - startTime;
        const progress = Math.min(elapsed / duration, 1);
        const eased = 1 - Math.pow(1 - progress, 3);
        const current = start + (target - start) * eased;
        el.textContent = fmt(current);
        if (progress < 1) requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
}

function updateDashChart() {
    const period = document.getElementById('dash-chart-period') ? document.getElementById('dash-chart-period').value : 'month';
    let filtered;
    if (period === 'week') {
        filtered = state.expenses.filter(function (e) { return isThisWeek(e.date); });
    } else {
        filtered = getMonthlyExpenses();
    }
    const catTotals = {};
    filtered.forEach(function (e) {
        catTotals[e.category] = (catTotals[e.category] || 0) + e.amount;
    });
    const labels = Object.keys(catTotals).map(function (k) { return CATEGORIES[k] ? CATEGORIES[k].label : k; });
    const data = Object.values(catTotals);
    const colors = Object.keys(catTotals).map(function (k) { return CATEGORIES[k] ? CATEGORIES[k].color : '#64748b'; });

    if (charts.dashSpending) charts.dashSpending.destroy();
    const ctx = document.getElementById('dash-spending-chart');
    if (!ctx) return;

    if (data.length === 0) {
        charts.dashSpending = new Chart(ctx, {
            type: 'doughnut',
            data: { labels: ['No data'], datasets: [{ data: [1], backgroundColor: [getChartGridColor()], borderWidth: 0 }] },
            options: {
                responsive: true, maintainAspectRatio: false, cutout: '65%',
                plugins: { legend: { display: false }, tooltip: { enabled: false } },
                animation: { duration: 400 }
            }
        });
        return;
    }

    charts.dashSpending = new Chart(ctx, {
        type: 'doughnut',
        data: { labels: labels, datasets: [{ data: data, backgroundColor: colors, borderWidth: 0, hoverOffset: 8 }] },
        options: {
            responsive: true, maintainAspectRatio: false,
            cutout: '65%',
            plugins: {
                legend: { position: 'bottom', labels: { padding: 16, usePointStyle: true, pointStyle: 'circle', font: { size: 12, family: 'Inter' }, color: getChartTextColor() } }
            },
            animation: { animateRotate: true, duration: 800 }
        }
    });
}

function updateDashSavingsList() {
    const container = document.getElementById('dash-savings-list');
    if (state.savingsGoals.length === 0) {
        container.innerHTML = '<p class="empty-state-sm">No savings goals yet</p>';
        return;
    }
    container.innerHTML = state.savingsGoals.slice(0, 4).map(function (g) {
        const pct = g.target > 0 ? Math.round((g.current / g.target) * 100) : 0;
        const icon = g.icon || '\u{1F3AF}';
        return '<div class="savings-preview-item">' +
            '<span class="sp-icon">' + icon + '</span>' +
            '<div class="sp-info">' +
            '<div class="sp-name">' + escapeHtml(g.name) + '</div>' +
            '<div class="sp-bar"><div class="sp-bar-fill" style="width:' + pct + '%"></div></div>' +
            '</div>' +
            '<span class="sp-pct">' + pct + '%</span>' +
            '</div>';
    }).join('');
}

function updateDashRecentExpenses() {
    const container = document.getElementById('dash-recent-expenses');
    const recent = state.expenses.slice().sort(function (a, b) { return new Date(b.date) - new Date(a.date); }).slice(0, 5);
    if (recent.length === 0) {
        container.innerHTML = '<p class="empty-state-sm">No expenses recorded yet</p>';
        return;
    }
    container.innerHTML = recent.map(function (e) {
        const cat = CATEGORIES[e.category] || CATEGORIES.other;
        return '<div class="recent-exp-item">' +
            '<span class="re-icon">' + cat.emoji + '</span>' +
            '<div class="re-info">' +
            '<div class="re-desc">' + escapeHtml(e.description) + '</div>' +
            '<div class="re-cat">' + cat.label + ' \u00B7 ' + fmtDate(e.date) + '</div>' +
            '</div>' +
            '<span class="re-amount">-' + fmt(e.amount) + '</span>' +
            '</div>';
    }).join('');
}

function updateDashBudgetList() {
    const container = document.getElementById('dash-budget-list');
    if (state.budgets.length === 0) {
        container.innerHTML = '<p class="empty-state-sm">No budgets set yet</p>';
        return;
    }
    const monthly = getMonthlyExpenses();
    container.innerHTML = state.budgets.map(function (b) {
        const cat = CATEGORIES[b.category] || CATEGORIES.other;
        const spent = monthly.filter(function (e) { return e.category === b.category; }).reduce(function (s, e) { return s + e.amount; }, 0);
        const pct = b.amount > 0 ? Math.min(100, Math.round((spent / b.amount) * 100)) : 0;
        const barColor = pct >= 100 ? 'var(--danger)' : pct >= 80 ? 'var(--warning)' : 'var(--success)';
        return '<div class="budget-preview-item">' +
            '<div class="bp-header">' +
            '<span class="bp-cat">' + cat.emoji + ' ' + cat.label + '</span>' +
            '<span class="bp-amounts">' + fmt(spent) + ' / ' + fmt(b.amount) + '</span>' +
            '</div>' +
            '<div class="bp-bar"><div class="bp-bar-fill" style="width:' + pct + '%;background:' + barColor + '"></div></div>' +
            '</div>';
    }).join('');
}

function generateInsight() {
    const banner = document.getElementById('insight-banner');
    const text = document.getElementById('insight-text');
    const monthly = getMonthlyExpenses();
    if (monthly.length < 3) { banner.style.display = 'none'; return; }
    const catTotals = {};
    monthly.forEach(function (e) { catTotals[e.category] = (catTotals[e.category] || 0) + e.amount; });
    const topCat = Object.entries(catTotals).sort(function (a, b) { return b[1] - a[1]; })[0];
    if (topCat) {
        const cat = CATEGORIES[topCat[0]] || CATEGORIES.other;
        const totalSpent = monthly.reduce(function (s, e) { return s + e.amount; }, 0);
        const pct = totalSpent > 0 ? Math.round((topCat[1] / totalSpent) * 100) : 0;
        text.textContent = 'You spent the most on ' + cat.label + ' this month \u2014 ' + fmt(topCat[1]) + ' (' + pct + '% of total). Consider setting a budget limit for this category.';
        banner.style.display = 'flex';
    }
}

function checkBudgetAlerts() {
    const monthly = getMonthlyExpenses();
    const alerts = [];
    state.budgets.forEach(function (b) {
        const spent = monthly.filter(function (e) { return e.category === b.category; }).reduce(function (s, e) { return s + e.amount; }, 0);
        const pct = b.amount > 0 ? (spent / b.amount) * 100 : 0;
        if (pct >= 100) {
            alerts.push('over:' + b.category + ':' + Math.round(pct));
        } else if (pct >= 80) {
            alerts.push('warn:' + b.category + ':' + Math.round(pct));
        }
    });
    const alertKey = alerts.join('|');
    if (alertKey && alertKey !== lastAlertKey) {
        lastAlertKey = alertKey;
        state.budgets.forEach(function (b) {
            const spent = monthly.filter(function (e) { return e.category === b.category; }).reduce(function (s, e) { return s + e.amount; }, 0);
            const pct = b.amount > 0 ? (spent / b.amount) * 100 : 0;
            const cat = CATEGORIES[b.category] || CATEGORIES.other;
            if (pct >= 100) {
                addNotification('\u26A0\uFE0F ' + cat.label + ' budget exceeded! Spent ' + fmt(spent) + ' of ' + fmt(b.amount));
            } else if (pct >= 80) {
                addNotification('\uD83D\uDD14 ' + cat.label + ' budget at ' + Math.round(pct) + '%. Be careful with spending.');
            }
        });
    }
}

// ============================================================
// EXPENSES
// ============================================================
function openExpenseModal(id) {
    const modal = document.getElementById('expense-modal');
    modal.style.display = 'flex';
    document.getElementById('expense-edit-id').value = '';
    document.getElementById('expense-modal-title').textContent = 'Add Expense';
    if (id) {
        const exp = state.expenses.find(function (e) { return e.id === id; });
        if (exp) {
            document.getElementById('expense-edit-id').value = id;
            document.getElementById('expense-modal-title').textContent = 'Edit Expense';
            document.getElementById('expense-desc').value = exp.description;
            document.getElementById('expense-amount').value = exp.amount;
            document.getElementById('expense-category').value = exp.category;
            document.getElementById('expense-date').value = exp.date;
            document.getElementById('expense-recurring').value = exp.recurring || 'none';
            document.getElementById('expense-notes').value = exp.notes || '';
        }
    } else {
        document.getElementById('expense-desc').value = '';
        document.getElementById('expense-amount').value = '';
        document.getElementById('expense-category').value = '';
        document.getElementById('expense-date').value = new Date().toISOString().split('T')[0];
        document.getElementById('expense-recurring').value = 'none';
        document.getElementById('expense-notes').value = '';
    }
}

function closeExpenseModal() {
    document.getElementById('expense-modal').style.display = 'none';
}

async function saveExpense(e) {
    e.preventDefault();

    var editId = document.getElementById('expense-edit-id').value;
    var isNew = !editId;

    var expense = {
        id: editId || generateId(),
        description: document.getElementById('expense-desc').value.trim(),
        amount: parseFloat(document.getElementById('expense-amount').value),
        category: document.getElementById('expense-category').value,
        date: document.getElementById('expense-date').value,
        recurring: document.getElementById('expense-recurring').value,
        notes: document.getElementById('expense-notes').value.trim()
    };

    // Close immediately for faster UX
    closeExpenseModal();

    const saved = await saveExpenseToFirestore(expense, isNew);
    if (!saved) {
        showToast('Failed to sync expense to cloud', 'error');
        return;
    }

    // Do NOT push/update local state manually
    // Firestore onSnapshot will update state automatically
    if (editId) {
        showToast('Expense updated and synced!', 'success');
    } else {
        showToast('Expense added and synced!', 'success');
        if (expense.recurring !== 'none') {
            addNotification('📌 Recurring expense "' + expense.description + '" set as ' + expense.recurring);
        }
    }
}

async function deleteExpense(id) {
    if (!await deleteExpenseFromFirestore(id)) return;
    state.expenses = state.expenses.filter(function (e) { return e.id !== id; });
    showToast('Expense deleted from cloud', 'warning');
    refreshAll();
}

function filterExpenses() {
    updateExpensesPage();
}

function updateExpensesPage() {
    const period = document.getElementById('expense-filter-period') ? document.getElementById('expense-filter-period').value : 'month';
    const catFilter = document.getElementById('expense-filter-category') ? document.getElementById('expense-filter-category').value : 'all';

    let filtered = state.expenses.slice();
    if (period === 'today') filtered = filtered.filter(function (e) { return isToday(e.date); });
    else if (period === 'week') filtered = filtered.filter(function (e) { return isThisWeek(e.date); });
    else if (period === 'month') filtered = filtered.filter(function (e) { return isCurrentMonth(e.date); });
    if (catFilter !== 'all') filtered = filtered.filter(function (e) { return e.category === catFilter; });
    filtered.sort(function (a, b) { return new Date(b.date) - new Date(a.date); });

    const total = filtered.reduce(function (s, e) { return s + e.amount; }, 0);
    const avg = filtered.length > 0 ? total / filtered.length : 0;
    document.getElementById('exp-total').textContent = fmt(total);
    document.getElementById('exp-count').textContent = filtered.length;
    document.getElementById('exp-avg').textContent = fmt(avg);

    const list = document.getElementById('expenses-list');
    if (filtered.length === 0) {
        list.innerHTML = '<div class="empty-state">' +
            '<i class="ri-receipt-line"></i>' +
            '<h3>No Expenses Found</h3>' +
            '<p>Try changing your filters or add a new expense.</p>' +
            '<button class="btn btn-primary" onclick="openExpenseModal()">Add Expense</button>' +
            '</div>';
        return;
    }

    list.innerHTML = filtered.map(function (e, i) {
        const cat = CATEGORIES[e.category] || CATEGORIES.other;
        const recurringBadge = e.recurring && e.recurring !== 'none' ? '<span class="exp-recurring-badge">' + escapeHtml(e.recurring) + '</span>' : '';
        return '<div class="expense-item" style="animation-delay:' + (i * 0.03) + 's">' +
            '<div class="exp-item-icon" style="background:' + cat.color + '15;color:' + cat.color + '">' + cat.emoji + '</div>' +
            '<div class="exp-item-info">' +
            '<div class="exp-item-desc">' + escapeHtml(e.description) + ' ' + recurringBadge + '</div>' +
            '<div class="exp-item-meta">' +
            '<span>' + cat.label + '</span><span>\u00B7</span><span>' + fmtDate(e.date) + '</span>' +
            (e.notes ? '<span>\u00B7</span><span>' + escapeHtml(e.notes) + '</span>' : '') +
            '</div>' +
            '</div>' +
            '<span class="exp-item-amount">-' + fmt(e.amount) + '</span>' +
            '<div class="exp-item-actions">' +
            '<button class="btn-icon btn-sm" onclick="openExpenseModal(\'' + e.id + '\')" title="Edit"><i class="ri-edit-line"></i></button>' +
            '<button class="btn-icon btn-sm" onclick="deleteExpense(\'' + e.id + '\')" title="Delete" style="color:var(--danger)"><i class="ri-delete-bin-line"></i></button>' +
            '</div>' +
            '</div>';
    }).join('');
}

// ============================================================
// BUDGET
// ============================================================
function openBudgetModal(id) {
    const modal = document.getElementById('budget-modal');
    modal.style.display = 'flex';
    document.getElementById('budget-edit-id').value = '';
    document.getElementById('budget-modal-title').textContent = 'Set Budget';
    if (id) {
        const b = state.budgets.find(function (b) { return b.id === id; });
        if (b) {
            document.getElementById('budget-edit-id').value = id;
            document.getElementById('budget-modal-title').textContent = 'Edit Budget';
            document.getElementById('budget-category').value = b.category;
            document.getElementById('budget-amount').value = b.amount;
        }
    } else {
        document.getElementById('budget-category').value = '';
        document.getElementById('budget-amount').value = '';
    }
}

function closeBudgetModal() {
    document.getElementById('budget-modal').style.display = 'none';
}

async function saveBudget(e) {
    e.preventDefault();

    var editId = document.getElementById('budget-edit-id').value;
    var isNew = !editId;

    var budget = {
        id: editId || generateId(),
        category: document.getElementById('budget-category').value,
        amount: parseFloat(document.getElementById('budget-amount').value)
    };

    if (!editId) {
        var existing = state.budgets.find(function (b) { return b.category === budget.category; });
        if (existing) {
            budget.id = existing.id;
            isNew = false;
        }
    }

    closeBudgetModal();

    const saved = await saveBudgetToFirestore(budget, isNew);
    if (!saved) {
        showToast('Failed to sync budget to cloud', 'error');
        return;
    }

    showToast('Budget synced successfully!', 'success');
}

async function deleteBudget(id) {
    if (!await deleteBudgetFromFirestore(id)) return;
    state.budgets = state.budgets.filter(function (b) { return b.id !== id; });
    showToast('Budget removed from cloud', 'warning');
    refreshAll();
}

function changeBudgetMonth(delta) {
    state.budgetMonth.setMonth(state.budgetMonth.getMonth() + delta);
    updateBudgetPage();
}

function updateBudgetPage() {
    document.getElementById('budget-month-label').textContent = getMonthLabel(state.budgetMonth);
    const monthly = getMonthlyExpenses(state.budgetMonth);
    const totalBudget = state.budgets.reduce(function (s, b) { return s + b.amount; }, 0);
    const totalSpent = monthly.reduce(function (s, e) { return s + e.amount; }, 0);
    const remaining = totalBudget - totalSpent;
    const overallPct = totalBudget > 0 ? Math.min(100, Math.round((totalSpent / totalBudget) * 100)) : 0;

    document.getElementById('budget-total').textContent = fmt(totalBudget);
    document.getElementById('budget-spent').textContent = fmt(totalSpent);
    document.getElementById('budget-remaining').textContent = fmt(Math.max(0, remaining));
    document.getElementById('budget-overall-progress').style.width = overallPct + '%';
    document.getElementById('budget-overall-pct').textContent = overallPct + '%';

    const fillEl = document.getElementById('budget-overall-progress');
    if (overallPct >= 100) fillEl.style.background = 'linear-gradient(90deg, var(--danger), #dc2626)';
    else if (overallPct >= 80) fillEl.style.background = 'linear-gradient(90deg, var(--warning), #f97316)';
    else fillEl.style.background = 'linear-gradient(90deg, var(--primary), var(--secondary))';

    const container = document.getElementById('budget-categories-list');
    if (state.budgets.length === 0) {
        container.innerHTML = '<div class="empty-state">' +
            '<i class="ri-pie-chart-2-line"></i>' +
            '<h3>No Budgets Set</h3>' +
            '<p>Create your first budget to start managing your spending!</p>' +
            '<button class="btn btn-primary" onclick="openBudgetModal()">Set Your Budget</button>' +
            '</div>';
        return;
    }

    container.innerHTML = state.budgets.map(function (b, i) {
        const cat = CATEGORIES[b.category] || CATEGORIES.other;
        const spent = monthly.filter(function (e) { return e.category === b.category; }).reduce(function (s, e) { return s + e.amount; }, 0);
        const pct = b.amount > 0 ? Math.min(100, Math.round((spent / b.amount) * 100)) : 0;
        let barColor, statusClass, statusText;
        if (pct >= 100) { barColor = 'var(--danger)'; statusClass = 'danger'; statusText = 'Over budget!'; }
        else if (pct >= 80) { barColor = 'var(--warning)'; statusClass = 'warning'; statusText = 'Approaching limit'; }
        else { barColor = 'var(--success)'; statusClass = 'safe'; statusText = 'On track'; }
        return '<div class="budget-cat-card" style="animation-delay:' + (i * 0.05) + 's">' +
            '<div class="budget-cat-header">' +
            '<div class="budget-cat-left">' +
            '<span class="budget-cat-icon">' + cat.emoji + '</span>' +
            '<span class="budget-cat-name">' + cat.label + '</span>' +
            '</div>' +
            '<div class="budget-cat-actions">' +
            '<button class="btn-icon btn-sm" onclick="openBudgetModal(\'' + b.id + '\')" title="Edit"><i class="ri-edit-line"></i></button>' +
            '<button class="btn-icon btn-sm" onclick="deleteBudget(\'' + b.id + '\')" title="Delete" style="color:var(--danger)"><i class="ri-delete-bin-line"></i></button>' +
            '</div>' +
            '</div>' +
            '<div class="budget-cat-amounts">' +
            '<span>' + fmt(spent) + ' spent</span>' +
            '<span>' + fmt(b.amount) + ' limit</span>' +
            '</div>' +
            '<div class="budget-cat-bar"><div class="budget-cat-bar-fill" style="width:' + pct + '%;background:' + barColor + '"></div></div>' +
            '<div class="budget-cat-status ' + statusClass + '">' + statusText + ' \u00B7 ' + pct + '% used</div>' +
            '</div>';
    }).join('');
}

// ============================================================
// SAVINGS
// ============================================================
function openSavingsModal(id) {
    const modal = document.getElementById('savings-modal');
    modal.style.display = 'flex';
    document.getElementById('savings-edit-id').value = '';
    document.getElementById('savings-modal-title').textContent = 'New Savings Goal';
    if (id) {
        const g = state.savingsGoals.find(function (g) { return g.id === id; });
        if (g) {
            document.getElementById('savings-edit-id').value = id;
            document.getElementById('savings-modal-title').textContent = 'Edit Goal';
            document.getElementById('savings-name').value = g.name;
            document.getElementById('savings-target').value = g.target;
            document.getElementById('savings-current').value = g.current;
            document.getElementById('savings-deadline').value = g.deadline || '';
            document.querySelectorAll('input[name="savings-icon"]').forEach(function (r) {
                r.checked = r.value === (g.icon || '\u{1F3AF}');
            });
        }
    } else {
        document.getElementById('savings-name').value = '';
        document.getElementById('savings-target').value = '';
        document.getElementById('savings-current').value = '0';
        document.getElementById('savings-deadline').value = '';
        document.querySelector('input[name="savings-icon"][value="\u{1F3AF}"]').checked = true;
    }
}

function closeSavingsModal() {
    document.getElementById('savings-modal').style.display = 'none';
}

async function saveSavingsGoal(e) {
    e.preventDefault();

    var editId = document.getElementById('savings-edit-id').value;
    var isNew = !editId;
    var iconRadio = document.querySelector('input[name="savings-icon"]:checked');

    var goal = {
        id: editId || generateId(),
        name: document.getElementById('savings-name').value.trim(),
        target: parseFloat(document.getElementById('savings-target').value),
        current: parseFloat(document.getElementById('savings-current').value) || 0,
        deadline: document.getElementById('savings-deadline').value || null,
        icon: iconRadio ? iconRadio.value : '🎯'
    };

    closeSavingsModal();

    const saved = await saveSavingsGoalToFirestore(goal, isNew);
    if (!saved) {
        showToast('Failed to sync savings goal to cloud', 'error');
        return;
    }

    showToast(isNew ? 'Savings goal created and synced!' : 'Goal updated and synced!', 'success');

    if (goal.current >= goal.target) {
        addNotification('🎉 Congratulations! You reached your "' + goal.name + '" savings goal!');
    }
}

async function deleteSavingsGoal(id) {
    if (!await deleteSavingsGoalFromFirestore(id)) return;
    state.savingsGoals = state.savingsGoals.filter(function (g) { return g.id !== id; });
    showToast('Goal removed from cloud', 'warning');
    refreshAll();
}

function openAddSavingsModal(id) {
    document.getElementById('add-savings-modal').style.display = 'flex';
    document.getElementById('add-savings-id').value = id;
    document.getElementById('add-savings-amount').value = '';
}

function closeAddSavingsModal() {
    document.getElementById('add-savings-modal').style.display = 'none';
}

async function addToSavings(e) {
    e.preventDefault();
    var id = document.getElementById('add-savings-id').value;
    var amount = parseFloat(document.getElementById('add-savings-amount').value);
    var goal = state.savingsGoals.find(function (g) { return g.id === id; });
    if (goal) {
        var nextCurrent = Math.min(goal.target, goal.current + amount);
        try {
            await savingsGoalsCollectionRef().doc(goal.id).update({ current: nextCurrent });
        } catch (err) {
            console.error('Failed to update savings:', err);
            showToast('Failed to sync savings update', 'error');
            return;
        }
        goal.current = nextCurrent;
        if (goal.current >= goal.target) {
            addNotification('\uD83C\uDF89 Congratulations! You reached your "' + goal.name + '" savings goal!');
            showToast('\uD83C\uDF89 You reached your "' + goal.name + '" goal!', 'success');
        } else {
            showToast('Added ' + fmt(amount) + ' to ' + goal.name + ' and synced', 'success');
        }
        closeAddSavingsModal();
        refreshAll();
    }
}

function updateSavingsPage() {
    const totalSaved = state.savingsGoals.reduce(function (s, g) { return s + g.current; }, 0);
    const totalTarget = state.savingsGoals.reduce(function (s, g) { return s + g.target; }, 0);
    const totalPct = totalTarget > 0 ? Math.round((totalSaved / totalTarget) * 100) : 0;

    document.getElementById('savings-total-amount').textContent = fmt(totalSaved);
    document.getElementById('savings-total-target').textContent = fmt(totalTarget);
    document.getElementById('savings-total-progress').textContent = totalPct + '%';

    const container = document.getElementById('savings-goals-list');
    if (state.savingsGoals.length === 0) {
        container.innerHTML = '<div class="empty-state">' +
            '<i class="ri-safe-2-line"></i>' +
            '<h3>No Savings Goals</h3>' +
            '<p>Set a savings goal and start building your future!</p>' +
            '<button class="btn btn-primary" onclick="openSavingsModal()">Create First Goal</button>' +
            '</div>';
        return;
    }

    container.innerHTML = state.savingsGoals.map(function (g, i) {
        const pct = g.target > 0 ? Math.round((g.current / g.target) * 100) : 0;
        const ringColor = pct >= 100 ? 'var(--success)' : pct >= 50 ? '#6366f1' : 'var(--warning)';
        const deadlineStr = g.deadline ? 'Target: ' + fmtDate(g.deadline) : '';
        return '<div class="savings-goal-card" style="animation-delay:' + (i * 0.05) + 's">' +
            '<div class="sg-header">' +
            '<div class="sg-left">' +
            '<span class="sg-icon">' + (g.icon || '\u{1F3AF}') + '</span>' +
            '<div>' +
            '<div class="sg-name">' + escapeHtml(g.name) + '</div>' +
            '<div class="sg-deadline">' + deadlineStr + '</div>' +
            '</div>' +
            '</div>' +
            '<div class="sg-actions">' +
            '<button class="btn-icon btn-sm" onclick="openSavingsModal(\'' + g.id + '\')" title="Edit"><i class="ri-edit-line"></i></button>' +
            '<button class="btn-icon btn-sm" onclick="deleteSavingsGoal(\'' + g.id + '\')" title="Delete" style="color:var(--danger)"><i class="ri-delete-bin-line"></i></button>' +
            '</div>' +
            '</div>' +
            '<div class="sg-ring-container">' +
            '<div class="sg-ring">' +
            '<svg viewBox="0 0 36 36">' +
            '<path d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" fill="none" stroke="' + ringColor + '" stroke-width="2.5" stroke-dasharray="' + pct + ', 100" stroke-linecap="round"/>' +
            '<path d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" fill="none" stroke="var(--border)" stroke-width="2.5" stroke-dasharray="100, 100" opacity="0.2"/>' +
            '</svg>' +
            '<span>' + pct + '%</span>' +
            '</div>' +
            '<div class="sg-progress-info">' +
            '<div class="sg-saved">' + fmt(g.current) + '</div>' +
            '<div class="sg-target">of ' + fmt(g.target) + '</div>' +
            '</div>' +
            '</div>' +
            '<div class="sg-bar"><div class="sg-bar-fill" style="width:' + pct + '%"></div></div>' +
            '<button class="sg-add-btn" onclick="openAddSavingsModal(\'' + g.id + '\')">' +
            '<i class="ri-add-line"></i> Add Savings' +
            '</button>' +
            '</div>';
    }).join('');
}

// ============================================================
// ANALYTICS
// ============================================================
function updateAnalyticsPage() {
    updateCategoryChart();
    updateTrendChart();
    updateBudgetVsActualChart();
    updateInsights();
}

function getChartTextColor() {
    return getComputedStyle(document.documentElement).getPropertyValue('--text-muted').trim() || '#55566a';
}

function getChartGridColor() {
    return getComputedStyle(document.documentElement).getPropertyValue('--border').trim() || 'rgba(255,255,255,0.06)';
}

function updateCategoryChart() {
    const monthly = getMonthlyExpenses();
    const catTotals = {};
    monthly.forEach(function (e) { catTotals[e.category] = (catTotals[e.category] || 0) + e.amount; });
    const labels = Object.keys(catTotals).map(function (k) { return CATEGORIES[k] ? CATEGORIES[k].label : k; });
    const data = Object.values(catTotals);
    const colors = Object.keys(catTotals).map(function (k) { return CATEGORIES[k] ? CATEGORIES[k].color : '#64748b'; });

    if (charts.category) charts.category.destroy();
    const ctx = document.getElementById('analytics-category-chart');
    if (!ctx) return;

    if (data.length === 0) {
        charts.category = new Chart(ctx, {
            type: 'doughnut',
            data: { labels: ['No data'], datasets: [{ data: [1], backgroundColor: [getChartGridColor()], borderWidth: 0 }] },
            options: { responsive: true, maintainAspectRatio: false, cutout: '60%', plugins: { legend: { display: false }, tooltip: { enabled: false } }, animation: { duration: 400 } }
        });
        return;
    }

    charts.category = new Chart(ctx, {
        type: 'doughnut',
        data: { labels: labels, datasets: [{ data: data, backgroundColor: colors, borderWidth: 0, hoverOffset: 6 }] },
        options: {
            responsive: true, maintainAspectRatio: false, cutout: '60%',
            plugins: { legend: { position: 'bottom', labels: { padding: 12, usePointStyle: true, pointStyle: 'circle', font: { size: 11, family: 'Inter' }, color: getChartTextColor() } } },
            animation: { duration: 800 }
        }
    });
}

function updateTrendChart() {
    const months = [];
    const spending = [];
    for (let i = 5; i >= 0; i--) {
        const d = new Date();
        d.setMonth(d.getMonth() - i);
        const mk = getMonthKey(d);
        months.push(d.toLocaleDateString('en-US', { month: 'short' }));
        const total = state.expenses.filter(function (e) { return getMonthKey(new Date(e.date)) === mk; }).reduce(function (s, e) { return s + e.amount; }, 0);
        spending.push(total);
    }

    if (charts.trend) charts.trend.destroy();
    const ctx = document.getElementById('analytics-trend-chart');
    if (!ctx) return;
    charts.trend = new Chart(ctx, {
        type: 'line',
        data: {
            labels: months,
            datasets: [{
                label: 'Spending',
                data: spending,
                borderColor: '#c4f82a',
                backgroundColor: 'rgba(196,248,42,0.08)',
                fill: true,
                tension: 0.4,
                pointRadius: 4,
                pointHoverRadius: 6,
                pointBackgroundColor: '#c4f82a',
                borderWidth: 2
            }]
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            scales: {
                x: { grid: { display: false }, ticks: { font: { size: 11, family: 'Inter' }, color: getChartTextColor() } },
                y: { grid: { color: getChartGridColor() }, ticks: { font: { size: 11, family: 'Inter' }, color: getChartTextColor() } }
            },
            plugins: { legend: { display: false } },
            animation: { duration: 800 }
        }
    });
}

function updateBudgetVsActualChart() {
    const monthly = getMonthlyExpenses();

    if (charts.budgetVsActual) charts.budgetVsActual.destroy();
    const ctx = document.getElementById('analytics-budget-chart');
    if (!ctx) return;

    if (state.budgets.length === 0) {
        charts.budgetVsActual = new Chart(ctx, {
            type: 'bar',
            data: { labels: ['No budgets'], datasets: [{ label: 'Budget', data: [0], backgroundColor: [getChartGridColor()], borderWidth: 0 }] },
            options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { enabled: false } }, scales: { x: { display: false }, y: { display: false } }, animation: { duration: 400 } }
        });
        return;
    }

    const labels = state.budgets.map(function (b) { return CATEGORIES[b.category] ? CATEGORIES[b.category].label : b.category; });
    const budgetData = state.budgets.map(function (b) { return b.amount; });
    const actualData = state.budgets.map(function (b) {
        return monthly.filter(function (e) { return e.category === b.category; }).reduce(function (s, e) { return s + e.amount; }, 0);
    });
    charts.budgetVsActual = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [
                { label: 'Budget', data: budgetData, backgroundColor: 'rgba(196,248,42,0.15)', borderColor: '#c4f82a', borderWidth: 1.5, borderRadius: 6 },
                { label: 'Actual', data: actualData, backgroundColor: 'rgba(248,113,113,0.15)', borderColor: '#f87171', borderWidth: 1.5, borderRadius: 6 }
            ]
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            scales: {
                x: { grid: { display: false }, ticks: { font: { size: 11, family: 'Inter' }, color: getChartTextColor() } },
                y: { grid: { color: getChartGridColor() }, ticks: { font: { size: 11, family: 'Inter' }, color: getChartTextColor() } }
            },
            plugins: { legend: { position: 'bottom', labels: { padding: 12, usePointStyle: true, pointStyle: 'circle', font: { size: 11, family: 'Inter' }, color: getChartTextColor() } } },
            animation: { duration: 800 }
        }
    });
}

function updateInsights() {
    const container = document.getElementById('insights-list');
    const monthly = getMonthlyExpenses();
    const insights = [];

    if (monthly.length === 0) {
        container.innerHTML = '<p class="empty-state-sm">Add expenses to see smart insights</p>';
        return;
    }

    const totalSpent = monthly.reduce(function (s, e) { return s + e.amount; }, 0);
    const catTotals = {};
    monthly.forEach(function (e) { catTotals[e.category] = (catTotals[e.category] || 0) + e.amount; });

    const topCat = Object.entries(catTotals).sort(function (a, b) { return b[1] - a[1]; })[0];
    if (topCat) {
        const cat = CATEGORIES[topCat[0]] || CATEGORIES.other;
        insights.push({ icon: 'ri-fire-line', text: 'Your biggest spending category is <strong>' + cat.label + '</strong> at <strong>' + fmt(topCat[1]) + '</strong> (' + Math.round((topCat[1] / totalSpent) * 100) + '% of total).' });
    }

    const avgDaily = totalSpent / 30;
    insights.push({ icon: 'ri-calendar-line', text: 'Your average daily spending this month is <strong>' + fmt(avgDaily) + '</strong>.' });

    state.budgets.forEach(function (b) {
        const spent = catTotals[b.category] || 0;
        if (spent > b.amount) {
            const cat = CATEGORIES[b.category] || CATEGORIES.other;
            insights.push({ icon: 'ri-error-warning-line', text: 'You\'ve exceeded your <strong>' + cat.label + '</strong> budget by <strong>' + fmt(spent - b.amount) + '</strong>.' });
        }
    });

    const recurring = monthly.filter(function (e) { return e.recurring && e.recurring !== 'none'; });
    if (recurring.length > 0) {
        const recurringTotal = recurring.reduce(function (s, e) { return s + e.amount; }, 0);
        insights.push({ icon: 'ri-repeat-line', text: 'You have <strong>' + recurring.length + ' recurring expenses</strong> totaling <strong>' + fmt(recurringTotal) + '</strong> this month.' });
    }

    const smallest = monthly.reduce(function (min, e) { return e.amount < min.amount ? e : min; }, monthly[0]);
    const largest = monthly.reduce(function (max, e) { return e.amount > max.amount ? e : max; }, monthly[0]);
    insights.push({ icon: 'ri-contrast-2-line', text: 'Smallest expense: <strong>' + escapeHtml(smallest.description) + '</strong> (' + fmt(smallest.amount) + '). Largest: <strong>' + escapeHtml(largest.description) + '</strong> (' + fmt(largest.amount) + ').' });

    container.innerHTML = insights.map(function (ins) {
        return '<div class="insight-item"><i class="' + ins.icon + '"></i><p>' + ins.text + '</p></div>';
    }).join('');
}

function refreshAllCharts() {
    setTimeout(function () {
        updateDashChart();
        updateAnalyticsPage();
    }, 100);
}

// ============================================================
// BORROW & LEND
// ============================================================
function openDebtModal(id) {
    const modal = document.getElementById('debt-modal');
    modal.style.display = 'flex';
    document.getElementById('debt-edit-id').value = '';
    document.getElementById('debt-modal-title').textContent = 'Add Record';
    if (id) {
        const d = state.debts.find(function (d) { return d.id === id; });
        if (d) {
            document.getElementById('debt-edit-id').value = id;
            document.getElementById('debt-modal-title').textContent = 'Edit Record';
            document.getElementById('debt-person').value = d.person;
            document.getElementById('debt-amount').value = d.amount;
            document.getElementById('debt-date').value = d.date;
            document.getElementById('debt-due-date').value = d.dueDate || '';
            document.getElementById('debt-note').value = d.note || '';
            document.getElementById('debt-status').value = d.status || 'pending';
            document.querySelectorAll('input[name="debt-type"]').forEach(function (r) {
                r.checked = r.value === d.type;
            });
        }
    } else {
        document.getElementById('debt-person').value = '';
        document.getElementById('debt-amount').value = '';
        document.getElementById('debt-date').value = new Date().toISOString().split('T')[0];
        document.getElementById('debt-due-date').value = '';
        document.getElementById('debt-note').value = '';
        document.getElementById('debt-status').value = 'pending';
        document.querySelector('input[name="debt-type"][value="lent"]').checked = true;
    }
}

function closeDebtModal() {
    document.getElementById('debt-modal').style.display = 'none';
}

async function saveDebt(e) {
    e.preventDefault();

    var editId = document.getElementById('debt-edit-id').value;
    var isNew = !editId;
    var typeRadio = document.querySelector('input[name="debt-type"]:checked');

    var debt = {
        id: editId || generateId(),
        type: typeRadio ? typeRadio.value : 'lent',
        person: document.getElementById('debt-person').value.trim(),
        amount: parseFloat(document.getElementById('debt-amount').value),
        date: document.getElementById('debt-date').value,
        dueDate: document.getElementById('debt-due-date').value || null,
        note: document.getElementById('debt-note').value.trim(),
        status: document.getElementById('debt-status').value
    };

    closeDebtModal();

    const saved = await saveDebtToFirestore(debt, isNew);
    if (!saved) {
        showToast('Failed to sync debt record to cloud', 'error');
        return;
    }

    // local UI update without duplicate
    const existingIndex = state.debts.findIndex(function (d) {
        return d.id === debt.id;
    });

    if (existingIndex !== -1) {
        state.debts[existingIndex] = debt;
    } else {
        state.debts.push(debt);
    }

    updateDebtsPage();
    updateDashboard();

    showToast(isNew ? 'Record added and synced!' : 'Record updated and synced!', 'success');
}

async function deleteDebt(id) {
    if (!await deleteDebtFromFirestore(id)) return;

    state.debts = state.debts.filter(function (d) { return d.id !== id; });

    updateDebtsPage();
    updateDashboard();

    showToast('Record deleted from cloud', 'warning');
}

async function markDebtRepaid(id) {
    var debt = state.debts.find(function (d) { return d.id === id; });
    if (!debt) return;

    try {
        await debtsCollectionRef().doc(id).update({ status: 'repaid' });

        // local sync
        debt.status = 'repaid';

        updateDebtsPage();
        updateDashboard();

        showToast('Marked as repaid and synced!', 'success');
    } catch (err) {
        console.error('Failed to update debt status:', err);
        showToast('Failed to sync status update', 'error');
    }
}

function isOverdue(debt) {
    if (debt.status === 'repaid' || !debt.dueDate) return false;
    return new Date(debt.dueDate) < new Date(new Date().toDateString());
}

function isDueSoon(debt) {
    if (debt.status === 'repaid' || !debt.dueDate) return false;
    const due = new Date(debt.dueDate);
    const now = new Date();
    const diff = (due - now) / (1000 * 60 * 60 * 24);
    return diff >= 0 && diff <= 3;
}

function updateDebtsPage() {
    const typeFilter = document.getElementById('debt-filter-type') ? document.getElementById('debt-filter-type').value : 'all';
    const statusFilter = document.getElementById('debt-filter-status') ? document.getElementById('debt-filter-status').value : 'all';
    const searchVal = document.getElementById('debt-search') ? document.getElementById('debt-search').value.toLowerCase().trim() : '';

    const totalLent = state.debts.filter(function (d) { return d.type === 'lent'; }).reduce(function (s, d) { return s + d.amount; }, 0);
    const totalBorrowed = state.debts.filter(function (d) { return d.type === 'borrowed'; }).reduce(function (s, d) { return s + d.amount; }, 0);
    const pendingReceive = state.debts.filter(function (d) { return d.type === 'lent' && d.status === 'pending'; }).reduce(function (s, d) { return s + d.amount; }, 0);
    const pendingPay = state.debts.filter(function (d) { return d.type === 'borrowed' && d.status === 'pending'; }).reduce(function (s, d) { return s + d.amount; }, 0);

    document.getElementById('debt-total-lent').textContent = fmt(totalLent);
    document.getElementById('debt-total-borrowed').textContent = fmt(totalBorrowed);
    document.getElementById('debt-pending-receive').textContent = fmt(pendingReceive);
    document.getElementById('debt-pending-pay').textContent = fmt(pendingPay);

    let filtered = state.debts.slice();
    if (typeFilter !== 'all') filtered = filtered.filter(function (d) { return d.type === typeFilter; });
    if (statusFilter !== 'all') filtered = filtered.filter(function (d) { return d.status === statusFilter; });
    if (searchVal) filtered = filtered.filter(function (d) { return d.person.toLowerCase().indexOf(searchVal) !== -1; });
    filtered.sort(function (a, b) { return new Date(b.date) - new Date(a.date); });

    const list = document.getElementById('debts-list');
    if (filtered.length === 0) {
        list.innerHTML = '<div class="empty-state">' +
            '<i class="ri-exchange-line"></i>' +
            '<h3>No Records Found</h3>' +
            '<p>Track money you lend or borrow with friends!</p>' +
            '<button class="btn btn-primary" onclick="openDebtModal()">Add Record</button>' +
            '</div>';
        return;
    }

    list.innerHTML = filtered.map(function (d, i) {
        const isLent = d.type === 'lent';
        const overdue = isOverdue(d);
        const dueSoon = isDueSoon(d);
        const typeClass = isLent ? 'lent' : 'borrowed';
        const typeIcon = isLent ? 'ri-arrow-up-line' : 'ri-arrow-down-line';
        const typeLabel = isLent ? 'Lent' : 'Borrowed';
        const sign = isLent ? '+' : '-';

        let badges = '<span class="debt-badge type-' + typeClass + '">' + typeLabel + '</span>';
        if (d.status === 'repaid') {
            badges += '<span class="debt-badge repaid"><i class="ri-check-line"></i> Repaid</span>';
        } else {
            badges += '<span class="debt-badge pending"><i class="ri-time-line"></i> Pending</span>';
        }
        if (overdue) {
            badges += '<span class="debt-badge overdue"><i class="ri-alarm-warning-line"></i> Overdue</span>';
        } else if (dueSoon) {
            badges += '<span class="debt-badge due-soon"><i class="ri-time-line"></i> Due Soon</span>';
        }

        const dueDateStr = d.dueDate ? ' • Due: ' + fmtDate(d.dueDate) : '';
        const noteStr = d.note ? ' • ' + escapeHtml(d.note) : '';

        let actions = '';
        if (d.status === 'pending') {
            actions += '<button class="btn-icon btn-sm" onclick="markDebtRepaid(\'' + d.id + '\')" title="Mark Repaid" style="color:var(--success)"><i class="ri-check-line"></i></button>';
            actions += '<button class="btn-icon btn-sm" onclick="openDebtModal(\'' + d.id + '\')" title="Edit"><i class="ri-edit-line"></i></button>';
            actions += '<button class="btn-icon btn-sm" onclick="deleteDebt(\'' + d.id + '\')" title="Delete" style="color:var(--danger)"><i class="ri-delete-bin-line"></i></button>';
        }

        return '<div class="debt-item' + (overdue ? ' overdue' : '') + '" style="animation-delay:' + (i * 0.03) + 's">' +
            '<div class="debt-type-indicator ' + typeClass + '"><i class="' + typeIcon + '"></i></div>' +
            '<div class="debt-item-info">' +
            '<div class="debt-item-person">' + escapeHtml(d.person) + ' ' + badges + '</div>' +
            '<div class="debt-item-meta">' +
            '<span>' + fmtDate(d.date) + '</span>' +
            (d.dueDate ? '<span>' + dueDateStr + '</span>' : '') +
            (d.note ? '<span>' + noteStr + '</span>' : '') +
            '</div>' +
            '</div>' +
            '<span class="debt-item-amount ' + typeClass + '">' + sign + fmt(d.amount) + '</span>' +
            '<div class="debt-item-actions">' + actions + '</div>' +
            '</div>';
    }).join('');
}

// ============================================================
// GROUP EXPENSES (TRIP SPLIT)
// ============================================================
async function saveGroupToFirestore(group) {
    if (!state.uid) {
        showToast('Please sign in again to sync your data', 'error');
        return false;
    }
    try {
        await groupsCollectionRef().doc(group.id).set(group);
        return true;
    } catch (error) {
        console.error('Failed to save group:', error);
        showToast('Failed to sync group to cloud', 'error');
        return false;
    }
}

async function deleteGroupFromFirestore(id) {
    if (!state.uid) {
        showToast('Please sign in again to sync your data', 'error');
        return false;
    }
    try {
        await groupsCollectionRef().doc(id).delete();
        return true;
    } catch (error) {
        console.error('Failed to delete group:', error);
        showToast('Failed to sync deletion', 'error');
        return false;
    }
}

function openGroupModal(id) {
    const modal = document.getElementById('group-modal');
    modal.style.display = 'flex';
    document.getElementById('group-edit-id').value = '';
    document.getElementById('group-modal-title').textContent = 'Create Group';
    if (id) {
        const g = state.groups.find(function (g) { return g.id === id; });
        if (g) {
            document.getElementById('group-edit-id').value = id;
            document.getElementById('group-modal-title').textContent = 'Edit Group';
            document.getElementById('group-name').value = g.name;
            document.getElementById('group-members').value = g.members.join(', ');
        }
    } else {
        document.getElementById('group-name').value = '';
        document.getElementById('group-members').value = '';
    }
}

function closeGroupModal() {
    document.getElementById('group-modal').style.display = 'none';
}

async function saveGroup(e) {
    e.preventDefault();

    var editId = document.getElementById('group-edit-id').value;
    var isNew = !editId;

    var name = document.getElementById('group-name').value.trim();
    var memberInputs = document.querySelectorAll('.group-member-input');

    var members = Array.from(memberInputs)
        .map(function (input) { return input.value.trim(); })
        .filter(function (name) { return name.length > 0; });

    var group = {
        id: editId || generateId(),
        name: name,
        members: members,
        expenses: editId
            ? (state.groups.find(function (g) { return g.id === editId; })?.expenses || [])
            : []
    };

    closeGroupModal();

    const saved = await saveGroupToFirestore(group, isNew);
    if (!saved) {
        showToast('Failed to sync group to cloud', 'error');
        return;
    }

    showToast(isNew ? 'Group created and synced!' : 'Group updated and synced!', 'success');
}

async function deleteGroup(id) {
    if (!confirm('Delete this group and all its expenses?')) return;
    if (!await deleteGroupFromFirestore(id)) return;
    state.groups = state.groups.filter(function (g) { return g.id !== id; });
    showToast('Group deleted from cloud', 'warning');
    currentGroupId = null;
    updateGroupPage();
}

function viewGroup(id) {
    currentGroupId = id;
    updateGroupPage();
}

function backToGroupList() {
    currentGroupId = null;
    updateGroupPage();
}

function openGroupExpenseModal(groupId, expenseId) {
    const group = state.groups.find(function (g) { return g.id === groupId; });
    if (!group) return;
    const modal = document.getElementById('group-expense-modal');
    modal.style.display = 'flex';
    document.getElementById('group-expense-group-id').value = groupId;
    document.getElementById('group-expense-edit-id').value = '';
    document.getElementById('group-expense-modal-title').textContent = 'Add Expense';
    const paidBySelect = document.getElementById('group-expense-paidby');
    paidBySelect.innerHTML = '<option value="">Select member</option>' +
        group.members.map(function (m) { return '<option value="' + escapeHtml(m) + '">' + escapeHtml(m) + '</option>'; }).join('');
    if (expenseId) {
        const exp = group.expenses.find(function (ex) { return ex.id === expenseId; });
        if (exp) {
            document.getElementById('group-expense-edit-id').value = expenseId;
            document.getElementById('group-expense-modal-title').textContent = 'Edit Expense';
            document.getElementById('group-expense-desc').value = exp.description;
            document.getElementById('group-expense-amount').value = exp.amount;
            paidBySelect.value = exp.paidBy;
            document.getElementById('group-expense-date').value = exp.date || '';
        }
    } else {
        document.getElementById('group-expense-desc').value = '';
        document.getElementById('group-expense-amount').value = '';
        document.getElementById('group-expense-date').value = new Date().toISOString().split('T')[0];
    }
}

function closeGroupExpenseModal() {
    document.getElementById('group-expense-modal').style.display = 'none';
}

async function saveGroupExpense(e) {
    e.preventDefault();

    var groupId = document.getElementById('group-expense-group-id').value;
    var editId = document.getElementById('group-expense-edit-id').value;
    var group = state.groups.find(function (g) { return g.id === groupId; });

    if (!group) {
        showToast('Group not found', 'error');
        return;
    }

    var expense = {
        id: editId || generateId(),
        description: document.getElementById('group-expense-desc').value.trim(),
        amount: parseFloat(document.getElementById('group-expense-amount').value),
        paidBy: document.getElementById('group-expense-paidby').value,
        date: document.getElementById('group-expense-date').value || new Date().toISOString().split('T')[0]
    };

    var nextExpenses = editId
        ? group.expenses.map(function (ex) { return ex.id === editId ? expense : ex; })
        : group.expenses.concat([expense]);

    var nextGroup = {
        id: group.id,
        name: group.name,
        members: group.members.slice(),
        expenses: nextExpenses
    };

    if (!await saveGroupToFirestore(nextGroup)) {
        showToast('Failed to sync expense to cloud', 'error');
        return;
    }

    group.expenses = nextExpenses;

    if (editId) {
        showToast('Expense updated and synced!', 'success');
    } else {
        showToast('Expense added and synced!', 'success');
    }

    closeGroupExpenseModal();
    updateGroupPage();
}

async function deleteGroupExpense(groupId, expenseId) {
    var group = state.groups.find(function (g) { return g.id === groupId; });
    if (!group) return;
    var nextGroup = {
        id: group.id,
        name: group.name,
        members: group.members.slice(),
        expenses: group.expenses.filter(function (ex) { return ex.id !== expenseId; })
    };
    if (!await saveGroupToFirestore(nextGroup)) return;
    group.expenses = nextGroup.expenses;
    showToast('Expense deleted from cloud', 'warning');
    updateGroupPage();
}

function calculateGroupBalances(group) {
    const totalExpense = group.expenses.reduce(function (s, e) { return s + e.amount; }, 0);
    const numMembers = group.members.length;
    const perPerson = numMembers > 0 ? totalExpense / numMembers : 0;
    const paidByMember = {};
    group.members.forEach(function (m) { paidByMember[m] = 0; });
    group.expenses.forEach(function (e) {
        if (paidByMember[e.paidBy] !== undefined) {
            paidByMember[e.paidBy] += e.amount;
        }
    });
    const balances = {};
    group.members.forEach(function (m) {
        balances[m] = paidByMember[m] - perPerson;
    });
    return { totalExpense: totalExpense, perPerson: perPerson, paidByMember: paidByMember, balances: balances };
}

function calculateSettlement(balances) {
    const creditors = [];
    const debtors = [];
    Object.keys(balances).forEach(function (name) {
        const b = Math.round(balances[name] * 100) / 100;
        if (b > 0.01) creditors.push({ name: name, amount: b });
        else if (b < -0.01) debtors.push({ name: name, amount: -b });
    });
    creditors.sort(function (a, b) { return b.amount - a.amount; });
    debtors.sort(function (a, b) { return b.amount - a.amount; });
    const transactions = [];
    let i = 0, j = 0;
    while (i < debtors.length && j < creditors.length) {
        const pay = Math.min(debtors[i].amount, creditors[j].amount);
        if (pay > 0.01) {
            transactions.push({
                from: debtors[i].name,
                to: creditors[j].name,
                amount: Math.round(pay * 100) / 100
            });
        }
        debtors[i].amount = Math.round((debtors[i].amount - pay) * 100) / 100;
        creditors[j].amount = Math.round((creditors[j].amount - pay) * 100) / 100;
        if (debtors[i].amount < 0.01) i++;
        if (creditors[j].amount < 0.01) j++;
    }
    return transactions;
}

function updateGroupPage() {
    const listContainer = document.getElementById('group-list');
    const detailContainer = document.getElementById('group-detail');
    if (currentGroupId) {
        listContainer.style.display = 'none';
        detailContainer.style.display = 'block';
        renderGroupDetail(currentGroupId);
    } else {
        listContainer.style.display = 'grid';
        detailContainer.style.display = 'none';
        renderGroupList();
    }
}

function renderGroupList() {
    const container = document.getElementById('group-list');
    if (state.groups.length === 0) {
        container.innerHTML = '<div class="empty-state">' +
            '<i class="ri-team-line"></i>' +
            '<h3>No Groups Yet</h3>' +
            '<p>Create a group to start splitting expenses with friends!</p>' +
            '<button class="btn btn-primary" onclick="openGroupModal()">Create First Group</button>' +
            '</div>';
        return;
    }
    container.innerHTML = state.groups.map(function (g, i) {
        const calc = calculateGroupBalances(g);
        const memberChips = g.members.slice(0, 4).map(function (m) {
            return '<span class="group-member-chip">' + escapeHtml(m) + '</span>';
        }).join('');
        const extraCount = g.members.length > 4 ? '<span class="group-member-chip">+' + (g.members.length - 4) + ' more</span>' : '';
        return '<div class="group-card" style="animation-delay:' + (i * 0.05) + 's" onclick="viewGroup(\'' + g.id + '\')">' +
            '<div class="group-card-header">' +
            '<div class="group-card-name">' + escapeHtml(g.name) + '</div>' +
            '<div class="group-card-actions" onclick="event.stopPropagation()">' +
            '<button class="btn-icon btn-sm" onclick="openGroupModal(\'' + g.id + '\')" title="Edit"><i class="ri-edit-line"></i></button>' +
            '<button class="btn-icon btn-sm" onclick="deleteGroup(\'' + g.id + '\')" title="Delete" style="color:var(--danger)"><i class="ri-delete-bin-line"></i></button>' +
            '</div>' +
            '</div>' +
            '<div class="group-card-members">' + memberChips + extraCount + '</div>' +
            '<div class="group-card-stats">' +
            '<div class="group-card-stat"><span class="group-card-stat-label">Total</span><span class="group-card-stat-value">' + fmt(calc.totalExpense) + '</span></div>' +
            '<div class="group-card-stat"><span class="group-card-stat-label">Per Person</span><span class="group-card-stat-value">' + fmt(calc.perPerson) + '</span></div>' +
            '<div class="group-card-stat"><span class="group-card-stat-label">Expenses</span><span class="group-card-stat-value">' + g.expenses.length + '</span></div>' +
            '</div>' +
            '</div>';
    }).join('');
}

function renderGroupDetail(groupId) {
    const group = state.groups.find(function (g) { return g.id === groupId; });
    if (!group) {
        currentGroupId = null;
        updateGroupPage();
        return;
    }
    const calc = calculateGroupBalances(group);
    const settlement = calculateSettlement(calc.balances);
    const container = document.getElementById('group-detail');
    let html = '<button class="group-detail-back" onclick="backToGroupList()">' +
        '<i class="ri-arrow-left-s-line"></i> Back to Groups</button>' +
        '<div class="group-detail-title">' + escapeHtml(group.name) + '</div>';
    html += '<div class="group-overview-cards">' +
        '<div class="group-overview-card total-card" style="animation-delay:0s">' +
        '<span class="group-overview-label">Total Expense</span>' +
        '<span class="group-overview-value">' + fmt(calc.totalExpense) + '</span>' +
        '</div>' +
        '<div class="group-overview-card perperson-card" style="animation-delay:0.05s">' +
        '<span class="group-overview-label">Per Person</span>' +
        '<span class="group-overview-value">' + fmt(calc.perPerson) + '</span>' +
        '</div>' +
        '<div class="group-overview-card count-card" style="animation-delay:0.1s">' +
        '<span class="group-overview-label">Members</span>' +
        '<span class="group-overview-value">' + group.members.length + '</span>' +
        '</div>' +
        '</div>';
    html += '<div class="group-section-header"><h3>Member Balances</h3></div>';
    html += '<div class="group-balances-grid">';
    group.members.forEach(function (m, i) {
        const paid = calc.paidByMember[m] || 0;
        const balance = calc.balances[m];
        let avatarClass = 'settled';
        let balanceClass = 'settled';
        let balanceText = 'Settled';
        if (balance > 0.01) {
            avatarClass = 'positive';
            balanceClass = 'positive';
            balanceText = 'Gets back ' + fmt(balance);
        } else if (balance < -0.01) {
            avatarClass = 'negative';
            balanceClass = 'negative';
            balanceText = 'Owes ' + fmt(-balance);
        }
        html += '<div class="group-balance-card" style="animation-delay:' + (i * 0.04) + 's">' +
            '<div class="group-balance-avatar ' + avatarClass + '">' + escapeHtml(m.charAt(0).toUpperCase()) + '</div>' +
            '<div class="group-balance-info">' +
            '<div class="group-balance-name">' + escapeHtml(m) + '</div>' +
            '<div class="group-balance-paid">Paid: ' + fmt(paid) + '</div>' +
            '</div>' +
            '<span class="group-balance-amount ' + balanceClass + '">' + balanceText + '</span>' +
            '</div>';
    });
    html += '</div>';
    html += '<div class="group-section-header"><h3>Expenses</h3>' +
        '<button class="btn btn-primary btn-sm" onclick="openGroupExpenseModal(\'' + group.id + '\')">' +
        '<i class="ri-add-line"></i> Add Expense</button></div>';
    if (group.expenses.length === 0) {
        html += '<div class="group-no-expenses">No expenses added yet. Click "Add Expense" to get started.</div>';
    } else {
        html += '<div class="group-expenses-list">';
        var sortedExpenses = group.expenses.slice().sort(function (a, b) {
            return new Date(b.date || 0) - new Date(a.date || 0);
        });
        sortedExpenses.forEach(function (ex, i) {
            html += '<div class="group-expense-item" style="animation-delay:' + (i * 0.03) + 's">' +
                '<div class="group-expense-icon"><i class="ri-money-dollar-circle-line"></i></div>' +
                '<div class="group-expense-info">' +
                '<div class="group-expense-desc">' + escapeHtml(ex.description || 'Unnamed') + '</div>' +
                '<div class="group-expense-meta">' +
                '<span>Paid by: ' + escapeHtml(ex.paidBy) + '</span>' +
                (ex.date ? '<span>' + fmtDate(ex.date) + '</span>' : '') +
                '</div>' +
                '</div>' +
                '<span class="group-expense-amount">' + fmt(ex.amount) + '</span>' +
                '<div class="group-expense-actions">' +
                '<button class="btn-icon btn-sm" onclick="openGroupExpenseModal(\'' + group.id + '\',\'' + ex.id + '\')" title="Edit"><i class="ri-edit-line"></i></button>' +
                '<button class="btn-icon btn-sm" onclick="deleteGroupExpense(\'' + group.id + '\',\'' + ex.id + '\')" title="Delete" style="color:var(--danger)"><i class="ri-delete-bin-line"></i></button>' +
                '</div>' +
                '</div>';
        });
        html += '</div>';
    }
    html += '<div class="group-settlement-section">';
    html += '<div class="group-settlement-title"><i class="ri-arrow-left-right-line"></i> Settlement</div>';
    if (settlement.length === 0) {
        html += '<div class="group-settlement-done"><i class="ri-check-double-line"></i> All settled up! No payments needed.</div>';
    } else {
        html += '<div class="group-settlement-list">';
        settlement.forEach(function (t, i) {
            html += '<div class="group-settlement-item" style="animation-delay:' + (i * 0.05) + 's">' +
                '<span class="group-settlement-from">' + escapeHtml(t.from) + '</span>' +
                '<i class="ri-arrow-right-line group-settlement-arrow"></i>' +
                '<span class="group-settlement-to">' + escapeHtml(t.to) + '</span>' +
                '<span class="group-settlement-amount">' + fmt(t.amount) + '</span>' +
                '</div>';
        });
        html += '</div>';
    }
    html += '</div>';
    container.innerHTML = html;
}

// ============================================================
// INIT - Firebase Auth handles the session automatically
// ============================================================
let legacyAppInitialized = false;

function bindModalOverlays() {
    document.querySelectorAll('.modal-overlay').forEach(function (overlay) {
        if ((overlay as any).dataset.bound === 'true') return;
        overlay.addEventListener('click', function (e) {
            if (e.target === this) {
                (this as HTMLElement).style.display = 'none';
            }
        });
        (overlay as any).dataset.bound = 'true';
    });
}

function registerGlobalActions() {
    Object.assign(window, {
        showAuth,
        closeAuth,
        handleGoogleSignIn,
        logout,
        toggleSidebar,
        navigateTo,
        toggleTheme,
        changeCurrency,
        toggleNotifications,
        clearNotifications,
        openExpenseModal,
        closeExpenseModal,
        saveExpense,
        deleteExpense,
        filterExpenses,
        updateDashChart,
        openBudgetModal,
        closeBudgetModal,
        saveBudget,
        deleteBudget,
        changeBudgetMonth,
        openSavingsModal,
        closeSavingsModal,
        saveSavingsGoal,
        deleteSavingsGoal,
        openAddSavingsModal,
        closeAddSavingsModal,
        addToSavings,
        openDebtModal,
        closeDebtModal,
        saveDebt,
        deleteDebt,
        markDebtRepaid,
        updateDebtsPage,
        openGroupModal,
        closeGroupModal,
        saveGroup,
        deleteGroup,
        viewGroup,
        backToGroupList,
        openGroupExpenseModal,
        closeGroupExpenseModal,
        saveGroupExpense,
        deleteGroupExpense,
    });
}

export function initializeLegacyApp() {
    registerGlobalActions();
    bindModalOverlays();

    if (!legacyAppInitialized) {
        legacyAppInitialized = true;
        updateThemeIcon();
    }
}
// ============================================================
// SAFE INIT + EVENT BINDINGS
// Paste this at the very bottom of src/legacy/legacyApp.ts
// ============================================================

let __legacyBindingsAttached = false;

function bindFormById(id, handler, name) {
    const form = document.getElementById(id);
    if (!form) {
        console.error(name + ' not found:', id);
        return;
    }

    if (form.dataset.bound === 'true') {
        console.log(name + ' already bound:', id);
        return;
    }

    form.addEventListener('submit', function (e) {
        console.log(name + ' submit triggered');
        handler(e);
    });

    form.dataset.bound = 'true';
    console.log(name + ' listener attached:', id);
}

function bindClickById(id, handler, name) {
    const el = document.getElementById(id);
    if (!el) {
        console.warn(name + ' not found:', id);
        return;
    }

    if (el.dataset.bound === 'true') {
        console.log(name + ' already bound:', id);
        return;
    }

    el.addEventListener('click', function (e) {
        console.log(name + ' click triggered');
        handler(e);
    });

    el.dataset.bound = 'true';
    console.log(name + ' listener attached:', id);
}

function bindChangeById(id, handler, name) {
    const el = document.getElementById(id);
    if (!el) {
        console.warn(name + ' not found:', id);
        return;
    }

    if (el.dataset.bound === 'true') {
        console.log(name + ' already bound:', id);
        return;
    }

    el.addEventListener('change', function (e) {
        console.log(name + ' change triggered');
        handler(e);
    });

    el.dataset.bound = 'true';
    console.log(name + ' listener attached:', id);
}

function attachGlobalFunctions() {
    window.handleGoogleSignIn = handleGoogleSignIn;
    window.logout = logout;
    window.openExpenseModal = openExpenseModal;
    window.closeExpenseModal = closeExpenseModal;
    window.deleteExpense = deleteExpense;
    window.filterExpenses = filterExpenses;

    window.openBudgetModal = openBudgetModal;
    window.closeBudgetModal = closeBudgetModal;
    window.deleteBudget = deleteBudget;
    window.changeBudgetMonth = changeBudgetMonth;

    window.openSavingsModal = openSavingsModal;
    window.closeSavingsModal = closeSavingsModal;
    window.deleteSavingsGoal = deleteSavingsGoal;
    window.openAddSavingsModal = openAddSavingsModal;
    window.closeAddSavingsModal = closeAddSavingsModal;

    window.openDebtModal = openDebtModal;
    window.closeDebtModal = closeDebtModal;
    window.deleteDebt = deleteDebt;
    window.markDebtRepaid = markDebtRepaid;

    window.openGroupModal = openGroupModal;
    window.closeGroupModal = closeGroupModal;
    window.saveGroup = saveGroup;
    window.deleteGroup = deleteGroup;
    window.viewGroup = viewGroup;
    window.backToGroupList = backToGroupList;

    window.openGroupExpenseModal = openGroupExpenseModal;
    window.closeGroupExpenseModal = closeGroupExpenseModal;
    window.saveGroupExpense = saveGroupExpense;
    window.navigateTo = navigateTo;
    window.toggleTheme = toggleTheme;
    window.toggleSidebar = toggleSidebar;
    window.toggleNotifications = toggleNotifications;
    window.clearNotifications = clearNotifications;

    console.log('Global window functions attached');
}

function bindCoreEventListeners() {
    if (__legacyBindingsAttached) {
        console.log('Core bindings already attached');
        return;
    }

    console.log('bindCoreEventListeners() started');

    attachGlobalFunctions();

    bindFormById('expense-form', saveExpense, 'expense-form');
    bindFormById('budget-form', saveBudget, 'budget-form');
    bindFormById('savings-form', saveSavingsGoal, 'savings-form');
    bindFormById('add-savings-form', addToSavings, 'add-savings-form');
    bindFormById('debt-form', saveDebt, 'debt-form');
    bindFormById('group-form', saveGroup, 'group-form');
    bindFormById('group-expense-form', saveGroupExpense, 'group-expense-form');

    bindChangeById('currency-select', function (e) {
        changeCurrency(e.target.value);
    }, 'currency-select');

    bindClickById('theme-toggle', function () {
        toggleTheme();
    }, 'theme-toggle');

    bindClickById('logout-btn', function () {
        logout();
    }, 'logout-btn');

    bindClickById('notif-clear-btn', function () {
        clearNotifications();
    }, 'notif-clear-btn');

    __legacyBindingsAttached = true;
    console.log('bindCoreEventListeners() completed');
}
