/**
 * 班級作業登記系統 - 主應用入口與生命週期調度 (Application Bootstrap)
 */

import {
    auth,
    db,
    coll,
    settingsRef,
    archivesColl,
    gradingColl,
    isAuthorized,
    loginWithEmail,
    loginWithGoogle,
    logout,
    saveSettings,
    clearAll,
    clearRecordsForAssignment,
    clearGradingForAssignment,
    ORDER_FIELD,
    ORDER_DIR,
    LOGIN_MODE
} from './services/firebase.js';

import {
    todayStr,
    todayISODate,
    isSchoolDay,
    sortBySeat,
    isPulledOut,
    badgeClass,
    signClass,
    escapeHtml
} from './domain/rules.js';

import { logger, initGlobalErrorMonitoring } from './utils/logger.js';
import { showAlert, closeAlert, askInput, askConfirm } from './ui/modals.js';
import { renderPublic } from './ui/publicForm.js';
import { renderRecordsTab } from './ui/recordsTab.js';
import { renderContactTab, setContactViewMode } from './ui/contactTab.js';
import { renderGradingTab, setGradingViewMode } from './ui/gradingTab.js';
import { renderStudentsTab } from './ui/studentsTab.js';

import {
    onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import {
    onSnapshot,
    query,
    orderBy,
    getDocs,
    doc,
    setDoc,
    addDoc,
    deleteDoc,
    writeBatch
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

const $ = id => document.getElementById(id);

// 全域應用狀態
let isAdmin = false;
let editorReady = false;
let settingsArrived = false;
let recordsArrived = true;
let gateSettingsFailed = false;
let settingsErrored = false;
let recordsErrored = false;

let records = [];
let gradingRecords = [];
let settings = { groups: [], students: [], subjects: [], assignments: [], semester: {} };

const appState = {
    archiveDocsMap: {},
    extraPastAssignments: {}
};

let stopRecordsListener = null;
let stopGradingListener = null;

const DAILY_FIXED_ASSIGNMENTS = [
    { name: '聯絡簿每日任務', needsSign: true }
];

function refreshLoadError() {
    const bad = settingsErrored || recordsErrored;
    const el = document.getElementById('loadError');
    if (bad && !el) {
        const d = document.createElement('div');
        d.id = 'loadError';
        d.textContent = '載入失敗，請重新整理頁面';
        d.style.cssText = 'position:fixed;bottom:16px;left:50%;transform:translateX(-50%);background:var(--danger);color:#fff;padding:10px 18px;border-radius:10px;z-index:2000;font-size:0.95em';
        document.body.appendChild(d);
    }
    if (!bad && el) el.remove();
}

let readyTimer = setTimeout(markReady, 8000);
function markReady() {
    clearTimeout(readyTimer);
    document.body.classList.add("ready");
}
function gateCheck() {
    if (settingsArrived || gateSettingsFailed) markReady();
}

function ensureDailyAssignments(st) {
    if (!st || !Array.isArray(st.subjects) || !Array.isArray(st.assignments)) return;
    let changed = false;
    let contactSubj = st.subjects.find(s => s.name === '聯絡簿');
    if (!contactSubj) {
        contactSubj = { id: crypto.randomUUID(), name: '聯絡簿', isSystem: true };
        st.subjects = [...st.subjects, contactSubj];
        changed = true;
    }
    const today = todayISODate();
    const schoolDay = isSchoolDay(today, st.semester);
    DAILY_FIXED_ASSIGNMENTS.forEach(fixed => {
        const existing = st.assignments.find(a => a.name === fixed.name);
        if (!existing) {
            st.assignments.push({ id: `daily-${fixed.name}-${today}`, name: fixed.name, subjectId: contactSubj.id, needsSign: fixed.needsSign });
            changed = true;
            return;
        }
        if (!schoolDay) return;
        const todayPrefix = `daily-${fixed.name}-${today}`;
        if (!existing.id.startsWith(todayPrefix)) {
            st.assignments = st.assignments.filter(a => a.name !== fixed.name);
            st.assignments.push({ id: todayPrefix, name: fixed.name, subjectId: contactSubj.id, needsSign: fixed.needsSign });
            changed = true;
        }
    });
    if (changed && isAdmin) {
        saveSettings({ assignments: st.assignments, subjects: st.subjects }, isAdmin);
    }
}

export async function autoLoadArchives() {
    try {
        const snap = await getDocs(query(archivesColl, orderBy('timestamp', 'desc')));
        appState.extraPastAssignments = appState.extraPastAssignments || {};
        appState.archiveDocsMap = appState.archiveDocsMap || {};
        const currentIds = new Set(settings && settings.assignments ? settings.assignments.map(a => a.id) : []);
        snap.docs.forEach(d => {
            const data = d.data();
            data._id = d.id;
            appState.archiveDocsMap[d.id] = data;
            const dateLabel = data.dateLabel || new Date(data.timestamp).toLocaleDateString('zh-TW');
            (data.assignments || []).forEach(a => {
                appState.archiveDocsMap[a.id] = data;
                if (!currentIds.has(a.id) && !appState.extraPastAssignments[a.id]) {
                    appState.extraPastAssignments[a.id] = {
                        name: a.name,
                        dateLabel,
                        subjectName: a.subjectName || '未分類',
                        needsSign: !!a.needsSign,
                        signOnly: !!a.signOnly
                    };
                }
            });
        });
        renderGradingTab(gradingRecords, records, settings, appState);
        renderArchivesList();
    } catch (e) {
        logger.warn('AUTO_LOAD_ARCHIVES_FAILED', e);
    }
}

async function renderArchivesList() {
    const archivesListEl = $('archivesList');
    if (!archivesListEl) return;
    archivesListEl.innerHTML = '<p class="empty-hint">載入中…</p>';
    try {
        const snap = await getDocs(query(archivesColl, orderBy('timestamp', 'desc')));
        const list = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        archivesListEl.innerHTML = list.length ? list.map(a => `
            <div class="group-block" data-archive="${escapeHtml(a.id)}">
                <div class="group-block-head">
                    <strong>${escapeHtml(a.dateLabel || new Date(a.timestamp).toLocaleDateString('zh-TW'))}</strong>
                    <div class="archive-actions">
                        <button class="btn small outline" data-view-archive="${escapeHtml(a.id)}">查看內容</button>
                        <button class="btn small outline" data-restore-archive="${escapeHtml(a.id)}">還原成可編輯</button>
                        <button class="btn small outline danger" data-del-archive="${escapeHtml(a.id)}">刪除</button>
                    </div>
                </div>
                <p class="empty-hint" style="text-align:left;padding:0">封存時間：${new Date(a.timestamp).toLocaleString('zh-TW')}｜${a.assignmentCount || 0} 份作業、${a.studentCount || 0} 位學生</p>
                <div class="table-scroll archive-detail" data-detail="${escapeHtml(a.id)}" style="display:none"></div>
            </div>`).join('') : '<p class="empty-hint">尚無歷史封存紀錄</p>';

        function renderArchiveDetail(item) {
            const box = archivesListEl.querySelector(`[data-detail="${item.id}"]`);
            if (!box) return;

            const headerHtml = `<div style="display: grid; grid-template-columns: 110px 170px 140px 140px 1fr; align-items: center; gap: 12px; padding: 8px 0; border-bottom: 2px solid var(--line); font-weight: bold; color: #000; font-size: 0.95em; text-align: left;">
                <span>學生</span>
                <span>作業</span>
                <span>狀態</span>
                <span>簽名</span>
                <span>備註</span>
            </div>`;

            box.innerHTML = `<div style="display:flex;flex-direction:column;gap:4px;min-width:680px;">` + headerHtml +
                (item.records || []).map((r, i) => {
                    const asg = (item.assignments || []).find(x => x.id === r.assignmentId);
                    const needsSign = asg && (asg.needsSign || asg.signOnly);
                    const isSignOnly = asg && asg.signOnly;
                    const isSigned = r.signStatus === '已簽名';
                    const isExamOrTest = asg && (asg.name.includes('卷') || asg.name.includes('考') || asg.name.includes('聽') || asg.name.includes('測驗'));
                    const showSign = needsSign && (isSignOnly || isExamOrTest || r.status === '已繳');
                    const signDisplay = (r.signStatus || '未簽名') === '未簽名' ? '未簽' : ((r.signStatus || '已簽名') === '已簽名' ? '已簽' : r.signStatus);

                    const statusBtn = `<button type="button" class="cell-status-btn ${badgeClass(r.status)}" data-arch-status="${i}">${escapeHtml(r.status)}</button>`;
                    const makeupBtn = r.status !== '已繳' ? `<button class="btn small outline" data-makeup="${i}">補交</button>` : `<button class="btn small outline" style="visibility:hidden;pointer-events:none;">補交</button>`;

                    let statusCol = '';
                    if (r.pulledOut) {
                        statusCol = `<div style="display:flex;gap:6px;align-items:center;justify-content:flex-start;"><button type="button" class="cell-status-btn" style="background:transparent; color:var(--muted); font-weight:bold; pointer-events:none; box-shadow:none;">抽離</button><button class="btn small outline" style="visibility:hidden;pointer-events:none;">補交</button></div>`;
                    } else {
                        statusCol = `<div style="display:flex;gap:6px;align-items:center;justify-content:flex-start;">${statusBtn}${makeupBtn}</div>`;
                    }

                    let signCol = '';
                    if (needsSign && !r.pulledOut) {
                        const signBtn = `<button type="button" class="cell-status-btn cell-sign-btn ${signClass(r.signStatus || '未簽名')}" data-arch-sign="${i}" style="visibility:${showSign ? 'visible' : 'hidden'};pointer-events:${showSign ? 'auto' : 'none'}">${escapeHtml(signDisplay)}</button>`;
                        const makeupSignBtn = (!isSigned && showSign) ? `<button class="btn small outline" data-makeup-sign="${i}">補簽</button>` : `<button class="btn small outline" style="visibility:hidden;pointer-events:none;">補簽</button>`;
                        signCol = `<div style="display:flex;gap:6px;align-items:center;justify-content:flex-start;">${signBtn}${makeupSignBtn}</div>`;
                    } else {
                        signCol = `<div style="display:flex;gap:6px;align-items:center;justify-content:flex-start;visibility:hidden;pointer-events:none;"><button type="button" class="cell-status-btn">已簽</button><button class="btn small outline">補簽</button></div>`;
                    }

                    return `<div style="display: grid; grid-template-columns: 110px 170px 140px 140px 1fr; align-items: center; gap: 12px; padding: 8px 0; border-bottom: 1px solid var(--line);">
                        <span class="student-name" style="font-size:1em; color:#000; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${escapeHtml(r.studentName)}</span>
                        <span style="font-size:0.95em; color:#000; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${escapeHtml(r.assignmentName)}</span>
                        ${statusCol}
                        ${signCol}
                        <span class="row-slot-remark" style="font-size:0.85em; color:var(--muted); text-align: left; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${escapeHtml(r.remark || '')}</span>
                    </div>`;
                }).join('') + `</div>`;

            box.querySelectorAll('[data-makeup]').forEach(btn => {
                btn.onclick = async () => {
                    const idx = Number(btn.getAttribute('data-makeup'));
                    const r = item.records[idx];
                    const timeStr = new Date().toLocaleString('zh-TW', { hour12: false });
                    const remarkText = r.remark ? `${r.remark} / 已補交（${timeStr}）` : `已補交（${timeStr}）`;
                    const updatedRecords = item.records.map((r2, i2) => i2 === idx ? { ...r2, status: '已繳', remark: remarkText } : r2);
                    item.records = updatedRecords;
                    await setDoc(doc(db, 'archives', item.id), { records: updatedRecords }, { merge: true }).catch(e => logger.warn('UPDATE_ARCHIVE_FAILED', e));
                    renderArchiveDetail(item);
                };
            });

            box.querySelectorAll('[data-makeup-sign]').forEach(btn => {
                btn.onclick = async () => {
                    const idx = Number(btn.getAttribute('data-makeup-sign'));
                    const r = item.records[idx];
                    const timeStr = new Date().toLocaleString('zh-TW', { hour12: false });
                    const remarkText = r.remark ? `${r.remark} / 補簽（${timeStr}）` : `已補簽（${timeStr}）`;
                    const updatedRecords = item.records.map((r2, i2) => i2 === idx ? { ...r2, signStatus: '已簽名', remark: remarkText } : r2);
                    item.records = updatedRecords;
                    await setDoc(doc(db, 'archives', item.id), { records: updatedRecords }, { merge: true }).catch(e => logger.warn('UPDATE_ARCHIVE_FAILED', e));
                    renderArchiveDetail(item);
                };
            });

            box.querySelectorAll('[data-arch-status]').forEach(btn => {
                btn.onclick = async () => {
                    const idx = Number(btn.getAttribute('data-arch-status'));
                    const cur = item.records[idx];
                    const nv = cur.status === '已繳' ? '未繳' : '已繳';
                    const timeStr = new Date().toLocaleString('zh-TW', { hour12: false });
                    const remarkText = nv === '已繳' ? `狀態改已繳（${timeStr}）` : cur.remark;
                    const updatedRecords = item.records.map((r, i2) => i2 === idx ? { ...r, status: nv, signStatus: nv === '已繳' ? (r.signStatus || '未簽名') : '未簽名', remark: remarkText } : r);
                    item.records = updatedRecords;
                    await setDoc(doc(db, 'archives', item.id), { records: updatedRecords }, { merge: true }).catch(e => logger.warn('UPDATE_ARCHIVE_FAILED', e));
                    renderArchiveDetail(item);
                };
            });

            box.querySelectorAll('[data-arch-sign]').forEach(btn => {
                btn.onclick = async () => {
                    const idx = Number(btn.getAttribute('data-arch-sign'));
                    const cur = item.records[idx];
                    const nv = (cur.signStatus === '已簽名') ? '未簽名' : '已簽名';
                    const timeStr = new Date().toLocaleString('zh-TW', { hour12: false });
                    const remarkText = nv === '已簽名' ? (cur.remark ? `${cur.remark} / 補簽（${timeStr}）` : `已補簽（${timeStr}）`) : cur.remark;
                    const updatedRecords = item.records.map((r, i2) => i2 === idx ? { ...r, signStatus: nv, remark: remarkText } : r);
                    item.records = updatedRecords;
                    await setDoc(doc(db, 'archives', item.id), { records: updatedRecords }, { merge: true }).catch(e => logger.warn('UPDATE_ARCHIVE_FAILED', e));
                    renderArchiveDetail(item);
                };
            });
        }

        archivesListEl.querySelectorAll('[data-view-archive]').forEach(b => {
            b.onclick = () => {
                const aid = b.getAttribute('data-view-archive');
                const item = list.find(x => x.id === aid);
                const box = archivesListEl.querySelector(`[data-detail="${aid}"]`);
                if (box.style.display === 'block') { box.style.display = 'none'; return; }
                renderArchiveDetail(item);
                box.style.display = 'block';
            };
        });

        archivesListEl.querySelectorAll('[data-restore-archive]').forEach(b => {
            b.onclick = async () => {
                const aid = b.getAttribute('data-restore-archive');
                const item = list.find(x => x.id === aid);
                if (!item) return;
                const label = item.dateLabel || new Date(item.timestamp).toLocaleDateString('zh-TW');
                const ok2 = await askConfirm(`把「${label}」這筆封存快照的繳交/訂正狀態寫回活資料嗎？`);
                if (!ok2) return;
                const recBatch = writeBatch(db);
                const gradeBatch = writeBatch(db);
                (item.records || []).forEach(r => {
                    if (r.pulledOut) return;
                    const ref = doc(coll, `${r.studentId}_${r.assignmentId}`);
                    const payload = {
                        groupId: '', groupName: '',
                        studentId: r.studentId, studentName: r.studentName,
                        subjectId: '', subjectName: '',
                        assignmentId: r.assignmentId, assignmentName: r.assignmentName,
                        status: r.status || '未繳',
                        [ORDER_FIELD]: Date.now()
                    };
                    if (r.signStatus) payload.signStatus = r.signStatus;
                    recBatch.set(ref, payload, { merge: true });
                    if (r.correctness !== undefined) {
                        const gref = doc(gradingColl, `${r.studentId}_${r.assignmentId}`);
                        gradeBatch.set(gref, {
                            studentId: r.studentId, studentName: r.studentName,
                            assignmentId: r.assignmentId, assignmentName: r.assignmentName,
                            correctness: r.correctness || '', corrected: !!r.corrected,
                            updatedAt: Date.now()
                        }, { merge: true });
                    }
                });
                await recBatch.commit().catch(e => logger.warn('RESTORE_RECORDS_FAILED', e));
                await gradeBatch.commit().catch(e => logger.warn('RESTORE_GRADING_FAILED', e));
                showAlert(`已還原「${label}」`);
            };
        });

        archivesListEl.querySelectorAll('[data-del-archive]').forEach(b => {
            b.onclick = async () => {
                const aid = b.getAttribute('data-del-archive');
                const item = list.find(x => x.id === aid);
                const label = item ? (item.dateLabel || new Date(item.timestamp).toLocaleDateString('zh-TW')) : '';
                const ok2 = await askConfirm(`確定刪除「${label}」嗎？`);
                if (!ok2) return;
                await deleteDoc(doc(db, 'archives', aid)).catch(e => { logger.warn('DELETE_ARCHIVE_FAILED', e); showAlert('刪除失敗'); });
                const idsToClean = (item && item.assignments) ? item.assignments.map(a => a.id) : [];
                for (const gid of idsToClean) {
                    await clearGradingForAssignment(gid);
                    await clearRecordsForAssignment(gid);
                    if (appState.extraPastAssignments) delete appState.extraPastAssignments[gid];
                }
                renderArchivesList();
            };
        });
    } catch (e) {
        logger.warn('LOAD_ARCHIVES_FAILED', e);
        archivesListEl.innerHTML = '<p class="empty-hint">載入失敗</p>';
    }
}

function startRecordsListener() {
    if (stopRecordsListener) return;
    recordsArrived = false;
    stopRecordsListener = onSnapshot(query(coll, orderBy(ORDER_FIELD, ORDER_DIR)), snap => {
        records = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        recordsArrived = true;
        recordsErrored = false;
        refreshLoadError();
        renderRecordsTab(records, settings, isAdmin);
        renderGradingTab(gradingRecords, records, settings, appState);
        renderContactTab(records, gradingRecords, settings, isAdmin);
    }, err => {
        logger.warn('RECORDS_LISTENER_ERROR', err);
        recordsArrived = true;
        recordsErrored = true;
        refreshLoadError();
    });
}

function stopRecordsListenerIfAny() {
    if (stopRecordsListener) {
        stopRecordsListener();
        stopRecordsListener = null;
    }
    records = [];
    recordsArrived = true;
}

function startGradingListener() {
    if (stopGradingListener) return;
    stopGradingListener = onSnapshot(gradingColl, snap => {
        gradingRecords = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        renderGradingTab(gradingRecords, records, settings, appState);
        renderContactTab(records, gradingRecords, settings, isAdmin);
    }, err => logger.warn('GRADING_LISTENER_ERROR', err));
}

function stopGradingListenerIfAny() {
    if (stopGradingListener) {
        stopGradingListener();
        stopGradingListener = null;
    }
    gradingRecords = [];
}

function loadEditor() {
    $('adminArea').innerHTML = `
        <div class="admin-tabs">
            <button class="tab-btn active" data-tab="tabRecords">查看繳交紀錄</button>
            <button class="tab-btn" data-tab="tabContact">聯絡簿</button>
            <button class="tab-btn" data-tab="tabGrading">訂正與加點</button>
            <button class="tab-btn" data-tab="tabStudents">學生管理</button>
        </div>
        <div id="tabRecords" class="tab-panel">
            <div class="card">
                <div class="row">
                    <div class="subject-select-group">
                        <select id="quickAssignmentSubject" style="max-width:160px"></select>
                        <button type="button" id="renameSubjectBtn" class="icon-btn" title="修改選取科目的名稱" style="width:26px;height:26px">
                            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>
                        </button>
                        <button type="button" id="deleteSubjectBtn" class="icon-btn" title="刪除選取的科目" style="width:26px;height:26px;background:var(--danger)">
                            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>
                        </button>
                    </div>
                    <input id="quickAssignmentName" class="txt-input" placeholder="新增今日作業，例如：數學習作 P.26-28">
                    <div style="display:flex;flex-direction:column;gap:4px;justify-content:center;">
                        <label style="display:flex;align-items:center;gap:6px;white-space:nowrap;font-size:0.9em;color:var(--muted);margin:0">
                            <input type="checkbox" id="quickAssignmentNeedsSign" style="width:auto">需要簽名
                        </label>
                        <label style="display:flex;align-items:center;gap:6px;white-space:nowrap;font-size:0.9em;color:var(--muted);margin:0">
                            <input type="checkbox" id="quickAssignmentSignOnly" style="width:auto">只要簽名
                        </label>
                    </div>
                    <button class="btn" id="quickAddAssignmentBtn">＋ 新增作業</button>
                    <button class="btn outline" id="copyMissingBtn">複製未繳名單</button>
                </div>
            </div>
            <div class="card">
                <div id="statCards" class="stat-cards"></div>
            </div>
            <div class="side-by-side">
                <div class="card">
                    <h2>今日作業管理</h2>
                    <div id="assignmentMgmtList"></div>
                </div>
                <div class="card">
                    <h2>今日快速結算</h2>
                    <p class="empty-hint" style="text-align:left;padding:0 0 14px">點擊結束並封存時，可以自由勾選要保留到明天的作業。</p>
                    <div class="row" style="flex-direction:column">
                        <button class="btn outline" id="archiveBtn">結束並封存...</button>
                        <button class="btn outline danger" id="deleteNoArchiveBtn">確定完成，直接刪除（不封存）</button>
                    </div>
                </div>
            </div>
            <div class="card">
                <h2>繳交狀態一覽（依座號排序）</h2>
                <div class="table-scroll">
                    <table>
                        <thead id="matrixThead"></thead>
                        <tbody id="matrixTbody"></tbody>
                    </table>
                </div>
                <p id="matrixEmpty" class="empty-hint" style="display:none"></p>
            </div>
            <div class="card">
                <h2>歷史封存紀錄</h2>
                <button class="btn outline" id="loadArchivesBtn">重新整理歷史封存</button>
                <div id="archivesList" style="margin-top:14px"></div>
            </div>
        </div>
        <div id="tabContact" class="tab-panel" style="display:none">
            <div class="card">
                <div id="contactStatCards" class="stat-cards" style="grid-template-columns:repeat(4,1fr)"></div>
            </div>
            <div class="card">
                <h2>聯絡簿每日批改</h2>
                <p class="empty-hint" style="text-align:left;padding:0 0 10px">一位學生一排，繳交／簽名／批改一次點完。</p>
                <div class="row" style="margin-bottom:14px">
                    <button class="btn small" id="contactViewSeatBtn">依座號</button>
                    <button class="btn small outline" id="contactViewGroupBtn">依小組</button>
                </div>
                <div id="dailyQuickGradeList"></div>
            </div>
            <div class="card">
                <h2>結束今日並封存</h2>
                <p class="empty-hint" style="text-align:left;padding:0 0 10px">把今天的聯絡簿狀態存成正式的歷史封存紀錄。</p>
                <button class="btn outline" id="archiveContactBtn">結束今日並封存</button>
            </div>
        </div>
        <div id="tabGrading" class="tab-panel" style="display:none">
            <div class="card">
                <div class="row" style="margin-bottom:14px">
                    <button class="btn outline" id="globalMissingListBtn">未繳清單</button>
                    <button class="btn outline" id="globalUncorrectedListBtn">未訂正清單</button>
                    <button class="btn outline" id="globalUnsignedListBtn">未簽名清單</button>
                    <button class="btn outline" id="globalLostListBtn">遺失作業清單</button>
                </div>
            </div>
            <div class="card">
                <h2>作業對錯與訂正 <button class="btn small outline" id="toggleGradeMatrixBtn" style="margin-left:8px;font-weight:normal">收合</button></h2>
                <div id="gradingViewModeRow"></div>
                <div id="gradeMatrixBody">
                    <p class="empty-hint" style="text-align:left;padding:0 0 10px">紅框＝缺交。已繳的作業可以點選：✓全對／▲有錯／✗遺失。</p>
                    <div class="table-scroll">
                        <table>
                            <thead id="gradeThead"></thead>
                            <tbody id="gradeTbody"></tbody>
                        </table>
                    </div>
                    <p id="gradeEmpty" class="empty-hint" style="display:none"></p>
                </div>
            </div>
            <div class="card">
                <h2>已封存作業的訂正紀錄 <button class="btn small outline" id="toggleArchivedGradingBtn" style="margin-left:8px;font-weight:normal">展開</button></h2>
                <p class="empty-hint" style="text-align:left;padding:0 0 10px">這裡可以選一份過去的作業繼續批改。</p>
                <div id="archivedGradingBody" style="display:none">
                    <div class="row" style="margin-bottom:10px">
                        <select id="pastSubjectSelect" style="flex:1"></select>
                        <select id="pastAssignmentSelect" style="flex:1"></select>
                        <button class="btn outline" id="loadPastArchivesBtn">重新整理歷史作業</button>
                        <button class="btn outline danger" id="deleteSelectedPastBtn">刪除選取的這筆</button>
                    </div>
                    <div id="pastAssignmentGradeList"></div>
                </div>
            </div>
            <div class="card">
                <h2>加點</h2>
                <p class="empty-hint" style="text-align:left;padding:0 0 10px">選學生後按「計算並加點」。</p>
                <div class="row">
                    <select id="pointsStudentSelect" style="flex:1"></select>
                    <button class="btn" id="calcPointsBtn">計算並加點</button>
                </div>
                <div id="pointsResult" style="margin-top:14px"></div>
            </div>
            <div class="card">
                <h2>加點紀錄匯出</h2>
                <div class="row">
                    <button class="btn outline" id="loadPointLogsBtn">載入加點紀錄</button>
                    <button class="btn outline" id="exportTodayPointsBtn">匯出今天的加點紀錄</button>
                </div>
                <div id="pointLogsList" style="margin-top:14px"></div>
            </div>
        </div>
        <div id="tabStudents" class="tab-panel" style="display:none">
            <div class="card">
                <h2>學期設定</h2>
                <div class="date-range-row">
                    <div class="field"><label>開學日</label><input type="date" id="semStartDate" class="txt-input"></div>
                    <div class="field"><label>結業日</label><input type="date" id="semEndDate" class="txt-input"></div>
                </div>
                <label style="display:flex;align-items:center;gap:6px;margin-bottom:14px">
                    <input type="checkbox" id="skipWeekendsChk" style="width:auto" checked>週六、週日不算上課日
                </label>
                <div class="row inline-add-row">
                    <input type="date" id="newHolidayDate" class="txt-input">
                    <button class="btn" id="addHolidayBtn">新增假日</button>
                </div>
                <div id="holidayList" class="chip-list"></div>
            </div>
            <div class="card">
                <h2>學生管理</h2>
                <div class="row inline-add-row">
                    <input id="newGroupName" class="txt-input" placeholder="新增組別名稱，例如：第一組">
                    <button class="btn" id="addGroupBtn">新增組別</button>
                </div>
                <div id="groupsList"></div>
            </div>
        </div>`;

    // 頁籤切換
    $('adminArea').querySelectorAll('.tab-btn').forEach(btn => {
        btn.onclick = () => {
            $('adminArea').querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b === btn));
            $('adminArea').querySelectorAll('.tab-panel').forEach(p => p.style.display = (p.id === btn.dataset.tab) ? 'block' : 'none');
        };
    });

    // 折疊按鈕
    $('toggleGradeMatrixBtn').onclick = () => {
        const body = $('gradeMatrixBody');
        const show = body.style.display === 'none';
        body.style.display = show ? 'block' : 'none';
        $('toggleGradeMatrixBtn').textContent = show ? '收合' : '展開';
    };
    $('toggleArchivedGradingBtn').onclick = () => {
        const body = $('archivedGradingBody');
        const show = body.style.display === 'none';
        body.style.display = show ? 'block' : 'none';
        $('toggleArchivedGradingBtn').textContent = show ? '收合' : '展開';
    };

    // 今日新增作業
    $('quickAddAssignmentBtn').onclick = async () => {
        const inp = $('quickAssignmentName');
        const subjSel = $('quickAssignmentSubject');
        const signChk = $('quickAssignmentNeedsSign');
        const signOnlyChk = $('quickAssignmentSignOnly');
        const name = inp.value.trim();
        if (!name) return;
        settings.assignments.push({
            id: crypto.randomUUID(),
            name,
            subjectId: subjSel.value || '',
            needsSign: signChk.checked || signOnlyChk.checked,
            signOnly: signOnlyChk.checked
        });
        await saveSettings({ assignments: settings.assignments }, isAdmin);
        inp.value = '';
        signChk.checked = false;
        signOnlyChk.checked = false;
        renderRecordsTab(records, settings, isAdmin);
    };

    // 複製未繳名單
    $('copyMissingBtn').onclick = async () => {
        const students = sortBySeat(settings.students);
        const lines = (settings.assignments || []).filter(a => a.name !== '聯絡簿每日任務').map(a => {
            const subj = settings.subjects.find(x => x.id === a.subjectId);
            const applicable = students.filter(s => !isPulledOut(s, subj ? subj.name : ''));
            const missing = applicable.filter(s => {
                const rec = records.find(r => r.studentId === s.id && r.assignmentId === a.id);
                return !rec || rec.status === '未繳';
            });
            let line = `${a.name}${a.signOnly ? '（只要簽名）' : (a.needsSign ? '（需簽名）' : '')}：${missing.length ? missing.map(s => s.name).join('、') : '無人未繳'}`;
            if (a.needsSign || a.signOnly) {
                const unsigned = applicable.filter(s => {
                    const rec = records.find(r => r.studentId === s.id && r.assignmentId === a.id);
                    const stt = rec ? rec.status : '未繳';
                    const sgn = (rec && rec.signStatus) ? rec.signStatus : '未簽名';
                    const isExamOrTest = a.name.includes('卷') || a.name.includes('考') || a.name.includes('聽') || a.name.includes('測驗');
                    if (!a.signOnly && !isExamOrTest && stt !== '已繳') return false;
                    return sgn !== '已簽名';
                });
                line += `\n　未簽名：${unsigned.length ? unsigned.map(s => s.name).join('、') : '全部已簽名'}`;
            }
            return line;
        });
        const text = lines.join('\n') || '目前尚無作業';
        try {
            await navigator.clipboard.writeText(text);
            showAlert('未繳名單已複製');
        } catch (e) {
            showAlert('複製失敗');
        }
    };

    // 封存彈窗按鈕
    $('archiveBtn').onclick = () => {
        const archivable = (settings.assignments || []).filter(a => a.name !== '聯絡簿每日任務');
        if (!archivable.length) {
            showAlert('目前沒有可以封存的作業');
            return;
        }
        $('archiveDateInput').value = todayStr();
        $('archiveCheckboxes').innerHTML = archivable.map(a => `
            <label style="display:flex; align-items:center; gap:10px; font-size:1.05em; cursor:pointer">
                <input type="checkbox" value="${escapeHtml(a.id)}" checked style="width:22px;height:22px;margin:0;cursor:pointer;accent-color:var(--accent);flex-shrink:0">
                <span style="flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(a.name)}</span>
            </label>
        `).join('');
        $('archiveModal').style.display = 'flex';
    };

    $('archiveConfirmBtn').onclick = async () => {
        const selectedIds = [...$('archiveCheckboxes').querySelectorAll('input:checked')].map(cb => cb.value);
        if (!selectedIds.length) {
            showAlert('請至少選擇一項作業來封存');
            return;
        }
        const dateLabel = $('archiveDateInput').value.trim() || todayStr();
        $('archiveConfirmBtn').disabled = true;
        const archivableAssignments = settings.assignments.filter(a => selectedIds.includes(a.id));
        const students2 = sortBySeat(settings.students);

        const snapshotRecords = students2.flatMap(s => archivableAssignments.map(a => {
            const rec = records.find(r => r.studentId === s.id && r.assignmentId === a.id);
            const g = gradingRecords.find(x => x.studentId === s.id && x.assignmentId === a.id);
            const subj = settings.subjects.find(x => x.id === a.subjectId);
            const entry = {
                studentId: s.id, studentName: s.name, assignmentId: a.id, assignmentName: a.name,
                status: rec ? rec.status : '未繳',
                correctness: g ? g.correctness : '',
                corrected: g ? g.corrected : false,
                pulledOut: isPulledOut(s, subj ? subj.name : '')
            };
            if (rec && rec.signStatus) entry.signStatus = rec.signStatus;
            return entry;
        }));

        await addDoc(archivesColl, {
            timestamp: Date.now(),
            dateLabel,
            assignments: archivableAssignments.map(a => {
                const s = settings.subjects.find(x => x.id === a.subjectId);
                return { id: a.id, name: a.name, subjectName: s ? s.name : '', needsSign: !!a.needsSign, signOnly: !!a.signOnly };
            }),
            records: snapshotRecords,
            studentCount: settings.students.length,
            assignmentCount: archivableAssignments.length
        }).catch(e => logger.warn('ARCHIVE_WRITE_FAILED', e));

        settings.assignments = settings.assignments.filter(a => !selectedIds.includes(a.id));
        await saveSettings({ assignments: settings.assignments }, isAdmin);
        ensureDailyAssignments(settings);
        autoLoadArchives();

        $('archiveModal').style.display = 'none';
        $('archiveConfirmBtn').disabled = false;

        const leftCount = settings.assignments.filter(a => a.name !== '聯絡簿每日任務').length;
        if (leftCount > 0) {
            showAlert(`封存成功！尚有 ${leftCount} 項作業保留在清單中供後續登記。`);
        } else {
            showAlert('今日作業已全數封存！');
        }
    };

    $('deleteNoArchiveBtn').onclick = async () => {
        const ok2 = await askConfirm('確定直接刪除今日作業與繳交紀錄嗎？');
        if (!ok2) return;
        const dailyAsg2 = settings.assignments.find(a => a.name === '聯絡簿每日任務');
        await clearAll(dailyAsg2 ? [dailyAsg2.id] : []);
        settings.assignments = dailyAsg2 ? [dailyAsg2] : [];
        await saveSettings({ assignments: settings.assignments }, isAdmin);
        ensureDailyAssignments(settings);
    };

    $('loadArchivesBtn').onclick = autoLoadArchives;
    $('loadPastArchivesBtn').onclick = autoLoadArchives;

    // 聯絡簿封存
    $('archiveContactBtn').onclick = async () => {
        const dailyAsg = settings.assignments.find(a => a.name === '聯絡簿每日任務');
        if (!dailyAsg) { showAlert('目前沒有「聯絡簿每日任務」這項作業'); return; }
        const dateLabel = await askInput('這筆聯絡簿封存要標記的日期', todayStr());
        if (dateLabel === null) return;
        const ok2 = await askConfirm('確定要封存今天的聯絡簿紀錄嗎？');
        if (!ok2) return;
        const dSubj = settings.subjects.find(x => x.id === dailyAsg.subjectId);
        const students2 = sortBySeat(settings.students);
        const snapshotRecords = students2.map(s => {
            const rec = records.find(r => r.studentId === s.id && r.assignmentId === dailyAsg.id);
            const g = gradingRecords.find(x => x.studentId === s.id && x.assignmentId === dailyAsg.id);
            return {
                studentId: s.id, studentName: s.name,
                assignmentId: dailyAsg.id, assignmentName: dailyAsg.name,
                status: rec ? rec.status : '未繳',
                signStatus: rec ? rec.signStatus : '未簽名',
                correctness: g ? g.correctness : '',
                corrected: g ? g.corrected : false,
                pulledOut: isPulledOut(s, dSubj ? dSubj.name : '')
            };
        });
        await addDoc(archivesColl, {
            timestamp: Date.now(),
            dateLabel: dateLabel || todayStr(),
            assignments: [{ id: dailyAsg.id, name: dailyAsg.name, subjectName: dSubj ? dSubj.name : '', needsSign: true }],
            records: snapshotRecords,
            studentCount: settings.students.length,
            assignmentCount: 1
        }).catch(e => logger.warn('ARCHIVE_CONTACT_FAILED', e));

        await clearRecordsForAssignment(dailyAsg.id);
        await clearGradingForAssignment(dailyAsg.id);

        settings.assignments = settings.assignments.filter(a => a.name !== '聯絡簿每日任務');
        const newId = `daily-聯絡簿每日任務-${todayISODate()}-${crypto.randomUUID().slice(0, 6)}`;
        settings.assignments.push({ id: newId, name: '聯絡簿每日任務', subjectId: dailyAsg.subjectId, needsSign: true });
        await saveSettings({ assignments: settings.assignments }, isAdmin);
        showAlert('已封存今天的聯絡簿紀錄，換成新的一輪');
        autoLoadArchives();
    };

    $('contactViewSeatBtn').onclick = () => { setContactViewMode('seat'); renderContactTab(records, gradingRecords, settings, isAdmin); };
    $('contactViewGroupBtn').onclick = () => { setContactViewMode('group'); renderContactTab(records, gradingRecords, settings, isAdmin); };

    renderStudentsTab(settings, isAdmin, () => {
        renderRecordsTab(records, settings, isAdmin);
        renderGradingTab(gradingRecords, records, settings, appState);
        renderContactTab(records, gradingRecords, settings, isAdmin);
    });

    renderRecordsTab(records, settings, isAdmin);
    renderGradingTab(gradingRecords, records, settings, appState);
    // 修正：參數順序必須是 records, gradingRecords, settings
    renderContactTab(records, gradingRecords, settings, isAdmin);

    editorReady = true;
}

