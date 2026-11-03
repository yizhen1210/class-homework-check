/**
 * 班級作業登記系統 - 訂正與加點分頁 (Grading Tab)
 */

import {
    badgeClass,
    signClass,
    sortBySeat,
    isPulledOut,
    isRecordPulledOut,
    isExamAssignment,
    pointsOf,
    escapeHtml,
    recordDocId,
    todayStr,
    formatPointLogItems,
    sortArchivedAssignments,
    resolveLostAssignments,
    getLatestEligibleAssignmentDate,
    isGradingMissingExempt,
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
    computeGlobalPopupLists,
    computeMakeupAndLeaveStats,
    formatMakeupAndLeaveReport,
    sanitizeArchiveRecords
} from '../domain/rules.js';

import {
    db,
    gradingColl,
    pointLogsColl,
    archivesColl,
    saveSettings,
    adminSetGrading,
    adminSetStatus,
    clearGradingForAssignment,
    clearRecordsForAssignment
} from '../services/firebase.js';

import { showAlert, askConfirm, askInput } from './modals.js';
import { logger } from '../utils/logger.js';
import { doc, getDocs, setDoc, addDoc, query, orderBy, writeBatch } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

const $ = id => document.getElementById(id);
let gradingViewMode = 'seat';

export function renderGradingTab(gradingRecords, records, settings, state = {}) {
    const panel = $('tabGrading');
    if (!panel) return;

    const gradingRecs = gradingRecords || [];
    const recs = records || [];
    const st = settings || { groups: [], students: [], subjects: [], assignments: [] };

    // 1. 檢視模式按鈕
    const viewModeRow = $('gradingViewModeRow');
    if (viewModeRow) {
        viewModeRow.innerHTML = `
            <div class="row" style="margin-bottom:10px">
                <button class="btn small ${gradingViewMode === 'seat' ? '' : 'outline'}" id="gradingViewSeatBtn">依座號</button>
                <button class="btn small ${gradingViewMode === 'group' ? '' : 'outline'}" id="gradingViewGroupBtn">依小組</button>
            </div>`;
        $('gradingViewSeatBtn').onclick = () => { gradingViewMode = 'seat'; renderGradingTab(gradingRecs, recs, st, state); };
        $('gradingViewGroupBtn').onclick = () => { gradingViewMode = 'group'; renderGradingTab(gradingRecs, recs, st, state); };
    }

    const students = sortBySeat(st.students);
    const assignments = (st.assignments || []).filter(a => a.name !== '聯絡簿每日任務' && !a.signOnly);
    const subjNameOf = a => {
        const s = (st.subjects || []).find(x => x.id === a.subjectId);
        return s ? s.name : '';
    };
    const gradeOf = (sid, aid) => gradingRecs.find(x => x.studentId === sid && x.assignmentId === aid);
    const statusOf = (sid, aid) => { const r = recs.find(x => x.studentId === sid && x.assignmentId === aid); return deriveRecordStatus(r, '未繳'); };

    // 2. 歷史作業批改區塊
    const archivedBox = $('pastAssignmentSelect');
    if (archivedBox) {
        const currentIds = new Set((st.assignments || []).map(a => a.id));
        const knownPast = {};
        gradingRecs.forEach(g => {
            if (currentIds.has(g.assignmentId) || !g.assignmentName || knownPast[g.assignmentId]) return;
            const m = g.assignmentId.match(/^daily-.+-(\d{4})-(\d{2})-(\d{2})$/);
            if (g.assignmentName === '聯絡簿每日任務') {
                knownPast[g.assignmentId] = { name: g.assignmentName, dateLabel: m ? `${m[1]}/${m[2]}/${m[3]}` : '', subjectName: '聯絡簿', signOnly: false, needsSign: true };
            } else {
                knownPast[g.assignmentId] = { name: g.assignmentName, dateLabel: '', subjectName: '未分類' };
            }
        });
        Object.assign(knownPast, state.extraPastAssignments || {});
        const pastOptions = Object.entries(knownPast);

        const selSubj = $('pastSubjectSelect');
        const selPast = $('pastAssignmentSelect');
        const bySubject = {};
        pastOptions.forEach(([id, info]) => {
            const sn = info.subjectName || '未分類';
            (bySubject[sn] = bySubject[sn] || []).push([id, info]);
        });

        function refreshPastAssignmentOptions() {
            const curPastSel = selPast.value;
            const subjName = selSubj.value;
            const opts = subjName ? (bySubject[subjName] || []).filter(([id, info]) => !info.signOnly) : [];
            const sortedOpts = sortArchivedAssignments(opts);
            const newHtml = '<option value="">請選擇作業</option>' + sortedOpts.map(([id, info]) => `<option value="${escapeHtml(id)}">${info.dateLabel ? escapeHtml(info.dateLabel) + ' ' : ''}${escapeHtml(info.name)}</option>`).join('');
            if (selPast.innerHTML !== newHtml) {
                selPast.innerHTML = newHtml;
            }
            if (sortedOpts.some(([id]) => id === curPastSel)) {
                if (selPast.value !== curPastSel) selPast.value = curPastSel;
            } else if (selPast.value !== '') {
                selPast.value = '';
            }
        }

        if (selSubj) {
            const curSubjSel = selSubj.value;
            const subjKeys = Object.keys(bySubject);
            const newSubjHtml = '<option value="">請先選擇科目</option>' + subjKeys.map(sn => `<option value="${escapeHtml(sn)}">${escapeHtml(sn)}</option>`).join('');
            if (selSubj.innerHTML !== newSubjHtml) {
                selSubj.innerHTML = newSubjHtml;
            }
            if (subjKeys.includes(curSubjSel)) {
                if (selSubj.value !== curSubjSel) selSubj.value = curSubjSel;
            } else if (selSubj.value !== '') {
                selSubj.value = '';
            }
            selSubj.onchange = () => { refreshPastAssignmentOptions(); renderPastAssignmentGrader(); };
            refreshPastAssignmentOptions();
        }

        function renderPastAssignmentGrader() {
            const aid = selPast.value;
            const box = $('pastAssignmentGradeList');
            if (!box) return;
            if (!aid) { box.innerHTML = ''; return; }

            const aName = knownPast[aid] ? knownPast[aid].name : '';
            const isPastDaily = aName === '聯絡簿每日任務';
            const archiveDoc = state.archiveDocsMap ? state.archiveDocsMap[aid] : null;
            const gradeOfPast = sid => {
                const live = gradingRecs.find(x => x.studentId === sid && x.assignmentId === aid);
                if (live) return live;
                if (archiveDoc && archiveDoc.records) {
                    const arch = archiveDoc.records.find(x => x.studentId === sid && x.assignmentId === aid);
                    if (arch && (arch.correctness || arch.corrected)) return arch;
                }
                return null;
            };
            const pastSubjName = knownPast[aid] ? (knownPast[aid].subjectName || '') : '';
            const dSubj = isPastDaily
                ? (st.subjects || []).find(x => x.id === (st.assignments.find(a => a.name === '聯絡簿每日任務') || {}).subjectId)
                : (st.subjects || []).find(x => x.name === pastSubjName);
            const pastInfo = knownPast[aid];
            const foundAsg = archiveDoc ? (archiveDoc.assignments || []).find(a => a.id === aid) : null;
            const pastNeedsSign = !!(
                (foundAsg && (foundAsg.needsSign || foundAsg.signOnly)) ||
                (pastInfo && (pastInfo.needsSign || pastInfo.signOnly)) ||
                isPastDaily ||
                recs.some(r => r.assignmentId === aid && r.signStatus && r.signStatus !== '未簽名') ||
                (archiveDoc && (archiveDoc.records || []).some(r => r.assignmentId === aid && r.signStatus && r.signStatus !== '未簽名'))
            );
            const isExam = isExamAssignment(aName);
            const isContact = aName === '聯絡簿每日任務';
            const pastNeedsPoints = !isExam && !isContact;

            const syncArchiveDocToFirestore = async (targetDoc) => {
                const docId = targetDoc ? (targetDoc._id || targetDoc.id) : null;
                if (!targetDoc || !docId) return;
                targetDoc.records = sanitizeArchiveRecords(targetDoc.records);
                if (state.archiveDocsMap) {
                    if (state.archiveDocsMap[docId]) state.archiveDocsMap[docId].records = targetDoc.records;
                    if (state.archiveDocsMap[aid]) state.archiveDocsMap[aid].records = targetDoc.records;
                }
                if (Array.isArray(state.archiveDocsList)) {
                    const listDoc = state.archiveDocsList.find(d => (d._id || d.id) === docId);
                    if (listDoc) listDoc.records = targetDoc.records;
                }
                if (state.refreshOpenArchiveDetail) {
                    state.refreshOpenArchiveDetail(docId);
                }
                await setDoc(doc(db, 'archives', docId), { records: targetDoc.records }, { merge: true }).catch(e => logger.warn('UPDATE_ARCHIVE_FAILED', e));
            };

            box.innerHTML = sortBySeat(st.students).map(s => {
                const sName = escapeHtml(s.name);
                const archRec = archiveDoc && (archiveDoc.records || []).find(r => r.studentId === s.id && r.assignmentId === aid);
                const isPull = isRecordPulledOut(archRec, s, pastSubjName, aName) || isPulledOut(s, foundAsg ? foundAsg.subjectName : '', foundAsg ? foundAsg.name : '');
                if (isPull) {
                    return `<div class="daily-row ${pastNeedsSign ? '' : 'no-sign'} ${pastNeedsPoints ? 'has-points' : ''}" style="grid-template-columns: minmax(70px, 1fr) 140px ${pastNeedsSign ? '140px ' : ''}58px 38px 38px 76px 38px ${pastNeedsPoints ? '72px' : ''}">
                        <span class="student-name">${sName}</span>
                        <span class="row-slot-pill"><div style="display:flex;gap:6px;align-items:center;justify-content:center;width:100%"><button type="button" class="cell-status-btn" style="background:transparent; color:var(--muted); font-weight:bold; pointer-events:none; box-shadow:none;">抽離</button><button class="btn small outline" style="visibility:hidden;pointer-events:none;">補交</button></div></span>
                        ${pastNeedsSign ? `<span class="row-slot-pill"><div style="display:flex;gap:6px;align-items:center;justify-content:center;width:100%"><button type="button" class="cell-status-btn" style="background:transparent; color:var(--muted); font-weight:bold; pointer-events:none; box-shadow:none;">抽離</button><button class="btn small outline" style="visibility:hidden;pointer-events:none;">補簽</button></div></span>` : ''}
                        <span class="row-slot-leave"></span>
                        <span class="row-slot-icon"></span>
                        <span class="row-slot-icon"></span>
                        <span class="row-slot-corrected"><button type="button" class="corrected-btn" style="visibility:hidden;pointer-events:none">訂正</button></span>
                        <span class="row-slot-icon"></span>
                        ${pastNeedsPoints ? `<span class="row-slot-points" style="visibility:hidden">尚未加點</span>` : ''}
                    </div>`;
                }

                const g = gradeOfPast(s.id);
                const cur = g ? g.correctness : '';
                const thirdVal = isPastDaily ? '沒寫任務' : '遺失';
                const thirdIcon = isPastDaily ? '－' : '✗';
                const rec = recs.find(r => r.studentId === s.id && r.assignmentId === aid);
                const dStatus = deriveRecordStatus(rec, archRec ? archRec.status : '未繳');
                const dSign = deriveRecordSign(rec, archRec ? archRec.signStatus : '未簽名');
                const dLeave = isRecordLeave(rec, archRec);
                const dSignDisplay = dSign === '未簽名' ? '未簽' : (dSign === '已簽名' ? '已簽' : dSign);
                const isSigned = dSign === '已簽名';
                const showCorrected = cur === '有錯';
                const statusBtn = `<button type="button" class="cell-status-btn ${badgeClass(dStatus)}" data-past-status-toggle>${escapeHtml(dStatus)}</button>`;
                const isExamOrTest = isExamAssignment(aName);
                const showSign = pastNeedsSign && (isExamOrTest || dStatus === '已繳');
                const signBtn = pastNeedsSign ? `<button type="button" class="cell-status-btn cell-sign-btn ${signClass(dSign)}" data-past-sign-toggle style="visibility:${showSign ? 'visible' : 'hidden'};pointer-events:${showSign ? 'auto' : 'none'}">${escapeHtml(dSignDisplay)}</button>` : '';
                const makeupSignBtn = (pastNeedsSign && !isSigned && showSign) ? `<button class="btn small outline" data-past-makeup-sign="1">補簽</button>` : `<button class="btn small outline" style="visibility:hidden;pointer-events:none;">補簽</button>`;
                const leaveBtn = `<button type="button" class="leave-btn ${dLeave ? 'active' : ''}" data-past-leave="1" title="標記請假（期中期末另外算）">${dLeave ? '✓請假' : '請假'}</button>`;
                const correctedBtn = `<button type="button" class="corrected-btn ${g && g.corrected ? 'active' : ''}" data-past-corrected="1" style="visibility:${showCorrected ? 'visible' : 'hidden'};pointer-events:${showCorrected ? 'auto' : 'none'}">${g && g.corrected ? '✓訂正' : '訂正'}</button>`;
                const makeupBtn = (dStatus !== '已繳') ? `<button class="btn small outline" data-past-makeup="1">補交</button>` : `<button class="btn small outline" style="visibility:hidden;pointer-events:none;">補交</button>`;

                const pts = pointsOf(g, st, pastInfo);
                const pointsSlot = pastNeedsPoints ? `<span class="row-slot-points" style="visibility:${pts > 0 ? 'visible' : 'hidden'}">${pts > 0 ? (g.pointsGiven ? '已加點' : '尚未加點') : '尚未加點'}</span>` : '';

                return `<div class="daily-row ${pastNeedsSign ? '' : 'no-sign'} ${pastNeedsPoints ? 'has-points' : ''}" style="grid-template-columns: minmax(70px, 1fr) 140px ${pastNeedsSign ? '140px ' : ''}58px 38px 38px 76px 38px ${pastNeedsPoints ? '72px' : ''}" data-past-student="${escapeHtml(s.id)}">
                    <span class="student-name">${sName}</span>
                    <span class="row-slot-pill"><div style="display:flex;gap:6px;align-items:center;justify-content:center;width:100%">${statusBtn}${makeupBtn}</div></span>
                    ${pastNeedsSign ? `<span class="row-slot-pill"><div style="display:flex;gap:6px;align-items:center;justify-content:center;width:100%">${signBtn}${makeupSignBtn}</div></span>` : ''}
                    <span class="row-slot-leave">${leaveBtn}</span>
                    <span class="row-slot-icon"><button type="button" class="grade-btn ${cur === '全對' ? 'active g-ok' : ''}" data-past-grade="全對" title="全對">✓</button></span>
                    <span class="row-slot-icon"><button type="button" class="grade-btn ${cur === '有錯' ? 'active g-err' : ''}" data-past-grade="有錯" title="有錯">▲</button></span>
                    <span class="row-slot-corrected">${correctedBtn}</span>
                    <span class="row-slot-icon"><button type="button" class="grade-btn ${cur === thirdVal ? 'active g-lost' : ''}" data-past-grade="${escapeHtml(thirdVal)}" title="${escapeHtml(thirdVal)}">${thirdIcon}</button></span>
                    ${pointsSlot}
                </div>`;
            }).join('');

            box.querySelectorAll('[data-past-status-toggle]').forEach(btn => {
                btn.onclick = async () => {
                    const row = btn.closest('.daily-row');
                    const sid = row.getAttribute('data-past-student');
                    const stu = st.students.find(x => x.id === sid);
                    const grp = st.groups.find(x => x.id === stu?.groupId);
                    const cur2 = recs.find(r => r.studentId === sid && r.assignmentId === aid);
                    const archRec = archiveDoc && (archiveDoc.records || []).find(r => r.studentId === sid && r.assignmentId === aid);
                    const curStatus = deriveRecordStatus(cur2, archRec ? archRec.status : '未繳');
                    const curSignStatus = deriveRecordSign(cur2, archRec ? archRec.signStatus : '未簽名');
                    const curRemark = deriveRecordRemark(cur2, archRec);
                    const curLeave = isRecordLeave(cur2, archRec);
                    const nv = curStatus === '已繳' ? '未繳' : '已繳';
                    const timeStr = new Date().toLocaleString('zh-TW', { hour12: false });
                    const remarkText = nv === '已繳' ? appendMakeupSubmitRemark(curRemark, timeStr) : removeMakeupSubmitRemark(curRemark);
                    const nextMakeup = nv === '已繳';
                    const payload = {
                        groupId: grp ? grp.id : '',
                        groupName: grp ? grp.name : '',
                        studentId: sid,
                        studentName: stu ? stu.name : '',
                        subjectId: dSubj ? dSubj.id : '',
                        subjectName: dSubj ? dSubj.name : '',
                        assignmentId: aid,
                        assignmentName: aName,
                        status: nv,
                        signStatus: curSignStatus,
                        remark: remarkText,
                        isLeave: curLeave,
                        isMakeup: nextMakeup
                    };
                    let r = recs.find(rx => rx.studentId === sid && rx.assignmentId === aid);
                    if (r) Object.assign(r, payload); else recs.push(payload);

                    if (archiveDoc) {
                        if (!archiveDoc.records) archiveDoc.records = [];
                        const archIdx = archiveDoc.records.findIndex(x => x.studentId === sid && x.assignmentId === aid);
                        if (archIdx !== -1) {
                            Object.assign(archiveDoc.records[archIdx], {
                                status: nv,
                                signStatus: curSignStatus,
                                remark: remarkText,
                                isLeave: curLeave,
                                isMakeup: nextMakeup
                            });
                        } else {
                            archiveDoc.records.push({ ...payload });
                        }
                    }
                    renderPastAssignmentGrader();
                    await adminSetStatus(payload);
                    await syncArchiveDocToFirestore(archiveDoc);
                };
            });

            box.querySelectorAll('[data-past-makeup]').forEach(btn => {
                btn.onclick = async () => {
                    const row = btn.closest('.daily-row');
                    const sid = row.getAttribute('data-past-student');
                    const stu = st.students.find(x => x.id === sid);
                    const grp = st.groups.find(x => x.id === stu?.groupId);
                    const cur2 = recs.find(r => r.studentId === sid && r.assignmentId === aid);
                    const archRec = archiveDoc && (archiveDoc.records || []).find(r => r.studentId === sid && r.assignmentId === aid);
                    const curSignStatus = deriveRecordSign(cur2, archRec ? archRec.signStatus : '未簽名');
                    const curRemark = deriveRecordRemark(cur2, archRec);
                    const curLeave = isRecordLeave(cur2, archRec);
                    const timeStr = new Date().toLocaleString('zh-TW', { hour12: false });
                    const remarkText = appendMakeupSubmitRemark(curRemark, timeStr);
                    const payload = {
                        groupId: grp ? grp.id : '',
                        groupName: grp ? grp.name : '',
                        studentId: sid,
                        studentName: stu ? stu.name : '',
                        subjectId: dSubj ? dSubj.id : '',
                        subjectName: dSubj ? dSubj.name : '',
                        assignmentId: aid,
                        assignmentName: aName,
                        status: '已繳',
                        signStatus: curSignStatus,
                        remark: remarkText,
                        isLeave: curLeave,
                        isMakeup: true
                    };
                    let r = recs.find(rx => rx.studentId === sid && rx.assignmentId === aid);
                    if (r) Object.assign(r, payload); else recs.push(payload);

                    if (archiveDoc) {
                        if (!archiveDoc.records) archiveDoc.records = [];
                        const archIdx = archiveDoc.records.findIndex(x => x.studentId === sid && x.assignmentId === aid);
                        if (archIdx !== -1) {
                            Object.assign(archiveDoc.records[archIdx], {
                                status: '已繳',
                                signStatus: curSignStatus,
                                remark: remarkText,
                                isLeave: curLeave,
                                isMakeup: true
                            });
                        } else {
                            archiveDoc.records.push({ ...payload });
                        }
                    }
                    renderPastAssignmentGrader();
                    await adminSetStatus(payload);
                    await syncArchiveDocToFirestore(archiveDoc);
                };
            });

            box.querySelectorAll('[data-past-sign-toggle]').forEach(btn => {
                btn.onclick = async () => {
                    const row = btn.closest('.daily-row');
                    const sid = row.getAttribute('data-past-student');
                    const stu = st.students.find(x => x.id === sid);
                    const grp = st.groups.find(x => x.id === stu?.groupId);
                    const cur2 = recs.find(rx => rx.studentId === sid && rx.assignmentId === aid);
                    const archRec = archiveDoc && (archiveDoc.records || []).find(rx => rx.studentId === sid && rx.assignmentId === aid);
                    const curStatus = deriveRecordStatus(cur2, archRec ? archRec.status : '未繳');
                    const curSignStatus = deriveRecordSign(cur2, archRec ? archRec.signStatus : '未簽名');
                    const curRemark = deriveRecordRemark(cur2, archRec);
                    const curLeave = isRecordLeave(cur2, archRec);
                    const curMakeup = isRecordMakeup(cur2, archRec, curStatus);
                    const nv = (curSignStatus === '已簽名' || curSignStatus === '已簽') ? '未簽名' : '已簽名';
                    const timeStr = new Date().toLocaleString('zh-TW', { hour12: false });
                    const remarkText = nv === '已簽名' ? appendMakeupSignRemark(curRemark, timeStr) : removeMakeupSignRemark(curRemark);
                    const payload = {
                        groupId: grp ? grp.id : '',
                        groupName: grp ? grp.name : '',
                        studentId: sid,
                        studentName: stu ? stu.name : '',
                        subjectId: dSubj ? dSubj.id : '',
                        subjectName: dSubj ? dSubj.name : '',
                        assignmentId: aid,
                        assignmentName: aName,
                        status: curStatus,
                        signStatus: nv,
                        remark: remarkText,
                        isLeave: curLeave,
                        isMakeup: curMakeup
                    };
                    let r = recs.find(rx => rx.studentId === sid && rx.assignmentId === aid);
                    if (r) Object.assign(r, payload); else recs.push(payload);

                    if (archiveDoc) {
                        if (!archiveDoc.records) archiveDoc.records = [];
                        const archIdx = archiveDoc.records.findIndex(x => x.studentId === sid && x.assignmentId === aid);
                        if (archIdx !== -1) {
                            Object.assign(archiveDoc.records[archIdx], {
                                status: curStatus,
                                signStatus: nv,
                                remark: remarkText,
                                isLeave: curLeave,
                                isMakeup: curMakeup
                            });
                        } else {
                            archiveDoc.records.push({ ...payload });
                        }
                    }
                    renderPastAssignmentGrader();
                    await adminSetStatus(payload);
                    await syncArchiveDocToFirestore(archiveDoc);
                };
            });

            box.querySelectorAll('[data-past-makeup-sign]').forEach(btn => {
                btn.onclick = async () => {
                    const row = btn.closest('.daily-row');
                    const sid = row.getAttribute('data-past-student');
                    const stu = st.students.find(x => x.id === sid);
                    const grp = st.groups.find(x => x.id === stu?.groupId);
                    const timeStr = new Date().toLocaleString('zh-TW', { hour12: false });
                    const cur2 = recs.find(rx => rx.studentId === sid && rx.assignmentId === aid);
                    const archRec = archiveDoc && (archiveDoc.records || []).find(rx => rx.studentId === sid && rx.assignmentId === aid);
                    const curStatus = deriveRecordStatus(cur2, archRec ? archRec.status : '未繳');
                    const curRemark = deriveRecordRemark(cur2, archRec);
                    const curLeave = isRecordLeave(cur2, archRec);
                    const curMakeup = isRecordMakeup(cur2, archRec, curStatus);
                    const remarkText = appendMakeupSignRemark(curRemark, timeStr);
                    const payload = {
                        groupId: grp ? grp.id : '',
                        groupName: grp ? grp.name : '',
                        studentId: sid,
                        studentName: stu ? stu.name : '',
                        subjectId: dSubj ? dSubj.id : '',
                        subjectName: dSubj ? dSubj.name : '',
                        assignmentId: aid,
                        assignmentName: aName,
                        status: curStatus,
                        signStatus: '已簽名',
                        remark: remarkText,
                        isLeave: curLeave,
                        isMakeup: curMakeup
                    };
                    let r = recs.find(rx => rx.studentId === sid && rx.assignmentId === aid);
                    if (r) Object.assign(r, payload); else recs.push(payload);

                    if (archiveDoc) {
                        if (!archiveDoc.records) archiveDoc.records = [];
                        const archIdx = archiveDoc.records.findIndex(x => x.studentId === sid && x.assignmentId === aid);
                        if (archIdx !== -1) {
                            Object.assign(archiveDoc.records[archIdx], {
                                status: curStatus,
                                signStatus: '已簽名',
                                remark: remarkText,
                                isLeave: curLeave,
                                isMakeup: curMakeup
                            });
                        } else {
                            archiveDoc.records.push({ ...payload });
                        }
                    }
                    renderPastAssignmentGrader();
                    await adminSetStatus(payload);
                    await syncArchiveDocToFirestore(archiveDoc);
                };
            });

            box.querySelectorAll('[data-past-leave]').forEach(btn => {
                btn.onclick = async () => {
                    const row = btn.closest('.daily-row');
                    const sid = row.getAttribute('data-past-student');
                    const stu = st.students.find(x => x.id === sid);
                    const grp = st.groups.find(x => x.id === stu?.groupId);
                    const cur2 = recs.find(rx => rx.studentId === sid && rx.assignmentId === aid);
                    const archRec = archiveDoc && (archiveDoc.records || []).find(rx => rx.studentId === sid && rx.assignmentId === aid);
                    const curStatus = deriveRecordStatus(cur2, archRec ? archRec.status : '未繳');
                    const curSignStatus = deriveRecordSign(cur2, archRec ? archRec.signStatus : '未簽名');
                    const curRemark = deriveRecordRemark(cur2, archRec);
                    const curLeave = isRecordLeave(cur2, archRec);
                    const curMakeup = isRecordMakeup(cur2, archRec, curStatus);
                    const nextLeave = !curLeave;
                    const remarkText = toggleLeaveRemark(curRemark, nextLeave);
                    const payload = {
                        groupId: grp ? grp.id : '',
                        groupName: grp ? grp.name : '',
                        studentId: sid,
                        studentName: stu ? stu.name : '',
                        subjectId: dSubj ? dSubj.id : '',
                        subjectName: dSubj ? dSubj.name : '',
                        assignmentId: aid,
                        assignmentName: aName,
                        status: curStatus,
                        signStatus: curSignStatus,
                        remark: remarkText,
                        isLeave: nextLeave,
                        isMakeup: curMakeup
                    };
                    let r = recs.find(rx => rx.studentId === sid && rx.assignmentId === aid);
                    if (r) Object.assign(r, payload); else recs.push(payload);

                    if (archiveDoc) {
                        if (!archiveDoc.records) archiveDoc.records = [];
                        const archIdx = archiveDoc.records.findIndex(x => x.studentId === sid && x.assignmentId === aid);
                        if (archIdx !== -1) {
                            Object.assign(archiveDoc.records[archIdx], {
                                status: curStatus,
                                signStatus: curSignStatus,
                                remark: remarkText,
                                isLeave: nextLeave,
                                isMakeup: curMakeup
                            });
                        } else {
                            archiveDoc.records.push({ ...payload });
                        }
                    }
                    renderPastAssignmentGrader();
                    await adminSetStatus(payload);
                    await syncArchiveDocToFirestore(archiveDoc);
                };
            });

            box.querySelectorAll('[data-past-grade]').forEach(btn => {
                btn.onclick = async () => {
                    const row = btn.closest('.daily-row');
                    const sid = row.getAttribute('data-past-student');
                    const stu = st.students.find(x => x.id === sid);
                    const val = btn.getAttribute('data-past-grade');
                    const g = gradeOfPast(sid);
                    const nextVal = (g && g.correctness === val) ? '' : val;
                    const nextCorrected = nextVal === '有錯' ? (g ? g.corrected : false) : false;
                    const payload = {
                        studentId: sid,
                        studentName: stu ? stu.name : '',
                        assignmentId: aid,
                        assignmentName: aName,
                        correctness: nextVal,
                        corrected: nextCorrected
                    };
                    let gItem = gradingRecs.find(x => x.studentId === sid && x.assignmentId === aid);
                    if (gItem) Object.assign(gItem, payload); else gradingRecs.push(payload);

                    if (archiveDoc) {
                        if (!archiveDoc.records) archiveDoc.records = [];
                        const archIdx = archiveDoc.records.findIndex(x => x.studentId === sid && x.assignmentId === aid);
                        if (archIdx !== -1) {
                            archiveDoc.records[archIdx].correctness = nextVal;
                            archiveDoc.records[archIdx].corrected = nextCorrected;
                        } else {
                            archiveDoc.records.push({
                                studentId: sid,
                                studentName: stu ? stu.name : '',
                                assignmentId: aid,
                                assignmentName: aName,
                                correctness: nextVal,
                                corrected: nextCorrected
                            });
                        }
                    }
                    renderPastAssignmentGrader();

                    await adminSetGrading(payload);
                    const docId = archiveDoc ? (archiveDoc._id || archiveDoc.id) : null;
                    if (archiveDoc && docId) {
                        archiveDoc.records = sanitizeArchiveRecords(archiveDoc.records);
                        if (state.archiveDocsMap) {
                            if (state.archiveDocsMap[docId]) state.archiveDocsMap[docId].records = archiveDoc.records;
                            if (state.archiveDocsMap[aid]) state.archiveDocsMap[aid].records = archiveDoc.records;
                        }
                        if (state.refreshOpenArchiveDetail && docId) {
                            state.refreshOpenArchiveDetail(docId);
                        }
                        await setDoc(doc(db, 'archives', docId), { records: archiveDoc.records }, { merge: true }).catch(e => logger.warn('UPDATE_ARCHIVE_FAILED', e));
                    }
                };
            });

            box.querySelectorAll('[data-past-corrected]').forEach(btn => {
                btn.onclick = async () => {
                    const row = btn.closest('.daily-row');
                    const sid = row.getAttribute('data-past-student');
                    const stu = st.students.find(x => x.id === sid);
                    const g = gradeOfPast(sid);
                    const nextCorrected = !(g && g.corrected);
                    const payload = {
                        studentId: sid,
                        studentName: stu ? stu.name : '',
                        assignmentId: aid,
                        assignmentName: aName,
                        correctness: '有錯',
                        corrected: nextCorrected
                    };
                    let gItem = gradingRecs.find(x => x.studentId === sid && x.assignmentId === aid);
                    if (gItem) Object.assign(gItem, payload); else gradingRecs.push(payload);

                    if (archiveDoc) {
                        if (!archiveDoc.records) archiveDoc.records = [];
                        const archIdx = archiveDoc.records.findIndex(x => x.studentId === sid && x.assignmentId === aid);
                        if (archIdx !== -1) {
                            archiveDoc.records[archIdx].correctness = '有錯';
                            archiveDoc.records[archIdx].corrected = nextCorrected;
                        } else {
                            archiveDoc.records.push({
                                studentId: sid,
                                studentName: stu ? stu.name : '',
                                assignmentId: aid,
                                assignmentName: aName,
                                correctness: '有錯',
                                corrected: nextCorrected
                            });
                        }
                    }
                    renderPastAssignmentGrader();

                    await adminSetGrading(payload);
                    const docId = archiveDoc ? (archiveDoc._id || archiveDoc.id) : null;
                    if (archiveDoc && docId) {
                        archiveDoc.records = sanitizeArchiveRecords(archiveDoc.records);
                        if (state.archiveDocsMap) {
                            if (state.archiveDocsMap[docId]) state.archiveDocsMap[docId].records = archiveDoc.records;
                            if (state.archiveDocsMap[aid]) state.archiveDocsMap[aid].records = archiveDoc.records;
                        }
                        if (state.refreshOpenArchiveDetail && docId) {
                            state.refreshOpenArchiveDetail(docId);
                        }
                        await setDoc(doc(db, 'archives', docId), { records: archiveDoc.records }, { merge: true }).catch(e => logger.warn('UPDATE_ARCHIVE_FAILED', e));
                    }
                };
            });
        }

        if (selPast) {
            selPast.onchange = renderPastAssignmentGrader;
            renderPastAssignmentGrader();
        }

        const renameSelectedPastBtn = $('renameSelectedPastBtn');
        if (renameSelectedPastBtn) {
            renameSelectedPastBtn.onclick = async () => {
                const aid = selPast.value;
                if (!aid) { showAlert('請先在上面選一筆要重新命名的作業'); return; }
                const info = knownPast[aid];
                const currentName = info ? info.name : '';
                const label = info ? `${info.dateLabel ? info.dateLabel + ' ' : ''}${info.name}` : aid;
                const newName = await askInput(`請輸入「${label}」的新作業名稱：`, currentName);
                if (newName === null) return;
                let trimmed = newName.trim();
                if (!trimmed) { showAlert('作業名稱不可為空白'); return; }
                if (info && info.dateLabel && trimmed.startsWith(info.dateLabel)) {
                    trimmed = trimmed.replace(info.dateLabel, '').trim();
                }
                if (trimmed === currentName) return;

                try {
                    const snap = await getDocs(archivesColl);
                    for (const d of snap.docs) {
                        const data = d.data();
                        let changed = false;
                        (data.assignments || []).forEach(a => {
                            if (a.id === aid) {
                                a.name = trimmed;
                                changed = true;
                            }
                        });
                        if (changed) {
                            (data.records || []).forEach(r => {
                                if (r.assignmentId === aid) {
                                    r.assignmentName = trimmed;
                                }
                            });
                            await setDoc(doc(db, 'archives', d.id), {
                                assignments: data.assignments,
                                records: data.records
                            }, { merge: true });
                            if (state.archiveDocsMap && state.archiveDocsMap[d.id]) {
                                state.archiveDocsMap[d.id].assignments = data.assignments;
                                state.archiveDocsMap[d.id].records = data.records;
                            }
                        }
                    }

                    const gSnap = await getDocs(query(gradingColl, where('assignmentId', '==', aid)));
                    if (!gSnap.empty) {
                        const batch = writeBatch(db);
                        gSnap.docs.forEach(gd => batch.update(gd.ref, { assignmentName: trimmed }));
                        await batch.commit();
                    }

                    if (st && Array.isArray(st.assignments)) {
                        const curA = st.assignments.find(x => x.id === aid);
                        if (curA) {
                            curA.name = trimmed;
                            saveSettings({ assignments: st.assignments }, true);
                        }
                    }

                    if (knownPast[aid]) knownPast[aid].name = trimmed;
                    if (state.extraPastAssignments && state.extraPastAssignments[aid]) {
                        state.extraPastAssignments[aid].name = trimmed;
                    }
                    gradingRecs.forEach(g => {
                        if (g.assignmentId === aid) g.assignmentName = trimmed;
                    });

                    refreshPastAssignmentOptions();
                    selPast.value = aid;
                    renderPastAssignmentGrader();
                    showAlert(`作業名稱已成功修改為：「${trimmed}」`);
                } catch (e) {
                    logger.error('RENAME_ARCHIVED_ASSIGNMENT_FAILED', e);
                    showAlert('修改作業名稱失敗，請檢查網路後重試');
                }
            };
        }

        const deleteSelectedPastBtn = $('deleteSelectedPastBtn');
        if (deleteSelectedPastBtn) {
            deleteSelectedPastBtn.onclick = async () => {
                const aid = selPast.value;
                if (!aid) { showAlert('請先在上面選一筆要刪除的作業'); return; }
                const info = knownPast[aid];
                const label = info ? `${info.dateLabel ? info.dateLabel + ' ' : ''}${info.name}` : aid;
                const ok2 = await askConfirm(`確定要刪除「${label}」這筆紀錄嗎？裡面的訂正與繳交資料都會刪除，無法復原。`);
                if (!ok2) return;
                await clearGradingForAssignment(aid);
                await clearRecordsForAssignment(aid);
                if (state.extraPastAssignments) delete state.extraPastAssignments[aid];
                showAlert(`已刪除「${label}」`);
            };
        }
    }

    // 3. 全域統計清單彈窗按鈕（未繳、未訂正、未簽名、遺失、期中期末補繳與請假統計）
    const globalMissingBtn = $('globalMissingListBtn');
    const globalUncorrectedBtn = $('globalUncorrectedListBtn');
    const globalUnsignedBtn = $('globalUnsignedListBtn');
    const globalLostBtn = $('globalLostListBtn');
    const globalMakeupStatsBtn = $('globalMakeupStatsBtn');

    const ensureArchivesReady = async () => {
        if ((!state.archiveDocsList || !state.archiveDocsList.length) && typeof state.ensureArchivesLoaded === 'function') {
            await state.ensureArchivesLoaded();
        }
    };

    const renderGlobalPopupByType = (type) => {
        const { missingBlocks, uncorrectedBlocks, unsignedBlocks } = computeGlobalPopupLists({
            settings: st,
            records: recs,
            gradingRecords: gradingRecs,
            archiveDocsList: state.archiveDocsList,
            archiveDocsMap: state.archiveDocsMap,
            extraPastAssignments: state.extraPastAssignments
        });
        if (type === 'missing') {
            $('missingListTitle').textContent = '未繳清單';
            $('missingListBody').innerHTML = missingBlocks.length
                ? missingBlocks.map(b => `<p style="margin-bottom:4px"><strong>${escapeHtml(b.displayName)}</strong>：${b.studentNames.map(n => escapeHtml(n)).join('、')}</p>`).join('')
                : '<p class="empty-hint">目前沒有未繳項目</p>';
        } else if (type === 'uncorrected') {
            $('missingListTitle').textContent = '未訂正清單';
            $('missingListBody').innerHTML = uncorrectedBlocks.length
                ? uncorrectedBlocks.map(b => `<p style="margin-bottom:4px"><strong>${escapeHtml(b.displayName)}</strong>：${b.studentNames.map(n => escapeHtml(n)).join('、')}</p>`).join('')
                : '<p class="empty-hint">目前沒有未訂正項目</p>';
        } else if (type === 'unsigned') {
            $('missingListTitle').textContent = '未簽名清單';
            $('missingListBody').innerHTML = unsignedBlocks.length
                ? unsignedBlocks.map(b => `<p style="margin-bottom:4px"><strong>${escapeHtml(b.displayName)}</strong>：${b.studentNames.map(n => escapeHtml(n)).join('、')}</p>`).join('')
                : '<p class="empty-hint">目前沒有未簽名項目</p>';
        }
    };

    if (globalMissingBtn) {
        globalMissingBtn.onclick = async () => {
            await ensureArchivesReady();
            renderGlobalPopupByType('missing');
            $('missingListModal').style.display = 'flex';
        };
    }

    if (globalUncorrectedBtn) {
        globalUncorrectedBtn.onclick = async () => {
            await ensureArchivesReady();
            renderGlobalPopupByType('uncorrected');
            $('missingListModal').style.display = 'flex';
        };
    }

    if (globalUnsignedBtn) {
        globalUnsignedBtn.onclick = async () => {
            await ensureArchivesReady();
            renderGlobalPopupByType('unsigned');
            $('missingListModal').style.display = 'flex';
        };
    }

    function renderMissingLostList() {
        $('missingListTitle').textContent = '遺失作業清單';
        const sortedList = resolveLostAssignments(st.students, gradingRecs, state.archiveDocsMap);
        $('missingListBody').innerHTML = sortedList.length ? sortedList.map(x => `
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;padding-bottom:4px;border-bottom:1px solid var(--line)">
                <span><strong>${escapeHtml(x.name)}</strong>：${x.count} 件</span>
                <button class="btn small outline" data-lost-detail="${escapeHtml(x.id)}">詳情</button>
            </div>
            <div id="lostDetail_${escapeHtml(x.id)}" style="display:none;margin:4px 0 10px 14px;font-size:0.9em;color:var(--muted)">
                ${x.assignments.map(a => escapeHtml(a)).join('、')}
            </div>
        `).join('') : '<p class="empty-hint">目前沒有遺失紀錄</p>';

        $('missingListBody').querySelectorAll('[data-lost-detail]').forEach(btn => {
            btn.onclick = () => {
                const sid = btn.getAttribute('data-lost-detail');
                const detailEl = document.getElementById(`lostDetail_${sid}`);
                if (detailEl) {
                    detailEl.style.display = detailEl.style.display === 'block' ? 'none' : 'block';
                }
            };
        });
    }

    if (globalLostBtn) {
        globalLostBtn.onclick = async () => {
            await ensureArchivesReady();
            renderMissingLostList();
            $('missingListModal').style.display = 'flex';
        };
    }

    if (globalMakeupStatsBtn) {
        globalMakeupStatsBtn.onclick = async () => {
            await ensureArchivesReady();
            openMakeupStatsModal({ settings: st, records: recs, gradingRecords: gradingRecs, state });
        };
    }

    if ($('missingListModal') && $('missingListModal').style.display === 'flex' && $('missingListTitle')) {
        const curTitle = $('missingListTitle').textContent;
        if (curTitle === '遺失作業清單') renderMissingLostList();
        else if (curTitle === '未繳清單') renderGlobalPopupByType('missing');
        else if (curTitle === '未訂正清單') renderGlobalPopupByType('uncorrected');
        else if (curTitle === '未簽名清單') renderGlobalPopupByType('unsigned');
    }

    // 4. 今日作業批改矩陣 (座號模式 / 小組模式)
    const thead = $('gradeThead');
    if (thead) {
        thead.innerHTML = '<tr><th>學生</th>' + assignments.map(a => `<th>${escapeHtml(a.name)}</th>`).join('') + '</tr>';
    }
    const tbody = $('gradeTbody');

    const renderGradingRowsContent = () => {
        const getRowHtml = (s, isGroupMode) => {
            const cellStyle = isGroupMode ? ' style="text-align: center; min-width: 82px; vertical-align: top;"' : '';
            const firstCellStyle = isGroupMode ? ' style="text-align: left; white-space: nowrap;"' : '';

            const cells = assignments.map(a => {
                if (isPulledOut(s, subjNameOf(a))) return `<td${cellStyle}><span class="cell-pulled-out">抽離</span></td>`;

                const isExempt = isGradingMissingExempt(a.name);
                const isSubmitted = statusOf(s.id, a.id) === '已繳';
                if (!isSubmitted && !isExempt) {
                    return `<td${cellStyle}><div class="cell-stack" style="min-height:70px;justify-content:center;"><span class="grade-missing">缺交</span></div></td>`;
                }

                const gRecord = gradeOf(s.id, a.id);
                const cur = gRecord ? gRecord.correctness : '';
                const showCorrected = cur === '有錯';
                const isDaily = a.name === '聯絡簿每日任務';
                const thirdBtn = isDaily
                    ? `<button type="button" class="grade-btn ${cur === '沒寫任務' ? 'active g-lost' : ''}" data-grade-student="${escapeHtml(s.id)}" data-grade-assignment="${escapeHtml(a.id)}" data-grade-value="沒寫任務" title="沒寫任務">－</button>`
                    : `<button type="button" class="grade-btn ${cur === '遺失' ? 'active g-lost' : ''}" data-grade-student="${escapeHtml(s.id)}" data-grade-assignment="${escapeHtml(a.id)}" data-grade-value="遺失" title="遺失">✗</button>`;
                const btns = `
                    <div class="mini-status-group">
                        <button type="button" class="grade-btn ${cur === '全對' ? 'active g-ok' : ''}" data-grade-student="${escapeHtml(s.id)}" data-grade-assignment="${escapeHtml(a.id)}" data-grade-value="全對" title="全對">✓</button>
                        <button type="button" class="grade-btn ${cur === '有錯' ? 'active g-err' : ''}" data-grade-student="${escapeHtml(s.id)}" data-grade-assignment="${escapeHtml(a.id)}" data-grade-value="有錯" title="有錯">▲</button>
                        ${thirdBtn}
                    </div>`;
                const correctedBtn = `<button type="button" class="corrected-btn ${gRecord && gRecord.corrected ? 'active' : ''}" data-corrected-student="${escapeHtml(s.id)}" data-corrected-assignment="${escapeHtml(a.id)}" style="visibility:${showCorrected ? 'visible' : 'hidden'};pointer-events:${showCorrected ? 'auto' : 'none'}">${gRecord && gRecord.corrected ? '✓訂正' : '訂正'}</button>`;
                return `<td${cellStyle}><div class="cell-stack">${btns}<div class="corrected-slot">${correctedBtn}</div></div></td>`;
            }).join('');
            return `<tr><td${firstCellStyle}>${escapeHtml(s.name)}</td>${cells}</tr>`;
        };

        if (gradingViewMode === 'group') {
            const theadHtml = '<tr><th style="text-align: left; white-space: nowrap;">學生</th>' + assignments.map(a => `<th style="text-align: center; min-width: 82px; vertical-align: top;">${escapeHtml(a.name)}</th>`).join('') + '</tr>';
            return (st.groups || []).map(g => {
                const gStudents = sortBySeat(st.students.filter(s => s.groupId === g.id));
                return `<div class="group-block">
                    <div class="group-block-head"><strong>${escapeHtml(g.name)}</strong></div>
                    <div class="table-scroll">
                        <table>
                            <thead>${theadHtml}</thead>
                            <tbody>
                                ${gStudents.length ? gStudents.map(s => getRowHtml(s, true)).join('') : `<tr><td colspan="${assignments.length + 1}" class="empty-hint">此組別尚無學生</td></tr>`}
                            </tbody>
                        </table>
                    </div>
                </div>`;
            }).join('') || '<p class="empty-hint">尚未新增組別</p>';
        } else {
            return students.length ? students.map(s => getRowHtml(s, false)).join('') : '';
        }
    };

    const gradeMatrixBody = $('gradeMatrixBody');
    if (gradeMatrixBody) {
        const tableWrapContainer = gradeMatrixBody.querySelector('.table-scroll');
        let customGroupContainer = $('groupGradingContainer');
        if (!customGroupContainer) {
            customGroupContainer = document.createElement('div');
            customGroupContainer.id = 'groupGradingContainer';
            gradeMatrixBody.appendChild(customGroupContainer);
        }

        if (gradingViewMode === 'group') {
            if (tableWrapContainer) tableWrapContainer.style.display = 'none';
            customGroupContainer.style.display = 'block';
            customGroupContainer.innerHTML = renderGradingRowsContent();
        } else {
            if (tableWrapContainer) tableWrapContainer.style.display = 'block';
            customGroupContainer.style.display = 'none';
            customGroupContainer.innerHTML = '';
            if (tbody) tbody.innerHTML = renderGradingRowsContent();
        }
    }

    if ($('gradeEmpty')) {
        $('gradeEmpty').style.display = students.length && assignments.length ? 'none' : 'block';
        $('gradeEmpty').textContent = !students.length ? '尚未新增學生' : (!assignments.length ? '目前沒有作業' : '');
    }

    document.querySelectorAll('[data-grade-value]').forEach(btn => {
        btn.onclick = async () => {
            const sid = btn.getAttribute('data-grade-student'), aid = btn.getAttribute('data-grade-assignment');
            const val = btn.getAttribute('data-grade-value');
            const stu = st.students.find(x => x.id === sid);
            const a = st.assignments.find(x => x.id === aid);
            const g = gradeOf(sid, aid);
            const nextVal = (g && g.correctness === val) ? '' : val;
            const payload = {
                studentId: sid,
                studentName: stu ? stu.name : '',
                assignmentId: aid,
                assignmentName: a ? a.name : '',
                correctness: nextVal,
                corrected: nextVal === '有錯' ? (g ? g.corrected : false) : false
            };
            let existing = gradingRecs.find(x => x.studentId === sid && x.assignmentId === aid);
            if (existing) Object.assign(existing, payload); else gradingRecs.push(payload);
            renderGradingTab(gradingRecs, recs, st, state);
            await adminSetGrading(payload);
        };
    });

    document.querySelectorAll('[data-corrected-student]').forEach(btn => {
        btn.onclick = async () => {
            const sid = btn.getAttribute('data-corrected-student'), aid = btn.getAttribute('data-corrected-assignment');
            const stu = st.students.find(x => x.id === sid);
            const a = st.assignments.find(x => x.id === aid);
            const g = gradeOf(sid, aid);
            const payload = {
                studentId: sid,
                studentName: stu ? stu.name : '',
                assignmentId: aid,
                assignmentName: a ? a.name : '',
                correctness: '有錯',
                corrected: !(g && g.corrected)
            };
            let existing = gradingRecs.find(x => x.studentId === sid && x.assignmentId === aid);
            if (existing) Object.assign(existing, payload); else gradingRecs.push(payload);
            renderGradingTab(gradingRecs, recs, st, state);
            await adminSetGrading(payload);
        };
    });

    // 5. 加點功能
    const sel = $('pointsStudentSelect');
    if (sel) {
        const curSel = sel.value;
        sel.innerHTML = '<option value="">請選擇學生</option>' + students.map(s => `<option value="${escapeHtml(s.id)}">${escapeHtml(s.name)}</option>`).join('');
        sel.value = [...sel.options].some(o => o.value === curSel) ? curSel : '';
    }

    const calcPointsBtn = $('calcPointsBtn');
    if (calcPointsBtn) {
        calcPointsBtn.onclick = async () => {
            const sid = sel.value;
            if (!sid) { showAlert('請先選擇學生'); return; }
            const stu = st.students.find(x => x.id === sid);
            if (!stu) return;

            const eligible = gradingRecs.filter(g => {
                if (g.studentId !== sid || g.pointsGiven || pointsOf(g, st) <= 0) return false;
                return true;
            });
            if (!eligible.length) {
                $('pointsResult').innerHTML = `<p class="empty-hint">「${escapeHtml(stu.name)}」目前沒有可加點的項目</p>`;
                return;
            }
            const items = eligible.map(g => ({
                assignmentId: g.assignmentId,
                assignmentName: g.assignmentName,
                type: g.correctness === '全對' ? '全對' : '訂正完成',
                points: pointsOf(g, st)
            }));
            const total = items.reduce((sum, i) => sum + i.points, 0);
            const dateLimit = getLatestEligibleAssignmentDate(eligible, st, state.archiveDocsMap, state.extraPastAssignments);
            const dateMsg = dateLimit ? `\n（計算到 ${dateLimit} 的作業）` : '';
            const ok = await askConfirm(`要幫「${stu.name}」加 ${total} 點嗎？${dateMsg}`);
            if (!ok) return;

            const batch = writeBatch(db);
            eligible.forEach(g => batch.set(doc(gradingColl, recordDocId(sid, g.assignmentId)), { pointsGiven: true }, { merge: true }));
            await batch.commit().catch(e => logger.warn('CALC_POINTS_BATCH_FAILED', e));
            await addDoc(pointLogsColl, {
                studentId: sid,
                studentName: stu.name,
                timestamp: Date.now(),
                dateLabel: todayStr(),
                totalPoints: total,
                items
            }).catch(e => logger.warn('POINT_LOG_WRITE_FAILED', e));
            const resultDateMsg = dateLimit ? `（計算到 ${dateLimit} 的作業）` : '';
            $('pointsResult').innerHTML = `<p>已幫「${escapeHtml(stu.name)}」加 <strong>${total}</strong> 點${resultDateMsg}</p>`;
        };
    }

    // 6. 加點紀錄與匯出（修復 [object Object] Bug）
    const loadPointLogsBtn = $('loadPointLogsBtn');
    if (loadPointLogsBtn) {
        loadPointLogsBtn.onclick = async () => {
            $('pointLogsList').innerHTML = '<p class="empty-hint">載入中…</p>';
            try {
                const snap = await getDocs(query(pointLogsColl, orderBy('timestamp', 'desc')));
                const list = snap.docs.map(d => ({ id: d.id, ...d.data() }));
                $('pointLogsList').innerHTML = list.length ? list.map(l => `
                    <div class="assignment-row">
                        <span class="assignment-name">${escapeHtml(l.dateLabel || '')}　${escapeHtml(l.studentName)}　+${l.totalPoints}點</span>
                        <button class="btn small outline danger" data-undo-log="${escapeHtml(l.id)}">撤銷</button>
                    </div>`).join('') : '<p class="empty-hint">尚無加點紀錄</p>';

                $('pointLogsList').querySelectorAll('[data-undo-log]').forEach(btn => {
                    btn.onclick = async () => {
                        const logId = btn.getAttribute('data-undo-log');
                        const item = list.find(x => x.id === logId);
                        if (!item) return;
                        const ok2 = await askConfirm(`撤銷「${item.studentName} +${item.totalPoints}點」這筆加點紀錄嗎？`);
                        if (!ok2) return;
                        const undoBatch = writeBatch(db);
                        (item.items || []).forEach(i => undoBatch.set(doc(gradingColl, recordDocId(item.studentId, i.assignmentId)), { pointsGiven: false }, { merge: true }));
                        undoBatch.delete(doc(db, 'pointLogs', logId));
                        await undoBatch.commit().catch(e => logger.warn('UNDO_POINT_LOG_FAILED', e));
                        $('loadPointLogsBtn').click();
                    };
                });
            } catch (e) {
                logger.error('LOAD_POINT_LOGS_FAILED', e);
                $('pointLogsList').innerHTML = '<p class="empty-hint">載入失敗</p>';
            }
        };
    }

    const exportTodayPointsBtn = $('exportTodayPointsBtn');
    if (exportTodayPointsBtn) {
        exportTodayPointsBtn.onclick = async () => {
            try {
                const today = todayStr();
                const snap = await getDocs(query(pointLogsColl, orderBy('timestamp', 'desc')));
                const list = snap.docs.map(d => d.data()).filter(l => l.dateLabel === today);
                if (!list.length) { showAlert('今天還沒有任何加點紀錄'); return; }
                // 修復：調用 formatPointLogItems，絕不產生 [object Object]
                const text = list.map(l => `${l.studentName} +${l.totalPoints}點（${formatPointLogItems(l.items)}）`).join('\n');
                await navigator.clipboard.writeText(`${today} 加點紀錄\n${text}`);
                showAlert('今天的加點紀錄已複製');
            } catch (e) {
                logger.error('EXPORT_TODAY_POINTS_FAILED', e);
                showAlert('匯出失敗，請檢查網路後重試');
            }
        };
    }
}

