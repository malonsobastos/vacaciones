// Configuración Firebase (tu proyecto)
const firebaseConfig = {
    apiKey: "AIzaSyBC5COixZJoJ8R2F-bkh1dJWbzrJxF6tSM",
    authDomain: "vacaciones-cb19a.firebaseapp.com",
    projectId: "vacaciones-cb19a",
    storageBucket: "vacaciones-cb19a.firebasestorage.app",
    messagingSenderId: "29021000684",
    appId: "1:29021000684:web:a23907829e18e671ee26c9"
};

// Festivos 2026 (Vigo)
const HOLIDAYS_2026 = [
    '2026-01-01','2026-01-06','2026-04-02','2026-04-03',
    '2026-05-01','2026-07-25','2026-08-15','2026-10-12',
    '2026-11-01','2026-12-06','2026-12-08','2026-12-25',
    '2026-08-16'
];

// Estado global
let currentUser = null;
let selectedRanges = [];
let allUsers = [];
let isSaving = false;

// Cache DOM
const DOM = {
    loginScreen: document.getElementById('login-screen'),
    mainScreen: document.getElementById('main-screen'),
    header: document.getElementById('header'),
    loginForm: document.getElementById('login-form'),
    loginInput: document.getElementById('login'),
    loginError: document.getElementById('login-error'),
    userNameSpan: document.getElementById('user-name'),
    welcomeNameSpan: document.getElementById('welcome-name'),
    instructionsText: document.getElementById('instructions-text'),
    calendarElement: document.getElementById('calendar'),
    saveBtn: document.getElementById('save-btn'),
    logoutBtn: document.getElementById('logout-btn'),
    floatingActions: document.getElementById('floating-actions'),
    successDialog: document.getElementById('success-dialog'),
    errorDialog: document.getElementById('error-dialog'),
    confirmDialog: document.getElementById('confirm-dialog'),
    confirmText: document.getElementById('confirm-text'),
    errorMessage: document.getElementById('error-message'),
    loadingOverlay: document.getElementById('loading-overlay'),
    colorLegend: document.getElementById('color-legend'),
    debugTable: null
};

// Inicialización
document.addEventListener('DOMContentLoaded', () => {
    firebase.initializeApp(firebaseConfig);
    const db = firebase.firestore();

    if (window.componentHandler) {
        window.componentHandler.upgradeAllRegistered();
        const spinner = DOM.loadingOverlay.querySelector('.mdl-spinner');
        if (spinner) window.componentHandler.upgradeElement(spinner);
    }

    DOM.loginForm.addEventListener('submit', e => handleLogin(e, db));
    DOM.saveBtn.addEventListener('click', showConfirmDialog);
    DOM.logoutBtn.addEventListener('click', handleLogout);

    ['close', 'confirm-cancel'].forEach(cls =>
        document.querySelectorAll(`.${cls}`).forEach(btn =>
            btn.addEventListener('click', () => btn.closest('dialog').close())
        )
    );
    document.querySelector('.confirm-save').addEventListener('click', () => saveVacations(db));
    
    document.addEventListener('keydown', e => {
        if (e.key === 'Escape') {
            DOM.successDialog.close();
            DOM.errorDialog.close();
            DOM.confirmDialog.close();
        }
    });

    const legend = document.getElementById('color-legend');
    if (legend) {
        const div = document.createElement('div');
        div.id = 'debug-table-container';
        legend.parentNode.insertBefore(div, legend.nextSibling);
        DOM.debugTable = div;
    }
});

// Bloqueo UI
function toggleLock(lock) {
    isSaving = lock;
    DOM.saveBtn.disabled = lock || !selectedRanges.length;
    DOM.logoutBtn.disabled = lock;
    document.querySelectorAll('input, button').forEach(el => el.disabled = lock);
    document.querySelectorAll('.day.selectable').forEach(el => {
        el.style.pointerEvents = lock ? 'none' : 'auto';
        el.style.opacity = lock ? '0.6' : '1';
    });
    DOM.loadingOverlay.style.display = lock ? 'flex' : 'none';
}