function maybeLoadEditor() {
    if (isAdmin && settingsArrived && !editorReady) {
        loadEditor();
    }
}

// 登入彈窗與事件綁定
function initLoginUI() {
    $('loginBtn').onclick = () => {
        if (LOGIN_MODE === 'A') {
            $('passInput').value = '';
            $('imeHint').style.display = 'none';
            $('inputModal').style.display = 'flex';
            setTimeout(() => $('passInput').focus(), 50);
        } else {
            loginWithGoogle().catch(() => showAlert('登入失敗'));
        }
    };

    $('logoutBtn').onclick = () => logout();

    const checkPass = async () => {
        const pw = $('passInput').value;
        if (!pw) { showAlert('請輸入密碼'); return; }
        try {
            await loginWithEmail(pw);
            $('inputModal').style.display = 'none';
            $('passInput').value = '';
        } catch (e) {
            showAlert('密碼錯誤');
            $('passInput').value = '';
            $('passInput').focus();
        }
    };

    const checkIME = () => {
        $('imeHint').style.display = /[^\x00-\x7F]/.test($('passInput').value) ? 'block' : 'none';
    };

    $('passInput').addEventListener('keydown', e => {
        if (e.key === 'Enter' && !e.isComposing && e.keyCode !== 229) checkPass();
    });
    $('passInput').addEventListener('compositionstart', () => { $('imeHint').style.display = 'block'; });
    $('passInput').addEventListener('input', e => { if (!e.isComposing) checkIME(); });
    $('passInput').addEventListener('compositionend', checkIME);

    window.checkPass = checkPass;
    window.closeModal = () => { $('inputModal').style.display = 'none'; $('passInput').value = ''; $('imeHint').style.display = 'none'; };
    window.closeAlert = closeAlert;
}