export function setGradingViewMode(mode) {
    gradingViewMode = mode;
}

const makeupStatsExpanded = new Set();

function ensureMakeupStatsModalElement() {
    let modal = document.getElementById('makeupStatsModal');
    if (modal) return modal;
    modal = document.createElement('div');
    modal.id = 'makeupStatsModal';
    modal.className = 'modal-overlay';
    modal.innerHTML = `
        <div class="modal-content" style="width:min(760px, 94vw); max-width:760px; text-align:left; padding:26px 28px;">
            <p class="modal-title" style="text-align:center; margin-bottom:14px; white-space:normal;">期中／期末 作業補繳與未繳統計</p>
            <div style="background:var(--bg); border:1px solid var(--line); border-radius:14px; padding:12px 14px; margin-bottom:14px;">
                <div class="date-range-row" style="align-items:flex-end; margin-bottom:10px;">
                    <div class="field">
                        <label>開始日期（可留空＝不限）</label>
                        <input type="date" id="msStartDate" class="txt-input" style="margin:0; text-align:center;">
                    </div>
                    <div class="field">
                        <label>結束日期（可留空＝不限）</label>
                        <input type="date" id="msEndDate" class="txt-input" style="margin:0; text-align:center;">
                    </div>
                    <button type="button" class="btn small outline" id="msResetDateBtn" style="height:40px; flex-shrink:0;">全部期間</button>
                </div>
                <div style="display:flex; flex-wrap:wrap; gap:14px; font-size:0.9em; color:var(--text);">
                    <label style="display:flex; align-items:center; gap:6px; cursor:pointer; margin:0;">
                        <input type="checkbox" id="msIncludeContactChk" checked style="width:auto; margin:0;">包含聯絡簿每日任務
                    </label>
                    <label style="display:flex; align-items:center; gap:6px; cursor:pointer; margin:0;">
                        <input type="checkbox" id="msIncludeActiveChk" style="width:auto; margin:0;">包含今日尚未封存作業
                    </label>
                    <label style="display:flex; align-items:center; gap:6px; cursor:pointer; margin:0;">
                        <input type="checkbox" id="msShowAllStudentsChk" style="width:auto; margin:0;">顯示全班（含無缺補交紀錄者）
                    </label>
                </div>
            </div>
            <div id="msSummaryBanner" style="font-size:0.9em; color:var(--muted); margin-bottom:8px;"></div>
            <div id="msResultBody" style="max-height:50vh; overflow-y:auto; margin-bottom:18px; padding-right:4px;"></div>
            <div class="modal-actions" style="flex-wrap:wrap; gap:10px;">
                <button type="button" class="btn small outline" id="msExpandAllBtn" style="padding:9px 20px; font-size:0.95em;">全部展開</button>
                <button type="button" class="btn-ok" id="msCopyReportBtn" style="padding:9px 24px; font-size:1em;">複製統計報表</button>
                <button type="button" class="btn-cancel" id="msCloseBtn" style="padding:9px 24px; font-size:1em;">關閉</button>
            </div>
        </div>
    `;
    document.body.appendChild(modal);
    return modal;
}