// Login: solo login (5 alfanuméricos)
async function handleLogin(e, db) {
    e.preventDefault();
    if (isSaving) return;
    toggleLock(true);
    DOM.loginError.style.display = 'none';

    const login = DOM.loginInput.value.trim().toUpperCase();
    if (!/^[A-Z0-9]{5}$/.test(login)) {
        DOM.loginError.textContent = 'Login debe ser 5 caracteres alfanuméricos mayúsculas';
        DOM.loginError.style.display = 'block';
        toggleLock(false);
        return;
    }

    try {
        const doc = await db.collection('empleados').doc(login).get();
        if (!doc.exists) throw new Error('Usuario no encontrado');
        currentUser = { login, ...doc.data() };
        if (currentUser.tipo === undefined) currentUser.tipo = 1;

        const groupPromises = [ 
            db.collection('empleados').where('grupo', '==', currentUser.grupo).get()
        ];
        if (currentUser.subgrupo && currentUser.subgrupo.length > 0) {
            groupPromises.push(
                db.collection('empleados').where('grupo', '==', currentUser.subgrupo).get()
            );
        }

        const groupSnaps = await Promise.all(groupPromises);
        const users = new Map();
        groupSnaps.forEach(snap =>
            snap.docs.forEach(doc => {
                if (doc.id !== login) users.set(doc.id, { login: doc.id, ...doc.data() });
            })
        );
        allUsers = Array.from(users.values());

        showMainScreen();
    } catch (err) {
        DOM.loginError.textContent = err.message || 'Error de conexión';
        DOM.loginError.style.display = 'block';
    } finally {
        toggleLock(false);
    }
}

// Mostrar interfaz principal
function showMainScreen() {
    DOM.loginScreen.style.display = 'none';
    DOM.mainScreen.style.display = 'block';
    DOM.header.style.display = 'block';
    DOM.floatingActions.style.display = 'flex';
    DOM.userNameSpan.textContent = currentUser.nombre;
    DOM.welcomeNameSpan.textContent = currentUser.nombre;
    DOM.instructionsText.innerHTML = currentUser.tipo === 1
        ? `Selecciona un <strong>lunes o sábado</strong> para iniciar una quincena (15 días + festivos contiguos). Máximo 2.`
        : `Selecciona <strong>lunes o sábado no festivo</strong> o alternativo festivo para marcar una semana (7 días desde el día pulsado y festivos/domingos pegados). Máximo 4.`;
    
    renderLegend();
    renderDebugTable();
    loadPendingSelections();
    generateCalendar();
}

// Leyenda de colores
function renderLegend() {
    const $legend = DOM.colorLegend || document.getElementById('color-legend');
    if (!$legend) return;
    $legend.innerHTML = `
        <div class="color-item">
            <span class="color-box" style="background: var(--selectable);"></span>
            <span>Día seleccionable</span>
        </div>
        <div class="color-item">
            <span class="color-box" style="background: var(--selected);"></span>
            <span>Dias seleccionados no guardados</span>
        </div>
        <div class="color-item">
            <span class="color-box" style="background: var(--saved);"></span>
            <span>Vacaciones guardadas</span>
        </div>
        <div class="color-item">
            <span class="color-box" style="background: var(--holiday);"></span>
            <span>Festivo</span>
        </div>
        <div class="color-item">
            <span class="color-box" style="background: var(--occupied);"></span>
            <span>Vacaciones de otro usuario</span>
        </div>
        <div class="color-item">
            <span class="color-box" style="background: var(--blocked);"></span>
            <span>Día bloqueado por solapamiento</span>
        </div>
    `;
}

