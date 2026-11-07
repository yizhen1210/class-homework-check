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
    pointLogsColl,
    isAuthorized,
    loginWithEmail,
    loginWithGoogle,
    logout,
    saveSettings,
    adminSetStatus,
    clearAll,
    clearRecordsForAssignment,
    clearGradingForAssignment,
    recordDocId,
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
    isRecordPulledOut,
    badgeClass,
    signClass,
    escapeHtml,
    deriveRecordStatus,
    deriveRecordSign,
    appendMakeupSubmitRemark,
    removeMakeupSubmitRemark,
    appendMakeupSignRemark,
    removeMakeupSignRemark,
    toggleLeaveRemark,
    deriveRecordRemark,
    isRecordLeave,
    isRecordMakeup,
    sanitizeArchiveRecords,
    resolveStatsSubjectName
} from './domain/rules.js';

import { logger, initGlobalErrorMonitoring } from './utils/logger.js';
import { showAlert, closeAlert, askInput, askConfirm } from './ui/modals.js';
import { renderPublic } from './ui/publicForm.js';
import { renderRecordsTab } from './ui/recordsTab.js';
import { renderContactTab, setContactViewMode } from './ui/contactTab.js';
import { renderGradingTab, setGradingViewMode, openMakeupStatsModal } from './ui/gradingTab.js';
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
    archiveDocsList: [],
    archiveDocsMap: {},
    extraPastAssignments: {},
    archivesLoaded: false,
    ensureArchivesLoaded: () => autoLoadArchives()
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

let archivesLoadingPromise = null;

export function autoLoadArchives() {
    if (archivesLoadingPromise) return archivesLoadingPromise;
    archivesLoadingPromise = (async () => {
        try {
            const snap = await getDocs(query(archivesColl, orderBy('timestamp', 'desc')));
            const nextExtra = {};
            const nextMap = {};
            const nextList = [];
            const activeNonContactIds = new Set(
                (settings && settings.assignments ? settings.assignments : [])
                    .filter(a => a.name !== '聯絡簿每日任務')
                    .map(a => a.id)
            );
            const activeContactIds = new Set(
                (settings && settings.assignments ? settings.assignments : [])
                    .filter(a => a.name === '聯絡簿每日任務')
                    .map(a => a.id)
            );

            const toBatchRestoreGrading = [];

            snap.docs.forEach(d => {
                const data = d.data();
                data._id = d.id;
                data.id = d.id;
                nextList.push(data);
                nextMap[d.id] = data;
                const dateLabel = data.dateLabel || new Date(data.timestamp).toLocaleDateString('zh-TW');

                let docAssignments = Array.isArray(data.assignments) ? data.assignments : [];
                if (!docAssignments.length && Array.isArray(data.records)) {
                    const seenAids = new Set();
                    docAssignments = [];
                    data.records.forEach(r => {
                        if (r && r.assignmentId && !seenAids.has(r.assignmentId)) {
                            seenAids.add(r.assignmentId);
                            docAssignments.push({
                                id: r.assignmentId,
                                name: r.assignmentName || '未命名作業',
                                subjectName: r.subjectName || '',
                                needsSign: !!r.signStatus,
                                signOnly: false
                            });
                        }
                    });
                }

                docAssignments.forEach(a => {
                    if (!a || !a.id) return;
                    const aName = a.name || '';
                    const isContact = aName === '聯絡簿每日任務' || a.id.startsWith('daily-');
                    const isCurrentlyActive = isContact ? activeContactIds.has(a.id) : activeNonContactIds.has(a.id);

                    let sName = (a.subjectName && a.subjectName !== '未分類') ? a.subjectName : '';
                    if (!sName) {
                        const matchingRec = (data.records || []).find(r => r.assignmentId === a.id && r.subjectName && r.subjectName !== '未分類');
                        if (matchingRec) sName = matchingRec.subjectName;
                    }
                    if (!sName) {
                        sName = resolveStatsSubjectName('', aName, null, null, (settings && settings.subjects) || []);
                    }
                    if (isContact) sName = '聯絡簿';
                    a.subjectName = sName;

                    if (!nextMap[a.id]) nextMap[a.id] = data;
                    nextMap[`${data.id}::${a.id}`] = data;

                    if (!isCurrentlyActive) {
                        const pastKey = `${data.id}::${a.id}`;
                        const infoObj = {
                            id: a.id,
                            docId: data.id,
                            name: aName,
                            dateLabel,
                            timestamp: data.timestamp,
                            subjectName: sName,
                            needsSign: !!(a.needsSign || isContact),
                            signOnly: !!a.signOnly
                        };
                        nextExtra[pastKey] = infoObj;
                        if (!nextExtra[a.id]) {
                            nextExtra[a.id] = infoObj;
                        }
                    }
                });

                (data.records || []).forEach(r => {
                    if (!r || !r.assignmentId) return;
                    if (!r.subjectName || r.subjectName === '未分類') {
                        r.subjectName = resolveStatsSubjectName(r.subjectName, r.assignmentName, null, null, (settings && settings.subjects) || []);
                    }
                    if (!nextMap[r.assignmentId]) {
                        nextMap[r.assignmentId] = data;
                    }
                    nextMap[`${data.id}::${r.assignmentId}`] = data;

                    // 自動檢查並收集在封存中存在但可能在 gradingColl 遺失的訂正/批改紀錄
                    if (r.studentId && (r.correctness || r.corrected || r.pointsGiven)) {
                        let g = gradingRecords.find(x => x.studentId === r.studentId && x.assignmentId === r.assignmentId);
                        if (!g) {
                            g = {
                                studentId: r.studentId,
                                studentName: r.studentName || '',
                                assignmentId: r.assignmentId,
                                assignmentName: r.assignmentName || '',
                                correctness: r.correctness || '',
                                corrected: !!r.corrected,
                                pointsGiven: !!r.pointsGiven,
                                updatedAt: data.timestamp || Date.now()
                            };
                            gradingRecords.push(g);
                            toBatchRestoreGrading.push(g);
                        } else {
                            let changed = false;
                            if (!g.correctness && r.correctness) { g.correctness = r.correctness; changed = true; }
                            if (!g.corrected && r.corrected) { g.corrected = true; changed = true; }
                            if (!g.pointsGiven && r.pointsGiven) { g.pointsGiven = true; changed = true; }
                            if (changed) toBatchRestoreGrading.push(g);
                        }
                    }
                });
            });

            if (toBatchRestoreGrading.length > 0 && isAdmin) {
                try {
                    const batch = writeBatch(db);
                    toBatchRestoreGrading.forEach(g => {
                        batch.set(doc(gradingColl, recordDocId(g.studentId, g.assignmentId)), g, { merge: true });
                    });
                    batch.commit().catch(e => logger.warn('AUTO_RESTORE_GRADING_BATCH_FAILED', e));
                } catch (e) {
                    logger.warn('AUTO_RESTORE_GRADING_ERROR', e);
                }
            }

            appState.archiveDocsList = nextList;
            appState.archiveDocsMap = nextMap;
            appState.extraPastAssignments = nextExtra;
            appState.archivesLoaded = true;

            renderGradingTab(gradingRecords, records, settings, appState);
            renderArchivesList(nextList);
            if (isAdmin) cleanOrphanedAssignmentRecords();

            if (isAdmin && settings && Array.isArray(settings.students)) {
                (async () => {
                    for (const d of snap.docs) {
                        const data = appState.archiveDocsMap[d.id] || d.data();
                        let archiveModified = false;
                        if (Array.isArray(data.records)) {
                            data.records.forEach(r => {
                                const stu = settings.students.find(s => s.id === r.studentId || s.name === r.studentName);
                                if (stu && stu.pullout) {
                                    const asg = (data.assignments || []).find(a => a.id === r.assignmentId);
                                    const asgSubj = asg ? (asg.subjectName || ((settings.subjects || []).find(x => x.id === asg.subjectId) || {}).name || '') : '';
                                    const shouldPull = isRecordPulledOut(r, stu, asgSubj, asg ? asg.name : r.assignmentName);
                                    if (shouldPull && !r.pulledOut) {
                                        r.pulledOut = true;
                                        archiveModified = true;
                                    }
                                }
                            });
                        }
                        if (archiveModified) {
                            data.records = sanitizeArchiveRecords(data.records);
                            await setDoc(doc(db, 'archives', d.id), { records: data.records }, { merge: true }).catch(e => logger.warn('REPAIR_ARCHIVE_PULLOUT_FAILED', e));
                        }
                    }
                })().catch(e => logger.warn('REPAIR_ARCHIVE_PULLOUT_BACKGROUND_FAILED', e));
            }
        } catch (e) {
            logger.warn('AUTO_LOAD_ARCHIVES_FAILED', e);
        } finally {
            archivesLoadingPromise = null;
        }
    })();
    return archivesLoadingPromise;
}