export function openMakeupStatsModal({ settings, records, gradingRecords, state = {} }) {
    const modal = ensureMakeupStatsModalElement();
    const st = settings || { groups: [], students: [], subjects: [], assignments: [] };
    const recs = records || [];
    const gradingRecs = gradingRecords || [];

    const startInp = document.getElementById('msStartDate');
    const endInp = document.getElementById('msEndDate');
    const resetDateBtn = document.getElementById('msResetDateBtn');
    const includeContactChk = document.getElementById('msIncludeContactChk');
    const includeActiveChk = document.getElementById('msIncludeActiveChk');
    const showAllChk = document.getElementById('msShowAllStudentsChk');
    const bannerEl = document.getElementById('msSummaryBanner');
    const bodyEl = document.getElementById('msResultBody');
    const expandAllBtn = document.getElementById('msExpandAllBtn');
    const copyBtn = document.getElementById('msCopyReportBtn');
    const closeBtn = document.getElementById('msCloseBtn');

    let latestStats = null;

    const getOptions = () => ({
        settings: st,
        records: recs,
        gradingRecords: gradingRecs,
        archiveDocsList: state.archiveDocsList,
        archiveDocsMap: state.archiveDocsMap,
        extraPastAssignments: state.extraPastAssignments,
        startDate: startInp ? startInp.value : '',
        endDate: endInp ? endInp.value : '',
        includeContactBook: includeContactChk ? includeContactChk.checked : true,
        includeActive: includeActiveChk ? includeActiveChk.checked : false,
        includeCleanStudents: showAllChk ? showAllChk.checked : false
    });

    const renderDetailRow = (studentId, item, categoryLabel, categoryStyle) => {
        const leaveBtnLabel = item.isLeave ? '✓請假（取消）' : '標記請假';
        const remarkSpan = item.remark ? `<span style="font-size:0.82em; color:var(--muted); margin-left:6px;">（${escapeHtml(item.remark)}）</span>` : '';
        return `
            <div style="display:flex; align-items:center; justify-content:space-between; gap:8px; padding:6px 0; border-bottom:1px dashed var(--line); font-size:0.92em;">
                <div style="flex:1; min-width:0; line-height:1.4;">
                    <span style="display:inline-block; padding:1px 8px; border-radius:10px; font-size:0.8em; margin-right:6px; ${categoryStyle}">${categoryLabel}</span>
                    <strong>${escapeHtml(item.displayName)}</strong>${remarkSpan}
                </div>
                <button type="button" class="leave-btn ${item.isLeave ? 'active' : ''}"
                    data-ms-leave-student="${escapeHtml(studentId)}"
                    data-ms-leave-aid="${escapeHtml(item.assignmentId)}"
                    data-ms-leave-doc="${escapeHtml(item.archiveDocId || '')}"
                    data-ms-leave-active="${item.isActive ? '1' : '0'}"
                    data-ms-leave-name="${escapeHtml(item.assignmentName || '')}"
                    data-ms-leave-subj="${escapeHtml(item.subjectName || '')}"
                    style="flex-shrink:0;">${leaveBtnLabel}</button>
            </div>
        `;
    };

    const renderStatsContent = () => {
        const scrollTop = bodyEl.scrollTop;
        const opts = getOptions();
        latestStats = computeMakeupAndLeaveStats(opts);

        bannerEl.textContent = `統計範圍共 ${latestStats.assignmentCount} 項作業｜符合條件學生：${latestStats.students.length} 人（全班 ${latestStats.allStudentsCount} 人）`;

        if (!latestStats.students.length) {
            bodyEl.innerHTML = '<p class="empty-hint">目前篩選期間內沒有任何補繳、未繳或請假紀錄</p>';
            return;
        }

        const allVisibleExpanded = latestStats.students.filter(s => s.hasAnyRecord).every(s => makeupStatsExpanded.has(s.studentId));
        if (expandAllBtn) {
            expandAllBtn.textContent = allVisibleExpanded ? '全部收合' : '全部展開';
        }

        bodyEl.innerHTML = latestStats.students.map(stItem => {
            const sName = String(stItem.studentName || '').trim();
            const hasSeatPrefix = stItem.seat != null && stItem.seat !== '' && !sName.startsWith(String(stItem.seat));
            const displayStudent = hasSeatPrefix ? `${stItem.seat}號 ${sName}` : sName;
            const isExp = makeupStatsExpanded.has(stItem.studentId);

            const badges = [];
            if (stItem.regularMakeup.length > 0) {
                badges.push(`<span class="stats-pill makeup">已補 ${stItem.regularMakeup.length}</span>`);
            }
            if (stItem.regularMissing.length > 0) {
                badges.push(`<span class="stats-pill missing">未繳 ${stItem.regularMissing.length}</span>`);
            }
            if (stItem.totalRegularCount === 0 && stItem.totalLeaveCount === 0) {
                badges.push(`<span class="stats-pill clean">無缺補交</span>`);
            }
            if (stItem.totalLeaveCount > 0) {
                badges.push(`<span class="stats-pill leave">請假 ${stItem.totalLeaveCount}（已補 ${stItem.leaveMakeup.length}／未繳 ${stItem.leaveMissing.length}）</span>`);
            }

            const detailsHtml = stItem.hasAnyRecord ? [
                ...stItem.regularMakeup.map(it => renderDetailRow(stItem.studentId, it, '已補', 'background:rgba(47,111,176,0.14);color:#2f6fb0;border:1px solid #2f6fb0;')),
                ...stItem.regularMissing.map(it => renderDetailRow(stItem.studentId, it, '未繳', 'background:rgba(196,103,79,0.14);color:var(--danger);border:1px solid var(--danger);')),
                ...stItem.leaveMakeup.map(it => renderDetailRow(stItem.studentId, it, '請假・已補', 'background:rgba(123,94,167,0.15);color:#7b5ea7;border:1px solid #7b5ea7;')),
                ...stItem.leaveMissing.map(it => renderDetailRow(stItem.studentId, it, '請假・未繳', 'background:rgba(184,134,12,0.16);color:#946b00;border:1px solid #b8860c;'))
            ].join('') : '<p style="margin:4px 0; font-size:0.88em; color:var(--muted);">全部準時繳交，無補繳或請假紀錄</p>';

            return `
                <div class="group-block" style="margin-bottom:10px; padding:10px 14px;">
                    <div style="display:flex; align-items:center; justify-content:space-between; gap:8px; flex-wrap:wrap;">
                        <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
                            <strong style="font-size:1.02em;">${escapeHtml(displayStudent)}</strong>
                            ${badges.join('')}
                        </div>
                        ${stItem.hasAnyRecord ? `<button type="button" class="btn small outline" data-ms-toggle="${escapeHtml(stItem.studentId)}">${isExp ? '收合明細' : '明細 / 標記請假'}</button>` : ''}
                    </div>
                    <div style="display:${isExp ? 'block' : 'none'}; margin-top:8px; padding-top:6px; border-top:1px solid var(--line);">
                        ${detailsHtml}
                    </div>
                </div>
            `;
        }).join('');

        bodyEl.scrollTop = scrollTop;

        bodyEl.querySelectorAll('[data-ms-toggle]').forEach(btn => {
            btn.onclick = () => {
                const sid = btn.getAttribute('data-ms-toggle');
                if (makeupStatsExpanded.has(sid)) makeupStatsExpanded.delete(sid);
                else makeupStatsExpanded.add(sid);
                renderStatsContent();
            };
        });

        bodyEl.querySelectorAll('[data-ms-leave-student]').forEach(btn => {
            btn.onclick = async () => {
                const sid = btn.getAttribute('data-ms-leave-student');
                const aid = btn.getAttribute('data-ms-leave-aid');
                const docId = btn.getAttribute('data-ms-leave-doc');
                const isActive = btn.getAttribute('data-ms-leave-active') === '1';
                const aName = btn.getAttribute('data-ms-leave-name') || '';
                const subjName = btn.getAttribute('data-ms-leave-subj') || '';

                const stu = (st.students || []).find(x => x.id === sid);
                const grp = (st.groups || []).find(x => x.id === stu?.groupId);
                const subjObj = (st.subjects || []).find(x => x.name === subjName);

                let archiveDoc = null;
                if (!isActive) {
                    if (docId && Array.isArray(state.archiveDocsList)) {
                        archiveDoc = state.archiveDocsList.find(d => (d._id || d.id) === docId) || null;
                    }
                    if (!archiveDoc && state.archiveDocsMap) {
                        archiveDoc = (docId && state.archiveDocsMap[docId]) || state.archiveDocsMap[aid] || null;
                    }
                }

                const collidesWithActiveContact = !isActive && (st.assignments || []).some(a => a.name === '聯絡簿每日任務' && a.id === aid);
                const liveRec = !collidesWithActiveContact ? recs.find(r => r.studentId === sid && r.assignmentId === aid) : null;
                const archRec = archiveDoc && (archiveDoc.records || []).find(r => r.studentId === sid && r.assignmentId === aid);

                const curStatus = deriveRecordStatus(liveRec, archRec ? archRec.status : '未繳');
                const curSign = deriveRecordSign(liveRec, archRec ? archRec.signStatus : '未簽名');
                const curRemark = deriveRecordRemark(liveRec, archRec);
                const curLeave = isRecordLeave(liveRec, archRec);
                const curMakeup = isRecordMakeup(liveRec, archRec, curStatus);

                const nextLeave = !curLeave;
                const remarkText = toggleLeaveRemark(curRemark, nextLeave);

                const payload = {
                    groupId: grp ? grp.id : '',
                    groupName: grp ? grp.name : '',
                    studentId: sid,
                    studentName: stu ? stu.name : '',
                    subjectId: subjObj ? subjObj.id : '',
                    subjectName: subjName,
                    assignmentId: aid,
                    assignmentName: aName,
                    status: curStatus,
                    signStatus: curSign,
                    remark: remarkText,
                    isLeave: nextLeave,
                    isMakeup: curMakeup
                };

                if (!collidesWithActiveContact) {
                    let r = recs.find(rx => rx.studentId === sid && rx.assignmentId === aid);
                    if (r) Object.assign(r, payload); else recs.push(payload);
                }

                if (archiveDoc) {
                    if (!archiveDoc.records) archiveDoc.records = [];
                    const archIdx = archiveDoc.records.findIndex(x => x.studentId === sid && x.assignmentId === aid);
                    if (archIdx !== -1) {
                        Object.assign(archiveDoc.records[archIdx], {
                            status: curStatus,
                            signStatus: curSign,
                            remark: remarkText,
                            isLeave: nextLeave,
                            isMakeup: curMakeup
                        });
                    } else {
                        archiveDoc.records.push({ ...payload });
                    }
                    archiveDoc.records = sanitizeArchiveRecords(archiveDoc.records);
                    const realDocId = archiveDoc._id || archiveDoc.id || docId;
                    if (state.archiveDocsMap && realDocId) {
                        if (state.archiveDocsMap[realDocId]) state.archiveDocsMap[realDocId].records = archiveDoc.records;
                        if (state.archiveDocsMap[aid] === archiveDoc) state.archiveDocsMap[aid].records = archiveDoc.records;
                    }
                    if (state.refreshOpenArchiveDetail && realDocId) {
                        state.refreshOpenArchiveDetail(realDocId);
                    }
                }

                renderStatsContent();
                renderGradingTab(gradingRecs, recs, st, state);

                if (!collidesWithActiveContact) {
                    await adminSetStatus(payload);
                }
                if (archiveDoc) {
                    const realDocId = archiveDoc._id || archiveDoc.id || docId;
                    if (realDocId) {
                        await setDoc(doc(db, 'archives', realDocId), { records: archiveDoc.records }, { merge: true }).catch(e => logger.warn('UPDATE_ARCHIVE_LEAVE_FAILED', e));
                    }
                }
            };
        });
    };

    if (startInp) startInp.onchange = renderStatsContent;
    if (endInp) endInp.onchange = renderStatsContent;
    if (resetDateBtn) {
        resetDateBtn.onclick = () => {
            if (startInp) startInp.value = '';
            if (endInp) endInp.value = '';
            renderStatsContent();
        };
    }
    if (includeContactChk) includeContactChk.onchange = renderStatsContent;
    if (includeActiveChk) includeActiveChk.onchange = renderStatsContent;
    if (showAllChk) showAllChk.onchange = renderStatsContent;

    if (expandAllBtn) {
        expandAllBtn.onclick = () => {
            if (!latestStats) return;
            const withRecords = latestStats.students.filter(s => s.hasAnyRecord);
            const allExp = withRecords.every(s => makeupStatsExpanded.has(s.studentId));
            if (allExp) {
                withRecords.forEach(s => makeupStatsExpanded.delete(s.studentId));
            } else {
                withRecords.forEach(s => makeupStatsExpanded.add(s.studentId));
            }
            renderStatsContent();
        };
    }

    if (copyBtn) {
        copyBtn.onclick = async () => {
            const opts = getOptions();
            const stats = computeMakeupAndLeaveStats(opts);
            const reportText = formatMakeupAndLeaveReport(stats, {
                className: st.className || '',
                startDate: opts.startDate,
                endDate: opts.endDate,
                includeContactBook: opts.includeContactBook
            });
            try {
                await navigator.clipboard.writeText(reportText);
                showAlert('作業補繳與未繳統計報表已複製！');
            } catch (e) {
                showAlert('複製失敗，請檢查瀏覽器權限');
            }
        };
    }

    if (closeBtn) {
        closeBtn.onclick = () => { modal.style.display = 'none'; };
    }

    renderStatsContent();
    modal.style.display = 'flex';
}