// Tabla debug con el título y solo los usuarios relevantes
function renderDebugTable() {
    if (!DOM.debugTable) return;
    let html = `<h4 style="font-size:1.07em;color:#888;margin-top:18px;margin-bottom:7px;">Debug No puede coincidir con :</h4>
    <table style="width:100%;border-collapse:collapse;margin-top:0;font-size:0.95em">
        <thead style="background:#eee">
            <tr>
                <th style="border-bottom:1px solid #bbb;padding:4px 8px">Nombre</th>
                <th style="border-bottom:1px solid #bbb;padding:4px 8px">Empresa</th>
                <th style="border-bottom:1px solid #bbb;padding:4px 8px">Grupo</th>
            </tr>
        </thead>
        <tbody>
    `;
    allUsers.forEach(u => {
        html += `<tr>
            <td style="border-bottom:1px solid #ddd;padding:2px 8px">${u.nombre || u.login}</td>
            <td style="border-bottom:1px solid #ddd;padding:2px 8px">${u.empresa || ''}</td>
            <td style="border-bottom:1px solid #ddd;padding:2px 8px">${u.grupo || ''}</td>
        </tr>`;
    });
    html += "</tbody></table>";
    DOM.debugTable.innerHTML = html;
}

// Logout
function handleLogout() {
    currentUser = null; selectedRanges = [];
    allUsers = [];
    DOM.header.style.display = 'none';
    DOM.mainScreen.style.display = 'none';
    DOM.loginScreen.style.display = 'block';
    DOM.loginInput.value = '';
    DOM.loginError.style.display = 'none';
    if (DOM.debugTable) DOM.debugTable.innerHTML = '';
}

// Generar calendario
function generateCalendar() {
    DOM.calendarElement.innerHTML = '';
    for (let m = 0; m < 12; m++) DOM.calendarElement.appendChild(createMonth(m));
}

// Mes
function createMonth(month) {
    const el = document.createElement('div');
    el.className = 'month';
    const monthName = new Date(2026, month).toLocaleDateString('es-ES', { month: 'long' });
    el.innerHTML = `<div class="month-header">${monthName.charAt(0).toUpperCase() + monthName.slice(1)}</div>
                    <div class="weekdays">${['Lu','Ma','Mi','Ju','Vi','Sá','Do'].map(d => `<div class="weekday">${d}</div>`).join('')}</div>
                    <div class="days"></div>`;
    const daysEl = el.querySelector('.days');
    const first = new Date(2026, month, 1);
    const offset = (first.getDay() || 7) - 1;
    for (let i = 0; i < offset; i++) {
        const d = new Date(first); d.setDate(d.getDate() - (offset - i));
        daysEl.appendChild(createDay(d, true));
    }
    for (let d = 1; d <= new Date(2026, month + 1, 0).getDate(); d++) {
        daysEl.appendChild(createDay(new Date(2026, month, d)));
    }
    return el;
}

// Día
function createDay(date, isOtherMonth = false) {
    const ds = fmt(date), el = document.createElement('div');
    el.className = `day${isOtherMonth ? ' other-month' : ''}`;
    el.textContent = date.getDate();
    el.dataset.date = ds;

    const isHol = HOLIDAYS_2026.includes(ds);
    const isSun = date.getDay() === 0;
    const isSaved = isInAnyRange(ds, currentUser);
    const isOccupied = !isSaved && isOccupiedForCurrent(ds);
    const isSelected = selectedRanges.some(([start, end]) => {
        const days = rangeDays(start, end);
        return days.includes(ds);
    });
    const isSelectable = !isSaved && !isOccupied && isSelectableDay(date);
    const isBlocked = isSelectable && wouldOverlap(date);

    if (isOtherMonth) {
        el.style.visibility = 'hidden';
        el.style.pointerEvents = 'none';
        return el;
    }

    if (isSaved) {
        el.classList.add('saved');
    } else if (isSelected) {
        el.classList.add('selected');
        el.addEventListener('click', () => removeSelection(ds));
    }
    if (isHol) el.classList.add('holiday');
    else if (isSun) el.classList.add('sunday');
    if (isOccupied && !isSaved) el.classList.add('occupied');
    if (isBlocked) el.classList.add('blocked');
    if (isSelectable && !isBlocked && !isSelected && !isSaved) {
        el.classList.add('selectable');
        el.addEventListener('click', () => toggleSelection(date));
    }
    return el;
}