// 初始化應用程式
function bootstrap() {
    initGlobalErrorMonitoring();
    initLoginUI();

    let resizeTimer = null;
    window.addEventListener('resize', () => {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(() => { renderRecordsTab(records, settings, isAdmin); }, 150);
    });

    $('editClassNameBtn').onclick = async () => {
        const name = await askInput('請輸入班級名稱', (settings && settings.className) || '608');
        if (name && name.trim()) saveSettings({ className: name.trim() }, isAdmin);
    };

    // Firebase 驗證狀態監聽
    onAuthStateChanged(auth, user => {
        isAdmin = isAuthorized(user);
        document.querySelectorAll('.admin-only').forEach(el => el.classList.toggle('hidden', !isAdmin));
        $('loginBtn').style.display = isAdmin ? 'none' : '';
        $('content').style.display = isAdmin ? 'none' : '';
        if (isAdmin) {
            startRecordsListener();
            startGradingListener();
            autoLoadArchives();
        } else {
            stopRecordsListenerIfAny();
            stopGradingListenerIfAny();
        }
        maybeLoadEditor();
    });

    // Firestore 設定監聽
    onSnapshot(settingsRef, snap => {
        settingsArrived = true;
        settings = snap.exists() ? snap.data() : { groups: [], students: [], subjects: [], assignments: [], semester: {} };
        settings.groups = settings.groups || [];
        settings.students = settings.students || [];
        settings.subjects = settings.subjects || [];
        settings.assignments = settings.assignments || [];
        settings.semester = settings.semester || {};

        settingsErrored = false;
        refreshLoadError();

        const cName = settings.className || '608';
        if ($('classNameSpan')) $('classNameSpan').textContent = cName;

        ensureDailyAssignments(settings);
        renderPublic(records, settings, { error: false });
        renderGradingTab(gradingRecords, records, settings, appState);
        renderContactTab(records, gradingRecords, settings, isAdmin);
        maybeLoadEditor();
        gateCheck();
        if (isAdmin) autoLoadArchives();
    }, err => {
        logger.warn('SETTINGS_LISTENER_ERROR', err);
        gateSettingsFailed = true;
        settingsErrored = true;
        refreshLoadError();
        renderPublic(records, settings, { error: true });
        gateCheck();
    });
}

// 啟動應用
bootstrap();

