/**
 * 班級作業登記系統 - 訂正與加點分頁 (Grading Tab)
 */

import {
    badgeClass,
    signClass,
    sortBySeat,
    isPulledOut,
    isExamAssignment,
    pointsOf,
    escapeHtml,
    recordDocId,
    todayStr,
    formatPointLogItems,
    sortArchivedAssignments,
    resolveLostAssignments,
    getLatestEligibleAssignmentDate,
    isGradingMissingExempt
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
    const statusOf = (sid, aid) => { const r = recs.find(x => x.studentId === sid && x.assignmentId === aid); return r ? r.status : '未繳'; };

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
            selPast.innerHTML = '<option value="">請選擇作業</option>' + sortedOpts.map(([id, info]) => `<option value="${escapeHtml(id)}">${info.dateLabel ? escapeHtml(info.dateLabel) + ' ' : ''}${escapeHtml(info.name)}</option>`).join('');
            selPast.value = sortedOpts.some(([id]) => id === curPastSel) ? curPastSel : '';
        }

        if (selSubj) {
            const curSubjSel = selSubj.value;
            selSubj.innerHTML = '<option value="">請先選擇科目</option>' + Object.keys(bySubject).map(sn => `<option value="${escapeHtml(sn)}">${escapeHtml(sn)}</option>`).join('');
            selSubj.value = Object.keys(bySubject).includes(curSubjSel) ? curSubjSel : '';
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

            box.innerHTML = sortBySeat(st.students).map(s => {
                const sName = escapeHtml(s.name);
                if (isPulledOut(s, pastSubjName)) {
                    return `<div class="daily-row ${pastNeedsSign ? '' : 'no-sign'} ${pastNeedsPoints ? 'has-points' : ''}" style="grid-template-columns: minmax(70px, 1fr) 140px ${pastNeedsSign ? '140px ' : ''}38px 38px 76px 38px ${pastNeedsPoints ? '72px' : ''}">
                        <span class="student-name">${sName}</span>
                        <span class="row-slot-pill"><div style="display:flex;gap:6px;align-items:center;justify-content:center;width:100%"><button type="button" class="cell-status-btn" style="background:transparent; color:var(--muted); font-weight:bold; pointer-events:none; box-shadow:none;">抽離</button><button class="btn small outline" style="visibility:hidden;pointer-events:none;">補交</button></div></span>
                        ${pastNeedsSign ? `<span class="row-slot-pill"><div style="display:flex;gap:6px;align-items:center;justify-content:center;width:100%"><button type="button" class="cell-status-btn" style="background:transparent; color:var(--muted); font-weight:bold; pointer-events:none; box-shadow:none;">抽離</button><button class="btn small outline" style="visibility:hidden;pointer-events:none;">補簽</button></div></span>` : ''}
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
                const archRec = archiveDoc && (archiveDoc.records || []).find(r => r.studentId === s.id && r.assignmentId === aid);
                const dStatus = rec ? rec.status : (archRec ? archRec.status : '未繳');
                const dSign = rec && rec.signStatus ? rec.signStatus : (archRec && archRec.signStatus ? archRec.signStatus : '未簽名');
                const dSignDisplay = dSign === '未簽名' ? '未簽' : (dSign === '已簽名' ? '已簽' : dSign);
                const isSigned = dSign === '已簽名';
                const showCorrected = cur === '有錯';
                const statusBtn = `<button type="button" class="cell-status-btn ${badgeClass(dStatus)}" data-past-status-toggle>${escapeHtml(dStatus)}</button>`;
                const isExamOrTest = isExamAssignment(aName);
                const showSign = pastNeedsSign && (isExamOrTest || dStatus === '已繳');
                const signBtn = pastNeedsSign ? `<button type="button" class="cell-status-btn cell-sign-btn ${signClass(dSign)}" data-past-sign-toggle style="visibility:${showSign ? 'visible' : 'hidden'};pointer-events:${showSign ? 'auto' : 'none'}">${escapeHtml(dSignDisplay)}</button>` : '';
                const makeupSignBtn = (pastNeedsSign && !isSigned && showSign) ? `<button class="btn small outline" data-past-makeup-sign="1">補簽</button>` : `<button class="btn small outline" style="visibility:hidden;pointer-events:none;">補簽</button>`;
                const correctedBtn = `<button type="button" class="corrected-btn ${g && g.corrected ? 'active' : ''}" data-past-corrected="1" style="visibility:${showCorrected ? 'visible' : 'hidden'};pointer-events:${showCorrected ? 'auto' : 'none'}">${g && g.corrected ? '✓訂正' : '訂正'}</button>`;
                const makeupBtn = (dStatus !== '已繳') ? `<button class="btn small outline" data-past-makeup="1">補交</button>` : `<button class="btn small outline" style="visibility:hidden;pointer-events:none;">補交</button>`;

                const pts = pointsOf(g, st, pastInfo);
                const pointsSlot = pastNeedsPoints ? `<span class="row-slot-points" style="visibility:${pts > 0 ? 'visible' : 'hidden'}">${pts > 0 ? (g.pointsGiven ? '已加點' : '尚未加點') : '尚未加點'}</span>` : '';

                return `<div class="daily-row ${pastNeedsSign ? '' : 'no-sign'} ${pastNeedsPoints ? 'has-points' : ''}" style="grid-template-columns: minmax(70px, 1fr) 140px ${pastNeedsSign ? '140px ' : ''}38px 38px 76px 38px ${pastNeedsPoints ? '72px' : ''}" data-past-student="${escapeHtml(s.id)}">
                    <span class="student-name">${sName}</span>
                    <span class="row-slot-pill"><div style="display:flex;gap:6px;align-items:center;justify-content:center;width:100%">${statusBtn}${makeupBtn}</div></span>
                    ${pastNeedsSign ? `<span class="row-slot-pill"><div style="display:flex;gap:6px;align-items:center;justify-content:center;width:100%">${signBtn}${makeupSignBtn}</div></span>` : ''}
                    <span class="row-slot-icon"><button type="button" class="grade-btn ${cur === '全對' ? 'active g-ok' : ''}" data-past-grade="全對" title="全對">✓</button></span>
                    <span class="row-slot-icon"><button type="button" class="grade-btn ${cur === '有錯' ? 'active g-err' : ''}" data-past-grade="有錯" title="有錯">▲</button></span>
                    <span class="row-slot-corrected">${correctedBtn}</span>
                    <span class="row-slot-icon"><button type="button" class="grade-btn ${cur === thirdVal ? 'active g-lost' : ''}" data-past-grade="${escapeHtml(thirdVal)}" title="${escapeHtml(thirdVal)}">${thirdIcon}</button></span>
                    ${pointsSlot}
                </div>`;
            }).join('');

            // 修復關鍵 Bug：清理重複綁定，保證更新持久化至 Firestore archives
            box.querySelectorAll('[data-past-status-toggle]').forEach(btn => {
                btn.onclick = async () => {
                    const row = btn.closest('.daily-row');
                    const sid = row.getAttribute('data-past-student');
                    const stu = st.students.find(x => x.id === sid);
                    const grp = st.groups.find(x => x.id === stu?.groupId);
                    const cur2 = recs.find(r => r.studentId === sid && r.assignmentId === aid);
                    const archRec = archiveDoc && (archiveDoc.records || []).find(r => r.studentId === sid && r.assignmentId === aid);
                    const curStatus = cur2 ? cur2.status : (archRec ? archRec.status : '未繳');
                    const curRemark = cur2 ? cur2.remark : (archRec ? archRec.remark : '');
                    const nv = curStatus === '已繳' ? '未繳' : '已繳';
                    const timeStr = new Date().toLocaleString('zh-TW', { hour12: false });
                    const remarkText = nv === '已繳' ? `已補交（${timeStr}）` : curRemark;
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
                        remark: remarkText
                    };
                    await adminSetStatus(payload);
                    let r = recs.find(rx => rx.studentId === sid && rx.assignmentId === aid);
                    if (r) Object.assign(r, payload); else recs.push(payload);

                    if (archiveDoc && archiveDoc._id) {
                        const archIdx = (archiveDoc.records || []).findIndex(x => x.studentId === sid && x.assignmentId === aid);
                        if (archIdx !== -1) {
                            archiveDoc.records[archIdx].status = nv;
                            archiveDoc.records[archIdx].remark = remarkText;
                            await setDoc(doc(db, 'archives', archiveDoc._id), { records: archiveDoc.records }, { merge: true }).catch(e => logger.warn('UPDATE_ARCHIVE_FAILED', e));
                        }
                    }
                    renderPastAssignmentGrader();
                };
            });

            box.querySelectorAll('[data-past-makeup]').forEach(btn => {
                btn.onclick = async () => {
                    const row = btn.closest('.daily-row');
                    const sid = row.getAttribute('data-past-student');
                    const stu = st.students.find(x => x.id === sid);
                    const grp = st.groups.find(x => x.id === stu?.groupId);
                    const timeStr = new Date().toLocaleString('zh-TW', { hour12: false });
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
                        remark: `已補交（${timeStr}）`
                    };
                    await adminSetStatus(payload);
                    let r = recs.find(rx => rx.studentId === sid && rx.assignmentId === aid);
                    if (r) Object.assign(r, payload); else recs.push(payload);

                    if (archiveDoc && archiveDoc._id) {
                        const archIdx = (archiveDoc.records || []).findIndex(x => x.studentId === sid && x.assignmentId === aid);
                        if (archIdx !== -1) {
                            archiveDoc.records[archIdx].status = '已繳';
                            archiveDoc.records[archIdx].remark = payload.remark;
                            await setDoc(doc(db, 'archives', archiveDoc._id), { records: archiveDoc.records }, { merge: true }).catch(e => logger.warn('UPDATE_ARCHIVE_FAILED', e));
                        }
                    }
                    renderPastAssignmentGrader();
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
                    const curSignStatus = cur2 && cur2.signStatus ? cur2.signStatus : (archRec && archRec.signStatus ? archRec.signStatus : '未簽名');
                    const curRemark = cur2 ? cur2.remark : (archRec ? archRec.remark : '');
                    const nv = (curSignStatus === '已簽名' || curSignStatus === '已簽') ? '未簽名' : '已簽名';
                    const timeStr = new Date().toLocaleString('zh-TW', { hour12: false });
                    const remarkText = nv === '已簽名' ? (curRemark ? `${curRemark} / 補簽（${timeStr}）` : `已補簽（${timeStr}）`) : curRemark;
                    const payload = {
                        groupId: grp ? grp.id : '',
                        groupName: grp ? grp.name : '',
                        studentId: sid,
                        studentName: stu ? stu.name : '',
                        subjectId: dSubj ? dSubj.id : '',
                        subjectName: dSubj ? dSubj.name : '',
                        assignmentId: aid,
                        assignmentName: aName,
                        signStatus: nv,
                        remark: remarkText
                    };
                    await adminSetStatus(payload);
                    let r = recs.find(rx => rx.studentId === sid && rx.assignmentId === aid);
                    if (r) { r.signStatus = nv; r.remark = remarkText; } else recs.push(payload);

                    if (archiveDoc && archiveDoc._id) {
                        const archIdx = (archiveDoc.records || []).findIndex(x => x.studentId === sid && x.assignmentId === aid);
                        if (archIdx !== -1) {
                            archiveDoc.records[archIdx].signStatus = nv;
                            archiveDoc.records[archIdx].remark = remarkText;
                            await setDoc(doc(db, 'archives', archiveDoc._id), { records: archiveDoc.records }, { merge: true }).catch(e => logger.warn('UPDATE_ARCHIVE_FAILED', e));
                        }
                    }
                    renderPastAssignmentGrader();
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
                    const curStatus = cur2 ? cur2.status : (archRec ? archRec.status : '未繳');
                    const curRemark = cur2 ? cur2.remark : (archRec ? archRec.remark : '');
                    const remarkText = curRemark ? `${curRemark} / 補簽（${timeStr}）` : `已補簽（${timeStr}）`;
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
                        remark: remarkText
                    };
                    await adminSetStatus(payload);
                    let r = recs.find(rx => rx.studentId === sid && rx.assignmentId === aid);
                    if (r) { r.signStatus = '已簽名'; r.remark = remarkText; } else recs.push(payload);

                    if (archiveDoc && archiveDoc._id) {
                        const archIdx = (archiveDoc.records || []).findIndex(x => x.studentId === sid && x.assignmentId === aid);
                        if (archIdx !== -1) {
                            archiveDoc.records[archIdx].signStatus = '已簽名';
                            archiveDoc.records[archIdx].remark = remarkText;
                            await setDoc(doc(db, 'archives', archiveDoc._id), { records: archiveDoc.records }, { merge: true }).catch(e => logger.warn('UPDATE_ARCHIVE_FAILED', e));
                        }
                    }
                    renderPastAssignmentGrader();
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
                    await adminSetGrading({
                        studentId: sid,
                        studentName: stu ? stu.name : '',
                        assignmentId: aid,
                        assignmentName: aName,
                        correctness: nextVal,
                        corrected: nextCorrected
                    });
                    if (archiveDoc && archiveDoc._id) {
                        const archIdx = (archiveDoc.records || []).findIndex(x => x.studentId === sid && x.assignmentId === aid);
                        if (archIdx !== -1) {
                            archiveDoc.records[archIdx].correctness = nextVal;
                            archiveDoc.records[archIdx].corrected = nextCorrected;
                            await setDoc(doc(db, 'archives', archiveDoc._id), { records: archiveDoc.records }, { merge: true }).catch(e => logger.warn('UPDATE_ARCHIVE_FAILED', e));
                        }
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
                    await adminSetGrading({
                        studentId: sid,
                        studentName: stu ? stu.name : '',
                        assignmentId: aid,
                        assignmentName: aName,
                        correctness: '有錯',
                        corrected: nextCorrected
                    });
                    if (archiveDoc && archiveDoc._id) {
                        const archIdx = (archiveDoc.records || []).findIndex(x => x.studentId === sid && x.assignmentId === aid);
                        if (archIdx !== -1) {
                            archiveDoc.records[archIdx].correctness = '有錯';
                            archiveDoc.records[archIdx].corrected = nextCorrected;
                            await setDoc(doc(db, 'archives', archiveDoc._id), { records: archiveDoc.records }, { merge: true }).catch(e => logger.warn('UPDATE_ARCHIVE_FAILED', e));
                        }
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

    // 3. 全域統計清單彈窗按鈕
    const globalMissingBtn = $('globalMissingListBtn');
    const globalUncorrectedBtn = $('globalUncorrectedListBtn');
    const globalUnsignedBtn = $('globalUnsignedListBtn');
    const globalLostBtn = $('globalLostListBtn');

    if (globalMissingBtn) {
        globalMissingBtn.onclick = () => {
            $('missingListTitle').textContent = '未繳清單';
            const allAssignmentsMap = {};
            (st.assignments || []).filter(a => a.name !== '聯絡簿每日任務').forEach(a => {
                allAssignmentsMap[a.id] = { name: a.name, subjectName: subjNameOf(a) };
            });
            if (state.extraPastAssignments) {
                Object.entries(state.extraPastAssignments).forEach(([id, info]) => {
                    if (!allAssignmentsMap[id]) allAssignmentsMap[id] = { name: info.name, subjectName: info.subjectName };
                });
            }
            const activeAssIds = new Set((st.assignments || []).map(a => a.id));
            const blocks = Object.entries(allAssignmentsMap).map(([id, info]) => {
                const hasGrading = gradingRecs.some(g => g.assignmentId === id);
                const hasRecord = recs.some(r => r.assignmentId === id);
                const archiveDoc = state.archiveDocsMap ? state.archiveDocsMap[id] : null;
                if (!hasGrading && !hasRecord && !activeAssIds.has(id) && !archiveDoc) return '';

                const applicable = sortBySeat(st.students).filter(s => !isPulledOut(s, info.subjectName));
                const missing = applicable.filter(s => {
                    const g = gradingRecs.find(x => x.studentId === s.id && x.assignmentId === id);
                    if (g && (g.correctness === '遺失' || g.correctness === '沒寫任務')) return false;
                    const rec = recs.find(r => r.studentId === s.id && r.assignmentId === id);
                    const archRec = archiveDoc && (archiveDoc.records || []).find(r => r.studentId === s.id && r.assignmentId === id);
                    const status = rec ? rec.status : (archRec ? archRec.status : '未繳');
                    return status !== '已繳';
                });
                if (!missing.length) return '';
                return `<p style="margin-bottom:4px"><strong>${escapeHtml(info.name)}</strong>：${missing.map(s => escapeHtml(s.name)).join('、')}</p>`;
            }).filter(Boolean);
            $('missingListBody').innerHTML = blocks.length ? blocks.join('') : '<p class="empty-hint">目前沒有未繳項目</p>';
            $('missingListModal').style.display = 'flex';
        };
    }

    if (globalUncorrectedBtn) {
        globalUncorrectedBtn.onclick = () => {
            $('missingListTitle').textContent = '未訂正清單';
            const allAssignmentsMap = {};
            (st.assignments || []).filter(a => a.name !== '聯絡簿每日任務' && !a.signOnly).forEach(a => {
                allAssignmentsMap[a.id] = { name: a.name, subjectName: subjNameOf(a) };
            });
            if (state.extraPastAssignments) {
                Object.entries(state.extraPastAssignments).forEach(([id, info]) => {
                    if (!info.signOnly && !allAssignmentsMap[id]) allAssignmentsMap[id] = { name: info.name, subjectName: info.subjectName };
                });
            }
            const blocks = Object.entries(allAssignmentsMap).map(([id, info]) => {
                const hasAnyGrading = gradingRecs.some(g => g.assignmentId === id) || (state.archiveDocsMap && state.archiveDocsMap[id]);
                if (!hasAnyGrading) return '';
                const uncorrected = sortBySeat(st.students).filter(s => {
                    if (isPulledOut(s, info.subjectName)) return false;
                    const g = gradingRecs.find(x => x.studentId === s.id && x.assignmentId === id);
                    return g && g.correctness === '有錯' && !g.corrected;
                });
                if (!uncorrected.length) return '';
                return `<p style="margin-bottom:4px"><strong>${escapeHtml(info.name)}</strong>：${uncorrected.map(s => escapeHtml(s.name)).join('、')}</p>`;
            }).filter(Boolean);
            $('missingListBody').innerHTML = blocks.length ? blocks.join('') : '<p class="empty-hint">目前沒有未訂正項目</p>';
            $('missingListModal').style.display = 'flex';
        };
    }

    if (globalUnsignedBtn) {
        globalUnsignedBtn.onclick = () => {
            $('missingListTitle').textContent = '未簽名清單';
            const allAssignmentsMap = {};
            (st.assignments || []).filter(a => a.name !== '聯絡簿每日任務' && (a.needsSign || a.signOnly)).forEach(a => {
                allAssignmentsMap[a.id] = { name: a.name, subjectName: subjNameOf(a), signOnly: !!a.signOnly };
            });
            if (state.extraPastAssignments) {
                Object.entries(state.extraPastAssignments).forEach(([id, info]) => {
                    if ((info.needsSign || info.signOnly) && !allAssignmentsMap[id]) allAssignmentsMap[id] = { name: info.name, subjectName: info.subjectName, signOnly: !!info.signOnly };
                });
            }
            const blocks = Object.entries(allAssignmentsMap).map(([id, info]) => {
                const applicable = sortBySeat(st.students).filter(s => !isPulledOut(s, info.subjectName));
                const unsigned = applicable.filter(s => {
                    const rec = recs.find(r => r.studentId === s.id && r.assignmentId === id);
                    const archDoc = state.archiveDocsMap ? state.archiveDocsMap[id] : null;
                    const archRec = archDoc && (archDoc.records || []).find(r => r.studentId === s.id && r.assignmentId === id);
                    const status = rec ? rec.status : (archRec ? archRec.status : '未繳');
                    const signStatus = rec ? rec.signStatus : (archRec ? archRec.signStatus : '未簽名');
                    if (info.name === '聯絡簿每日任務') {
                        if (status !== '已繳') return false;
                        return signStatus !== '已簽名';
                    }
                    const isExamOrTest = isExamAssignment(info.name);
                    if (!info.signOnly && !isExamOrTest && status !== '已繳') return false;
                    return signStatus !== '已簽名';
                });
                if (!unsigned.length) return '';
                return `<p style="margin-bottom:4px"><strong>${escapeHtml(info.name)}</strong>：${unsigned.map(s => escapeHtml(s.name)).join('、')}</p>`;
            }).filter(Boolean);
            $('missingListBody').innerHTML = blocks.length ? blocks.join('') : '<p class="empty-hint">目前沒有未簽名項目</p>';
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
        globalLostBtn.onclick = () => {
            renderMissingLostList();
            $('missingListModal').style.display = 'flex';
        };
    }
    if ($('missingListModal') && $('missingListModal').style.display === 'flex' && $('missingListTitle') && $('missingListTitle').textContent === '遺失作業清單') {
        renderMissingLostList();
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
            await adminSetGrading({
                studentId: sid,
                studentName: stu ? stu.name : '',
                assignmentId: aid,
                assignmentName: a ? a.name : '',
                correctness: nextVal,
                corrected: nextVal === '有錯' ? (g ? g.corrected : false) : false
            });
        };
    });

    document.querySelectorAll('[data-corrected-student]').forEach(btn => {
        btn.onclick = async () => {
            const sid = btn.getAttribute('data-corrected-student'), aid = btn.getAttribute('data-corrected-assignment');
            const stu = st.students.find(x => x.id === sid);
            const a = st.assignments.find(x => x.id === aid);
            const g = gradeOf(sid, aid);
            await adminSetGrading({
                studentId: sid,
                studentName: stu ? stu.name : '',
                assignmentId: aid,
                assignmentName: a ? a.name : '',
                correctness: '有錯',
                corrected: !(g && g.corrected)
            });
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