// Solo los relevantes para el grupo y subgrupo actual
function isOccupiedForCurrent(ds) {
    return allUsers.some(u => isInAnyRange(ds, u));
}

// Toggle para selección/rango según tipo
function toggleSelection(date) {
    const prevRanges = getCurrentSavedRanges();

    if (currentUser.tipo === 1) {
        if (prevRanges.length >= 2) return;
        const r = createQuincenaRange(date);
        if (!r) return;
        if (selectedRanges.length && selectedRanges[0][0] === r[0]) return;
        selectedRanges = [r];
    } else if (currentUser.tipo === 2) {
        if (prevRanges.length >= 4) return;
        const r = createWeekRange(date);
        if (!r) return;
        const idx = selectedRanges.findIndex(x => x[0] === r[0]);
        if (idx >= 0) selectedRanges.splice(idx, 1);
        else if (selectedRanges.length < (4-prevRanges.length) && !wouldOverlapRange(r)) selectedRanges.push(r);
    }
    generateCalendar();
}

// Eliminar selección actual clicando sobre un día seleccionado
function removeSelection(ds) {
    const idx = selectedRanges.findIndex(([start, end]) => {
        const days = rangeDays(start, end);
        return days.includes(ds);
    });
    if (idx !== -1) {
        selectedRanges.splice(idx, 1);
        generateCalendar();
    }
}

// Helpers rápidos
const fmt = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
const getMonday = d => new Date(d.getFullYear(), d.getMonth(), d.getDate() - (d.getDay() || 7) + 1);
const rangeDays = (start, end) => {
    const s = new Date(start), e = new Date(end), days = [];
    while (s <= e) { days.push(fmt(s)); s.setDate(s.getDate() + 1); }
    return days;
};

// Obtiene las vacaciones guardadas de BD del usuario actual
function getCurrentSavedRanges() {
    const ranges = [];
    for (let i = 1; i <= 4; i++) {
        const start = currentUser[`per${i}start`], end = currentUser[`per${i}end`];
        if (start && end) ranges.push([start, end]);
    }
    return ranges;
}

// Rango quincena
const createQuincenaRange = (start) => {
    if (!isValidQuincenaStart(start)) return null;
    const end = calcRangeEnd(start, 14);
    return [fmt(start), fmt(end)];
};

// Rango semana
const createWeekRange = (date) => {
    if (!isValidWeekStart(date)) return null;
    let start = new Date(date);
    let end = new Date(start); end.setDate(end.getDate() + 6);
    let next = new Date(end); next.setDate(next.getDate() + 1);
    while (HOLIDAYS_2026.includes(fmt(next)) || next.getDay() === 0) {
        end = next;
        next = new Date(end); next.setDate(next.getDate() + 1);
    }
    return [fmt(start), fmt(end)];
};

// Extensión genérica para rango
function calcRangeEnd(start, baseDays) {
    let end = new Date(start); end.setDate(end.getDate() + baseDays);
    let next = new Date(end); next.setDate(next.getDate() + 1);
    while (HOLIDAYS_2026.includes(fmt(next)) || next.getDay() === 0) {
        end = next;
        next = new Date(end); next.setDate(next.getDate() + 1);
    }
    return end;
}

// Inicio válido quincena
function isValidQuincenaStart(date) {
    const w = date.getDay();
    return w === 1 || w === 6 || isAltForHoliday(date);
}

// Inicio válido semana
function isValidWeekStart(date) {
    const w = date.getDay();
    if ((w === 1 || w === 6) && !HOLIDAYS_2026.includes(fmt(date))) return true;
    return isAltForHoliday(date);
}