async function renderArchivesList(prefetchedList = null) {
    const archivesListEl = $('archivesList');
    if (!archivesListEl) return;

    // 保留目前已展開的歷史封存明細 ID，避免重新整理時自動收合
    const openDetailIds = new Set(
        [...archivesListEl.querySelectorAll('.archive-detail')]
            .filter(el => el.style.display === 'block')
            .map(el => el.getAttribute('data-detail'))
    );

    if (!prefetchedList && !archivesListEl.children.length) {
        archivesListEl.innerHTML = '<p class="empty-hint">載入中…</p>';
    }
    try {
        let list = prefetchedList;
        if (!Array.isArray(list)) {
            const snap = await getDocs(query(archivesColl, orderBy('timestamp', 'desc')));
            list = snap.docs.map(d => {
                const data = d.data();
                data._id = d.id;
                data.id = d.id;
                return data;
            });
            appState.archiveDocsList = list;
        }
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

        function syncArchiveRecordsInMemory(item, updatedRecords) {
            item.records = updatedRecords;
            if (appState.archiveDocsMap) {
                if (appState.archiveDocsMap[item.id]) appState.archiveDocsMap[item.id].records = updatedRecords;
                (item.assignments || []).forEach(a => {
                    if (appState.archiveDocsMap[a.id] === item || (appState.archiveDocsMap[a.id] && appState.archiveDocsMap[a.id].id === item.id)) {
                        appState.archiveDocsMap[a.id].records = updatedRecords;
                    }
                });
            }
            if (Array.isArray(appState.archiveDocsList)) {
                const found = appState.archiveDocsList.find(d => (d._id || d.id) === item.id);
                if (found) found.records = updatedRecords;
            }
        }

        function renderArchiveDetail(item) {
            const box = archivesListEl.querySelector(`[data-detail="${item.id}"]`);
            if (!box) return;

            const activeContactIds = new Set(
                (settings && settings.assignments ? settings.assignments : [])
                    .filter(a => a.name === '聯絡簿每日任務')
                    .map(a => a.id)
            );

            const headerHtml = `<div style="display: grid; grid-template-columns: 110px 165px 140px 140px 64px 1fr; align-items: center; gap: 12px; padding: 8px 0; border-bottom: 2px solid var(--line); font-weight: bold; color: #000; font-size: 0.95em; text-align: left;">
                <span>學生</span>
                <span>作業</span>
                <span>狀態</span>
                <span>簽名</span>
                <span>請假</span>
                <span>備註</span>
            </div>`;

            box.innerHTML = `<div style="display:flex;flex-direction:column;gap:4px;min-width:740px;">` + headerHtml +
                (item.records || []).map((r, i) => {
                    const stu = (settings.students || []).find(s => s.id === r.studentId || s.name === r.studentName);
                    const asg = (item.assignments || []).find(x => x.id === r.assignmentId);
                    const aName = asg ? asg.name : (r.assignmentName || '');
                    const asgSubj = asg ? (asg.subjectName || ((settings.subjects || []).find(x => x.id === asg.subjectId) || {}).name || '') : '';
                    const isPull = isRecordPulledOut(r, stu, asgSubj, aName);
                    const collidesWithActiveContact = aName === '聯絡簿每日任務' && activeContactIds.has(r.assignmentId);
                    const liveRec = !collidesWithActiveContact ? (records || []).find(x => x.studentId === r.studentId && x.assignmentId === r.assignmentId) : null;
                    const isAwarded = !!(
                        (r && r.pointsGiven) ||
                        (liveRec && liveRec.pointsGiven) ||
                        (appState.awardedPointsSet && appState.awardedPointsSet.has(`${r.studentId}_${r.assignmentId}`)) ||
                        (window.__awardedPointsSet && window.__awardedPointsSet.has(`${r.studentId}_${r.assignmentId}`))
                    );
                    const recordWithPoints = isAwarded ? { ...r, pointsGiven: true } : r;
                    const liveWithPoints = (isAwarded && liveRec) ? { ...liveRec, pointsGiven: true } : liveRec;
                    const effStatus = deriveRecordStatus(liveRec, r);
                    const effSign = deriveRecordSign(liveRec, r);
                    const effRemark = deriveRecordRemark(liveWithPoints, recordWithPoints);
                    const effLeave = isRecordLeave(liveRec, r);
                    const needsSign = !!(asg && (asg.needsSign || asg.signOnly)) || aName === '聯絡簿每日任務';
                    const isSignOnly = !!(asg && asg.signOnly);
                    const isSigned = effSign === '已簽名';
                    const isExamOrTest = aName.includes('卷') || aName.includes('考') || aName.includes('聽') || aName.includes('測驗');
                    const showSign = needsSign && (isSignOnly || isExamOrTest || effStatus === '已繳');
                    const signDisplay = effSign === '未簽名' ? '未簽' : (effSign === '已簽名' ? '已簽' : effSign);

                    const statusBtn = `<button type="button" class="cell-status-btn ${badgeClass(effStatus)}" data-arch-status="${i}">${escapeHtml(effStatus)}</button>`;
                    const makeupBtn = effStatus !== '已繳' ? `<button class="btn small outline" data-makeup="${i}">補交</button>` : `<button class="btn small outline" style="visibility:hidden;pointer-events:none;">補交</button>`;

                    let statusCol = '';
                    if (isPull) {
                        statusCol = `<div style="display:flex;gap:6px;align-items:center;justify-content:flex-start;"><button type="button" class="cell-status-btn" style="background:transparent; color:var(--muted); font-weight:bold; pointer-events:none; box-shadow:none;">抽離</button><button class="btn small outline" style="visibility:hidden;pointer-events:none;">補交</button></div>`;
                    } else {
                        statusCol = `<div style="display:flex;gap:6px;align-items:center;justify-content:flex-start;">${statusBtn}${makeupBtn}</div>`;
                    }

                    let signCol = '';
                    if (needsSign && !isPull) {
                        const signBtn = `<button type="button" class="cell-status-btn cell-sign-btn ${signClass(effSign)}" data-arch-sign="${i}" style="visibility:${showSign ? 'visible' : 'hidden'};pointer-events:${showSign ? 'auto' : 'none'}">${escapeHtml(signDisplay)}</button>`;
                        const makeupSignBtn = (!isSigned && showSign) ? `<button class="btn small outline" data-makeup-sign="${i}">補簽</button>` : `<button class="btn small outline" style="visibility:hidden;pointer-events:none;">補簽</button>`;
                        signCol = `<div style="display:flex;gap:6px;align-items:center;justify-content:flex-start;">${signBtn}${makeupSignBtn}</div>`;
                    } else {
                        signCol = `<div style="display:flex;gap:6px;align-items:center;justify-content:flex-start;visibility:hidden;pointer-events:none;"><button type="button" class="cell-status-btn">已簽</button><button class="btn small outline">補簽</button></div>`;
                    }

                    const leaveCol = isPull
                        ? `<span></span>`
                        : `<button type="button" class="leave-btn ${effLeave ? 'active' : ''}" data-arch-leave="${i}" title="標記請假（期中期末另外算）">${effLeave ? '✓請假' : '請假'}</button>`;

                    return `<div style="display: grid; grid-template-columns: 110px 165px 140px 140px 64px 1fr; align-items: center; gap: 12px; padding: 8px 0; border-bottom: 1px solid var(--line);">
                        <span class="student-name" style="font-size:1em; color:#000; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${escapeHtml(r.studentName)}</span>
                        <span style="font-size:0.95em; color:#000; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${escapeHtml(r.assignmentName)}</span>
                        ${statusCol}
                        ${signCol}
                        ${leaveCol}
                        <span class="row-slot-remark" style="font-size:0.85em; color:var(--muted); text-align: left; line-height: 1.35; word-break: break-word;">${escapeHtml(effRemark)}</span>
                    </div>`;
                }).join('') + `</div>`;

            box.querySelectorAll('[data-makeup]').forEach(btn => {
                btn.onclick = async () => {
                    const idx = Number(btn.getAttribute('data-makeup'));
                    const r = item.records[idx];
                    const collides = r.assignmentName === '聯絡簿每日任務' && activeContactIds.has(r.assignmentId);
                    const liveRec = !collides ? records.find(rx => rx.studentId === r.studentId && rx.assignmentId === r.assignmentId) : null;
                    const curSign = deriveRecordSign(liveRec, r);
                    const curRemark = deriveRecordRemark(liveRec, r);
                    const curLeave = isRecordLeave(liveRec, r);
                    const timeStr = new Date().toLocaleString('zh-TW', { hour12: false });
                    const remarkText = appendMakeupSubmitRemark(curRemark, timeStr);
                    const updatedRecords = sanitizeArchiveRecords(item.records.map((r2, i2) => i2 === idx ? { ...r2, status: '已繳', signStatus: curSign, remark: remarkText, isLeave: curLeave, isMakeup: true } : r2));
                    syncArchiveRecordsInMemory(item, updatedRecords);
                    const payload = {
                        studentId: r.studentId,
                        studentName: r.studentName,
                        assignmentId: r.assignmentId,
                        assignmentName: r.assignmentName,
                        status: '已繳',
                        signStatus: curSign,
                        remark: remarkText,
                        isLeave: curLeave,
                        isMakeup: true
                    };
                    if (!collides) {
                        let rLive = records.find(rx => rx.studentId === r.studentId && rx.assignmentId === r.assignmentId);
                        if (rLive) Object.assign(rLive, payload); else records.push(payload);
                    }
                    renderArchiveDetail(item);
                    renderGradingTab(gradingRecords, records, settings, appState);
                    await setDoc(doc(db, 'archives', item.id), { records: updatedRecords }, { merge: true }).catch(e => logger.warn('UPDATE_ARCHIVE_FAILED', e));
                    if (!collides) {
                        await adminSetStatus(payload).catch(e => logger.warn('ADMIN_SET_STATUS_FAILED', e));
                    }
                };
            });

            box.querySelectorAll('[data-makeup-sign]').forEach(btn => {
                btn.onclick = async () => {
                    const idx = Number(btn.getAttribute('data-makeup-sign'));
                    const r = item.records[idx];
                    const collides = r.assignmentName === '聯絡簿每日任務' && activeContactIds.has(r.assignmentId);
                    const liveRec = !collides ? records.find(rx => rx.studentId === r.studentId && rx.assignmentId === r.assignmentId) : null;
                    const curStatus = deriveRecordStatus(liveRec, r);
                    const curRemark = deriveRecordRemark(liveRec, r);
                    const curLeave = isRecordLeave(liveRec, r);
                    const curMakeup = isRecordMakeup(liveRec, r, curStatus);
                    const timeStr = new Date().toLocaleString('zh-TW', { hour12: false });
                    const remarkText = appendMakeupSignRemark(curRemark, timeStr);
                    const updatedRecords = sanitizeArchiveRecords(item.records.map((r2, i2) => i2 === idx ? { ...r2, status: curStatus, signStatus: '已簽名', remark: remarkText, isLeave: curLeave, isMakeup: curMakeup } : r2));
                    syncArchiveRecordsInMemory(item, updatedRecords);
                    const payload = {
                        studentId: r.studentId,
                        studentName: r.studentName,
                        assignmentId: r.assignmentId,
                        assignmentName: r.assignmentName,
                        status: curStatus,
                        signStatus: '已簽名',
                        remark: remarkText,
                        isLeave: curLeave,
                        isMakeup: curMakeup
                    };
                    if (!collides) {
                        let rLive = records.find(rx => rx.studentId === r.studentId && rx.assignmentId === r.assignmentId);
                        if (rLive) Object.assign(rLive, payload); else records.push(payload);
                    }
                    renderArchiveDetail(item);
                    renderGradingTab(gradingRecords, records, settings, appState);
                    await setDoc(doc(db, 'archives', item.id), { records: updatedRecords }, { merge: true }).catch(e => logger.warn('UPDATE_ARCHIVE_FAILED', e));
                    if (!collides) {
                        await adminSetStatus(payload).catch(e => logger.warn('ADMIN_SET_STATUS_FAILED', e));
                    }
                };
            });

            box.querySelectorAll('[data-arch-status]').forEach(btn => {
                btn.onclick = async () => {
                    const idx = Number(btn.getAttribute('data-arch-status'));
                    const cur = item.records[idx];
                    const collides = cur.assignmentName === '聯絡簿每日任務' && activeContactIds.has(cur.assignmentId);
                    const liveRec = !collides ? records.find(rx => rx.studentId === cur.studentId && rx.assignmentId === cur.assignmentId) : null;
                    const curStatus = deriveRecordStatus(liveRec, cur);
                    const curSign = deriveRecordSign(liveRec, cur);
                    const curRemark = deriveRecordRemark(liveRec, cur);
                    const curLeave = isRecordLeave(liveRec, cur);
                    const nv = curStatus === '已繳' ? '未繳' : '已繳';
                    const timeStr = new Date().toLocaleString('zh-TW', { hour12: false });
                    const nextSign = nv === '已繳' ? curSign : '未簽名';
                    let remarkText = nv === '已繳' ? appendMakeupSubmitRemark(curRemark, timeStr) : removeMakeupSubmitRemark(curRemark);
                    if (nv !== '已繳') remarkText = removeMakeupSignRemark(remarkText);
                    const nextMakeup = nv === '已繳';
                    const updatedRecords = sanitizeArchiveRecords(item.records.map((r, i2) => i2 === idx ? { ...r, status: nv, signStatus: nextSign, remark: remarkText, isLeave: curLeave, isMakeup: nextMakeup } : r));
                    syncArchiveRecordsInMemory(item, updatedRecords);
                    const payload = {
                        studentId: cur.studentId,
                        studentName: cur.studentName,
                        assignmentId: cur.assignmentId,
                        assignmentName: cur.assignmentName,
                        status: nv,
                        signStatus: nextSign,
                        remark: remarkText,
                        isLeave: curLeave,
                        isMakeup: nextMakeup
                    };
                    if (!collides) {
                        let rLive = records.find(rx => rx.studentId === cur.studentId && rx.assignmentId === cur.assignmentId);
                        if (rLive) Object.assign(rLive, payload); else records.push(payload);
                    }
                    renderArchiveDetail(item);
                    renderGradingTab(gradingRecords, records, settings, appState);
                    await setDoc(doc(db, 'archives', item.id), { records: updatedRecords }, { merge: true }).catch(e => logger.warn('UPDATE_ARCHIVE_FAILED', e));
                    if (!collides) {
                        await adminSetStatus(payload).catch(e => logger.warn('ADMIN_SET_STATUS_FAILED', e));
                    }
                };
            });

            box.querySelectorAll('[data-arch-sign]').forEach(btn => {
                btn.onclick = async () => {
                    const idx = Number(btn.getAttribute('data-arch-sign'));
                    const cur = item.records[idx];
                    const collides = cur.assignmentName === '聯絡簿每日任務' && activeContactIds.has(cur.assignmentId);
                    const liveRec = !collides ? records.find(rx => rx.studentId === cur.studentId && rx.assignmentId === cur.assignmentId) : null;
                    const curStatus = deriveRecordStatus(liveRec, cur);
                    const curSign = deriveRecordSign(liveRec, cur);
                    const curRemark = deriveRecordRemark(liveRec, cur);
                    const curLeave = isRecordLeave(liveRec, cur);
                    const curMakeup = isRecordMakeup(liveRec, cur, curStatus);
                    const nv = (curSign === '已簽名') ? '未簽名' : '已簽名';
                    const timeStr = new Date().toLocaleString('zh-TW', { hour12: false });
                    const remarkText = nv === '已簽名' ? appendMakeupSignRemark(curRemark, timeStr) : removeMakeupSignRemark(curRemark);
                    const updatedRecords = sanitizeArchiveRecords(item.records.map((r, i2) => i2 === idx ? { ...r, status: curStatus, signStatus: nv, remark: remarkText, isLeave: curLeave, isMakeup: curMakeup } : r));
                    syncArchiveRecordsInMemory(item, updatedRecords);
                    const payload = {
                        studentId: cur.studentId,
                        studentName: cur.studentName,
                        assignmentId: cur.assignmentId,
                        assignmentName: cur.assignmentName,
                        status: curStatus,
                        signStatus: nv,
                        remark: remarkText,
                        isLeave: curLeave,
                        isMakeup: curMakeup
                    };
                    if (!collides) {
                        let rLive = records.find(rx => rx.studentId === cur.studentId && rx.assignmentId === cur.assignmentId);
                        if (rLive) Object.assign(rLive, payload); else records.push(payload);
                    }
                    renderArchiveDetail(item);
                    renderGradingTab(gradingRecords, records, settings, appState);
                    await setDoc(doc(db, 'archives', item.id), { records: updatedRecords }, { merge: true }).catch(e => logger.warn('UPDATE_ARCHIVE_FAILED', e));
                    if (!collides) {
                        await adminSetStatus(payload).catch(e => logger.warn('ADMIN_SET_STATUS_FAILED', e));
                    }
                };
            });

            box.querySelectorAll('[data-arch-leave]').forEach(btn => {
                btn.onclick = async () => {
                    const idx = Number(btn.getAttribute('data-arch-leave'));
                    const cur = item.records[idx];
                    const collides = cur.assignmentName === '聯絡簿每日任務' && activeContactIds.has(cur.assignmentId);
                    const liveRec = !collides ? records.find(rx => rx.studentId === cur.studentId && rx.assignmentId === cur.assignmentId) : null;
                    const curStatus = deriveRecordStatus(liveRec, cur);
                    const curSign = deriveRecordSign(liveRec, cur);
                    const curRemark = deriveRecordRemark(liveRec, cur);
                    const curLeave = isRecordLeave(liveRec, cur);
                    const curMakeup = isRecordMakeup(liveRec, cur, curStatus);
                    const nextLeave = !curLeave;
                    const remarkText = toggleLeaveRemark(curRemark, nextLeave);
                    const updatedRecords = sanitizeArchiveRecords(item.records.map((r, i2) => i2 === idx ? { ...r, status: curStatus, signStatus: curSign, remark: remarkText, isLeave: nextLeave, isMakeup: curMakeup } : r));
                    syncArchiveRecordsInMemory(item, updatedRecords);
                    const payload = {
                        studentId: cur.studentId,
                        studentName: cur.studentName,
                        assignmentId: cur.assignmentId,
                        assignmentName: cur.assignmentName,
                        status: curStatus,
                        signStatus: curSign,
                        remark: remarkText,
                        isLeave: nextLeave,
                        isMakeup: curMakeup
                    };
                    if (!collides) {
                        let rLive = records.find(rx => rx.studentId === cur.studentId && rx.assignmentId === cur.assignmentId);
                        if (rLive) Object.assign(rLive, payload); else records.push(payload);
                    }
                    renderArchiveDetail(item);
                    renderGradingTab(gradingRecords, records, settings, appState);
                    await setDoc(doc(db, 'archives', item.id), { records: updatedRecords }, { merge: true }).catch(e => logger.warn('UPDATE_ARCHIVE_FAILED', e));
                    if (!collides) {
                        await adminSetStatus(payload).catch(e => logger.warn('ADMIN_SET_STATUS_FAILED', e));
                    }
                };
            });
        }

        appState.refreshOpenArchiveDetail = (docId) => {
            const item = (appState.archiveDocsMap && appState.archiveDocsMap[docId]) || list.find(x => x.id === docId);
            const box = archivesListEl.querySelector(`[data-detail="${docId}"]`);
            if (item && box && box.style.display === 'block') {
                renderArchiveDetail(item);
            }
        };

        // 若重繪前已有展開的明細，自動維持展開並渲染最新資料
        openDetailIds.forEach(docId => {
            const item = (appState.archiveDocsMap && appState.archiveDocsMap[docId]) || list.find(x => x.id === docId);
            const box = archivesListEl.querySelector(`[data-detail="${docId}"]`);
            if (item && box) {
                renderArchiveDetail(item);
                box.style.display = 'block';
            }
        });

        archivesListEl.querySelectorAll('[data-view-archive]').forEach(b => {
            b.onclick = () => {
                const aid = b.getAttribute('data-view-archive');
                const item = (appState.archiveDocsMap && appState.archiveDocsMap[aid]) || list.find(x => x.id === aid);
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
                        remark: r.remark || '',
                        isLeave: !!r.isLeave,
                        isMakeup: !!r.isMakeup,
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
                await autoLoadArchives();
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

export async function cleanOrphanedAssignmentRecords() {
    if (!isAdmin || !settings || !Array.isArray(settings.assignments)) return;
    if (!appState.archivesLoaded || !(appState.archiveDocsList || []).length) return;
    const activeIds = new Set(settings.assignments.map(a => a.id));
    const archiveDocs = (appState && appState.archiveDocsList) || [];
    const archivedIds = new Set();
    archiveDocs.forEach(d => {
        (d.assignments || []).forEach(a => { if (a && a.id) archivedIds.add(a.id); });
        (d.records || []).forEach(r => { if (r && r.assignmentId) archivedIds.add(r.assignmentId); });
    });
    const awardedAids = new Set();
    if (appState.awardedPointsSet) {
        appState.awardedPointsSet.forEach(key => {
            const parts = key.split('_');
            if (parts.length >= 2) awardedAids.add(parts.slice(1).join('_'));
        });
    }

    const orphanAids = new Set();
    (gradingRecords || []).forEach(g => {
        if (!g || !g.assignmentId) return;
        const aid = g.assignmentId;
        const name = g.assignmentName || '';
        const isContact = name === '聯絡簿每日任務' || aid.startsWith('daily-');
        if (name.includes('國複A卷') || (!activeIds.has(aid) && !archivedIds.has(aid) && !isContact && !awardedAids.has(aid))) {
            orphanAids.add(aid);
        }
    });
    (records || []).forEach(r => {
        if (!r || !r.assignmentId) return;
        const aid = r.assignmentId;
        const name = r.assignmentName || '';
        const isContact = name === '聯絡簿每日任務' || aid.startsWith('daily-');
        if (name.includes('國複A卷') || (!activeIds.has(aid) && !archivedIds.has(aid) && !isContact && !awardedAids.has(aid))) {
            orphanAids.add(aid);
        }
    });

    if (orphanAids.size > 0) {
        orphanAids.forEach(async aid => {
            await clearGradingForAssignment(aid);
            await clearRecordsForAssignment(aid);
            if (appState.extraPastAssignments) delete appState.extraPastAssignments[aid];
        });
        gradingRecords = gradingRecords.filter(g => !orphanAids.has(g.assignmentId) && (!g.assignmentName || !g.assignmentName.includes('國複A卷')));
        records = records.filter(r => !orphanAids.has(r.assignmentId) && (!r.assignmentName || !r.assignmentName.includes('國複A卷')));
        renderGradingTab(gradingRecords, records, settings, appState);
    }
}

let stopPointLogsListener = null;
function startPointLogsListener() {
    if (stopPointLogsListener) return;
    stopPointLogsListener = onSnapshot(pointLogsColl, snap => {
        const awardedSet = new Set();
        const awardedItems = [];
        snap.docs.forEach(d => {
            const data = d.data();
            const sid = data.studentId;
            (data.items || []).forEach(item => {
                if (sid && item && item.assignmentId) {
                    awardedSet.add(`${sid}_${item.assignmentId}`);
                    awardedItems.push({ studentId: sid, assignmentId: item.assignmentId, assignmentName: item.assignmentName || '' });
                }
            });
        });
        appState.awardedPointsSet = awardedSet;
        window.__awardedPointsSet = awardedSet;

        let changedAny = false;
        const toBatchHeal = [];
        awardedItems.forEach(({ studentId, assignmentId, assignmentName }) => {
            let g = (gradingRecords || []).find(x => x.studentId === studentId && x.assignmentId === assignmentId);
            if (!g) {
                g = { studentId, assignmentId, assignmentName, pointsGiven: true };
                gradingRecords.push(g);
                changedAny = true;
                toBatchHeal.push({ studentId, assignmentId });
            } else if (!g.pointsGiven) {
                g.pointsGiven = true;
                changedAny = true;
                toBatchHeal.push({ studentId, assignmentId });
            }
        });

        if (toBatchHeal.length > 0 && isAdmin) {
            try {
                const batch = writeBatch(db);
                toBatchHeal.forEach(({ studentId, assignmentId }) => {
                    batch.set(doc(gradingColl, recordDocId(studentId, assignmentId)), { pointsGiven: true }, { merge: true });
                });
                batch.commit().catch(e => logger.warn('AUTO_HEAL_POINTS_GIVEN_FAILED', e));
            } catch (e) {
                logger.warn('AUTO_HEAL_BATCH_ERROR', e);
            }
        }

        const archiveDocs = (appState && appState.archiveDocsList) || [];
        archiveDocs.forEach(d => {
            (d.records || []).forEach(r => {
                if (r && r.studentId && r.assignmentId && awardedSet.has(`${r.studentId}_${r.assignmentId}`)) {
                    if (!r.pointsGiven) {
                        r.pointsGiven = true;
                        changedAny = true;
                    }
                }
            });
        });

        if (changedAny) {
            renderGradingTab(gradingRecords, records, settings, appState);
        }
    }, err => logger.warn('POINT_LOGS_LISTENER_ERROR', err));
}

function stopPointLogsListenerIfAny() {
    if (stopPointLogsListener) {
        stopPointLogsListener();
        stopPointLogsListener = null;
    }
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

function openTodayLeaveModal() {
    let modal = document.getElementById('todayLeaveModal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'todayLeaveModal';
        modal.className = 'modal-overlay';
        modal.innerHTML = `
            <div class="modal-content" style="width:min(580px, 92vw); max-width:580px; text-align:left; padding:26px 28px;">
                <p class="modal-title" style="text-align:center; margin-bottom:8px;">今日請假登記</p>
                <p id="todayLeaveSubtitle" style="margin:0 0 14px; font-size:0.88em; color:var(--muted); text-align:center; line-height:1.45;"></p>
                <div id="todayLeaveStudentsBox" style="display:flex; flex-wrap:wrap; gap:10px; justify-content:center; max-height:50vh; overflow-y:auto; margin-bottom:20px; padding:12px; background:transparent; border-radius:14px; border:2.5px dashed var(--line);"></div>
                <div class="modal-actions">
                    <button type="button" class="btn-ok" id="todayLeaveCloseBtn">完成</button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
    }

    const subtitleEl = document.getElementById('todayLeaveSubtitle');
    const boxEl = document.getElementById('todayLeaveStudentsBox');
    const closeBtn = document.getElementById('todayLeaveCloseBtn');

    const renderLeaveStudents = () => {
        const activeAsgs = settings.assignments || [];
        const students = sortBySeat(settings.students || []);
        if (!activeAsgs.length) {
            subtitleEl.textContent = '目前沒有今日作業或聯絡簿可標記請假';
            boxEl.innerHTML = '<p class="empty-hint" style="padding:10px;">請先新增今日作業</p>';
            return;
        }
        subtitleEl.textContent = `點選學生即可一鍵切換「請假」（套用至目前 ${activeAsgs.length} 項今日作業與聯絡簿，期中期末將自動歸入「請假另外算」）：`;
        if (!students.length) {
            boxEl.innerHTML = '<p class="empty-hint" style="padding:10px;">尚未新增學生</p>';
            return;
        }

        boxEl.innerHTML = students.map(s => {
            const applicableAsgs = activeAsgs.filter(a => {
                const subj = (settings.subjects || []).find(x => x.id === a.subjectId);
                return !isPulledOut(s, subj ? subj.name : '', a.name);
            });
            const anyLeave = applicableAsgs.some(a => {
                const rec = records.find(r => r.studentId === s.id && r.assignmentId === a.id);
                return isRecordLeave(rec, null);
            });
            const sName = String(s.name || '').trim();
            const hasSeat = s.seat != null && s.seat !== '' && !sName.startsWith(String(s.seat));
            const label = hasSeat ? `${s.seat} ${sName}` : sName;
            return `<button type="button" class="leave-btn large ${anyLeave ? 'active' : ''}" data-today-leave-student="${escapeHtml(s.id)}">${anyLeave ? '✓ ' : ''}${escapeHtml(label)}</button>`;
        }).join('');

        boxEl.querySelectorAll('[data-today-leave-student]').forEach(btn => {
            btn.onclick = async () => {
                const sid = btn.getAttribute('data-today-leave-student');
                const stu = (settings.students || []).find(x => x.id === sid);
                if (!stu) return;
                const grp = (settings.groups || []).find(x => x.id === stu.groupId);
                const applicableAsgs = (settings.assignments || []).filter(a => {
                    const subj = (settings.subjects || []).find(x => x.id === a.subjectId);
                    return !isPulledOut(stu, subj ? subj.name : '', a.name);
                });
                const currentlyLeave = applicableAsgs.some(a => {
                    const rec = records.find(r => r.studentId === sid && r.assignmentId === a.id);
                    return isRecordLeave(rec, null);
                });
                const nextLeave = !currentlyLeave;

                const updates = applicableAsgs.map(a => {
                    const subj = (settings.subjects || []).find(x => x.id === a.subjectId);
                    const curRec = records.find(r => r.studentId === sid && r.assignmentId === a.id);
                    const curStatus = curRec ? (curRec.status || '未繳') : '未繳';
                    const curSign = curRec ? (curRec.signStatus || '未簽名') : '未簽名';
                    const curRemark = curRec ? (curRec.remark || '') : '';
                    const curMakeup = isRecordMakeup(curRec, null, curStatus);
                    const remarkText = toggleLeaveRemark(curRemark, nextLeave);
                    const payload = {
                        groupId: grp ? grp.id : '',
                        groupName: grp ? grp.name : '',
                        studentId: sid,
                        studentName: stu.name,
                        subjectId: a.subjectId || '',
                        subjectName: subj ? subj.name : '',
                        assignmentId: a.id,
                        assignmentName: a.name,
                        status: curStatus,
                        signStatus: curSign,
                        remark: remarkText,
                        isLeave: nextLeave,
                        isMakeup: curMakeup
                    };
                    if (curRec) Object.assign(curRec, payload); else records.push(payload);
                    return payload;
                });

                renderLeaveStudents();
                renderRecordsTab(records, settings, isAdmin);
                renderContactTab(records, gradingRecords, settings, isAdmin);
                renderGradingTab(gradingRecords, records, settings, appState);

                await Promise.all(updates.map(p => adminSetStatus(p)));
            };
        });
    };

    if (closeBtn) closeBtn.onclick = () => { modal.style.display = 'none'; };
    renderLeaveStudents();
    modal.style.display = 'flex';
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
                <div class="row" style="flex-wrap:wrap">
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
                    <button class="btn btn-leave" id="markTodayLeaveBtn">今日請假登記</button>
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
                <div class="row" style="flex-wrap:wrap; margin-bottom:0">
                    <button class="btn outline" id="loadArchivesBtn">重新整理歷史封存</button>
                    <button class="btn btn-stats" id="recordsMakeupStatsBtn">補繳次數統計</button>
                </div>
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
                <div class="row" style="margin-bottom:14px; flex-wrap:wrap">
                    <button class="btn small" id="contactViewSeatBtn">依座號</button>
                    <button class="btn small outline" id="contactViewGroupBtn">依小組</button>
                    <button class="btn small btn-leave" id="contactLeaveBtn">今日請假登記</button>
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
                <div class="row" style="margin-bottom:0; flex-wrap:wrap; justify-content:center; align-items:center;">
                    <button class="btn outline" id="globalMissingListBtn">未繳清單</button>
                    <button class="btn outline" id="globalUncorrectedListBtn">未訂正清單</button>
                    <button class="btn outline" id="globalUnsignedListBtn">未簽名清單</button>
                    <button class="btn outline" id="globalLostListBtn">遺失作業清單</button>
                    <button class="btn btn-stats" id="globalMakeupStatsBtn">補繳次數統計</button>
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
                    <div class="row" style="margin-bottom:10px; flex-wrap:wrap">
                        <select id="pastSubjectSelect" style="flex:1"></select>
                        <select id="pastAssignmentSelect" style="flex:1"></select>
                        <button class="btn outline" id="loadPastArchivesBtn">重新整理歷史作業</button>
                        <button class="btn outline" id="renameSelectedPastBtn">重新命名此作業</button>
                        <button class="btn outline danger" id="deleteSelectedPastBtn">刪除選取的這筆</button>
                    </div>
                    <div id="pastAssignmentGradeList"></div>
                </div>
            </div>
            <div class="card">
                <h2>加點</h2>
                <p class="empty-hint" style="text-align:left;padding:0 0 10px">選學生或全部加點後按「計算並加點」。</p>
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
                <div style="margin-top:16px; padding-top:14px; border-top:1px solid var(--line);">
                    <label style="font-weight:bold; color:var(--text); margin-bottom:8px; display:block;">期中成績結算（清空未繳／未訂正／未簽名清單）</label>
                    <div style="display:flex; gap:10px; align-items:center; flex-wrap:wrap;">
                        <input type="date" id="midtermCutoffDateInp" class="txt-input" style="max-width:180px; margin:0; text-align:center;">
                        <button class="btn small outline" id="saveMidtermCutoffBtn">執行期中結算清空</button>
                        <button class="btn small outline" id="clearMidtermCutoffBtn" style="color:var(--muted); border-color:var(--line);">恢復顯示全部</button>
                    </div>
                    <p style="margin:6px 0 0; font-size:0.85em; color:var(--muted);">💡 結算後，該日期（含）之前的作業不會出現在未繳、未訂正與未簽名清單中；「補繳次數統計」不受影響，仍會永久保留。</p>
                </div>
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

    // 頁籤切換：切換分頁時，自動將該分頁最上方內容（白底框）對齊於固定置頂導覽列下方顯示
    $('adminArea').querySelectorAll('.tab-btn').forEach(btn => {
        btn.onclick = () => {
            $('adminArea').querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b === btn));
            $('adminArea').querySelectorAll('.tab-panel').forEach(p => p.style.display = (p.id === btn.dataset.tab) ? 'block' : 'none');
            const targetPanel = $(btn.dataset.tab);
            if (targetPanel) {
                const adminTabs = document.querySelector('.admin-tabs');
                const tabsHeight = adminTabs ? adminTabs.offsetHeight : 0;
                const targetCard = targetPanel.querySelector('.card') || targetPanel;
                const cardTop = targetCard.getBoundingClientRect().top + window.scrollY;
                const scrollDest = Math.max(0, cardTop - tabsHeight);
                window.scrollTo({ top: scrollDest, behavior: 'instant' });
            }
        };
    });

    // 今日請假登記與補繳統計按鈕
    $('markTodayLeaveBtn').onclick = () => openTodayLeaveModal();
    $('contactLeaveBtn').onclick = () => openTodayLeaveModal();
    $('recordsMakeupStatsBtn').onclick = () => {
        openMakeupStatsModal({ settings, records, gradingRecords, state: appState });
        if (!appState.archivesLoaded && (!appState.archiveDocsList || !appState.archiveDocsList.length)) {
            autoLoadArchives().then(() => {
                if ($('makeupStatsModal') && $('makeupStatsModal').style.display === 'flex') {
                    openMakeupStatsModal({ settings, records, gradingRecords, state: appState });
                }
            });
        }
    };

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
                remark: rec ? (rec.remark || '') : '',
                isLeave: !!(rec && isRecordLeave(rec, null)),
                isMakeup: !!(rec && isRecordMakeup(rec, null)),
                pulledOut: isPulledOut(s, subj ? subj.name : '', a.name)
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
            records: sanitizeArchiveRecords(snapshotRecords),
            studentCount: settings.students.length,
            assignmentCount: archivableAssignments.length
        }).catch(e => logger.warn('ARCHIVE_WRITE_FAILED', e));

        settings.assignments = settings.assignments.filter(a => !selectedIds.includes(a.id));
        await saveSettings({ assignments: settings.assignments }, isAdmin);
        ensureDailyAssignments(settings);
        await autoLoadArchives();
        renderRecordsTab(records, settings, isAdmin);

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

    $('loadArchivesBtn').onclick = async () => {
        await autoLoadArchives();
    };
    $('loadPastArchivesBtn').onclick = async () => {
        await autoLoadArchives();
    };

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
                remark: rec ? (rec.remark || '') : '',
                isLeave: !!(rec && isRecordLeave(rec, null)),
                isMakeup: !!(rec && isRecordMakeup(rec, null)),
                pulledOut: isPulledOut(s, dSubj ? dSubj.name : '', dailyAsg.name)
            };
        });
        await addDoc(archivesColl, {
            timestamp: Date.now(),
            dateLabel: dateLabel || todayStr(),
            assignments: [{ id: dailyAsg.id, name: dailyAsg.name, subjectName: dSubj ? dSubj.name : '聯絡簿', needsSign: true }],
            records: sanitizeArchiveRecords(snapshotRecords),
            studentCount: settings.students.length,
            assignmentCount: 1
        }).catch(e => logger.warn('ARCHIVE_CONTACT_FAILED', e));

        await clearRecordsForAssignment(dailyAsg.id);
        await clearGradingForAssignment(dailyAsg.id);

        settings.assignments = settings.assignments.filter(a => a.name !== '聯絡簿每日任務');
        const newId = `daily-聯絡簿每日任務-${todayISODate()}-${crypto.randomUUID().slice(0, 6)}`;
        settings.assignments.push({ id: newId, name: '聯絡簿每日任務', subjectId: dailyAsg.subjectId, needsSign: true });
        await saveSettings({ assignments: settings.assignments }, isAdmin);
        await autoLoadArchives();
        renderContactTab(records, gradingRecords, settings, isAdmin);
        renderGradingTab(gradingRecords, records, settings, appState);
        showAlert('已封存今天的聯絡簿紀錄，換成新的一輪');
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
        document.body.classList.toggle('admin-mode', isAdmin);
        document.querySelectorAll('.admin-only').forEach(el => el.classList.toggle('hidden', !isAdmin));
        $('loginBtn').style.display = isAdmin ? 'none' : '';
        $('content').style.display = isAdmin ? 'none' : '';
        if (isAdmin) {
            startRecordsListener();
            startGradingListener();
            startPointLogsListener();
            autoLoadArchives();
        } else {
            stopRecordsListenerIfAny();
            stopGradingListenerIfAny();
            stopPointLogsListenerIfAny();
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