// Día seleccionable según tipo y lo que tiene guardado
function isSelectableDay(date) {
    if (!currentUser) return false;
    if (currentUser.tipo === 1) {
        const guardadas = getCurrentSavedRanges();
        if (guardadas.length >= 2) return false;
        return isValidQuincenaStart(date);
    } else {
        const guardadas = getCurrentSavedRanges();
        if (guardadas.length >= 4) return false;
        return isValidWeekStart(date);
    }
}

// Alternativo inicio festivo
function isAltForHoliday(date) {
    const w = date.getDay();
    if (w < 2 || w > 5) return false;
    const mon = new Date(date); mon.setDate(date.getDate() - (w - 1));
    if (!HOLIDAYS_2026.includes(fmt(mon))) return false;
    for (let d = 1; d < w; d++) {
        const dd = new Date(date); dd.setDate(dd.getDate() - (w - d));
        if (!HOLIDAYS_2026.includes(fmt(dd))) return false;
    }
    return true;
}

// Helpers de rango
function isInAnyRange(ds, user) {
    for (let i = 1; i <= 4; i++) {
        const s = user[`per${i}start`], e = user[`per${i}end`];
        if (s && e && ds >= s && ds <= e) return true;
    }
    return false;
}

// Solapamiento
function wouldOverlap(date) {
    if (currentUser.tipo === 1) {
        const r = createQuincenaRange(date);
        if (!r) return true;
        return wouldOverlapRange(r);
    } else {
        const r = createWeekRange(date);
        if (!r) return true;
        return wouldOverlapRange(r);
    }
}
function wouldOverlapRange([s1, e1]) {
    const start1 = new Date(s1), end1 = new Date(e1);
    const users = [currentUser, ...allUsers];
    for (const u of users) {
        for (let i = 1; i <= 4; i++) {
            const s2 = u[`per${i}start`] , e2 = u[`per${i}end`];
            if (!s2 || !e2) continue;
            const start2 = new Date(s2), end2 = new Date(e2);
            if (!(end1 < start2 || start1 > end2)) return true;
        }
    }
    return false;
}

// Confirmar
function showConfirmDialog() {
    const prevRanges = getCurrentSavedRanges();
    const allRanges = [...prevRanges, ...selectedRanges].slice(0, currentUser.tipo === 1 ? 2 : 4);
    const periods = allRanges.map(([s,e]) => `${s} → ${e}`).join('<br>');
    DOM.confirmText.innerHTML = `¿Confirmar?<br><small>${periods}</small>`;
    DOM.confirmDialog.showModal();
}

// Guardar en Firestore
async function saveVacations(db) {
    DOM.confirmDialog.close();
    if (!selectedRanges.length || isSaving) return;
    toggleLock(true);
    try {
        const prevRanges = getCurrentSavedRanges();
        let allRanges = [...prevRanges];

        selectedRanges.forEach(sr => {
            const existe = allRanges.some(([s, e]) => sr[0] === s && sr[1] === e);
            if (!existe) allRanges.push(sr);
        });
        allRanges = allRanges.slice(0, currentUser.tipo === 1 ? 2 : 4);

        const updates = {};
        allRanges.forEach(([start, end], i) => {
            updates[`per${i+1}start`] = start;
            updates[`per${i+1}end`] = end;
        });
        for (let i = allRanges.length + 1; i <= 4; i++) {
            updates[`per${i}start`] = firebase.firestore.FieldValue.delete();
            updates[`per${i}end`] = firebase.firestore.FieldValue.delete();
        }
        await db.collection('empleados').doc(currentUser.login).update(updates);

        const doc = await db.collection('empleados').doc(currentUser.login).get();
        currentUser = { login: currentUser.login, ...doc.data() };
        if (currentUser.tipo === undefined) currentUser.tipo = 1;

        selectedRanges = [];
        DOM.successDialog.showModal();
        generateCalendar();
        renderDebugTable();
    } catch (err) {
        DOM.errorMessage.textContent = err.message || 'Error al guardar';
        DOM.errorDialog.showModal();
    } finally {
        toggleLock(false);
    }
}

// Cargar selecciones ya guardadas al login
function loadPendingSelections() {
    selectedRanges = [];
}
