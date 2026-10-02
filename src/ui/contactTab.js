/**
 * 班級作業登記系統 - 聯絡簿分頁 (Contact Tab)
 */

import {
    badgeClass,
    signClass,
    sortBySeat,
    isPulledOut,
    escapeHtml,
    todayStr,
    todayISODate,
    deriveRecordStatus,
    deriveRecordSign
} from '../domain/rules.js';

import {
    db,
    archivesColl,
    adminSetStatus,
    adminSetGrading,
    saveSettings,
    clearRecordsForAssignment,
    clearGradingForAssignment
} from '../services/firebase.js';

import { showAlert, askInput, askConfirm } from './modals.js';
import { logger } from '../utils/logger.js';
import { addDoc } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

const $ = id => document.getElementById(id);
let contactViewMode = 'seat';

function renderContactRow(s, dailyAsg, dSubj, recs, gradingRecs) {
    const sName = escapeHtml(s.name);
    if (isPulledOut(s, dSubj ? dSubj.name : '')) {
        return `<div class="daily-row no-sign">
            <span class="student-name">${sName}</span>
            <span class="row-slot-pill"><span class="pulled-out-pill">抽離</span></span>
            <span class="row-slot-icon"></span>
            <span class="row-slot-icon"></span>
            <span class="row-slot-corrected"><button type="button" class="corrected-btn" style="visibility:hidden;pointer-events:none">訂正</button></span>
            <span class="row-slot-icon"></span>
        </div>`;
    }

    const rec = recs.find(r => r.studentId === s.id && r.assignmentId === dailyAsg.id);
    const dStatus = deriveRecordStatus(rec, '未繳');
    const dSign = deriveRecordSign(rec, '未簽名');
    const dSignDisplay = dSign === '未簽名' ? '未簽' : dSign;
    const g = gradingRecs.find(x => x.studentId === s.id && x.assignmentId === dailyAsg.id);
    const dGrade = g ? g.correctness : '';
    const showCorrected = dGrade === '有錯';

    const statusBtn = `<button type="button" class="cell-status-btn ${badgeClass(dStatus)}" data-daily-status-toggle>${escapeHtml(dStatus)}</button>`;
    const signBtn = `<button type="button" class="cell-status-btn cell-sign-btn ${signClass(dSign)}" data-daily-sign-toggle>${escapeHtml(dSignDisplay)}</button>`;
    const correctedBtn = `<button type="button" class="corrected-btn ${g && g.corrected ? 'active' : ''}" data-daily-corrected="1" style="visibility:${showCorrected ? 'visible' : 'hidden'};pointer-events:${showCorrected ? 'auto' : 'none'}">${g && g.corrected ? '✓訂正' : '訂正'}</button>`;

    return `<div class="daily-row" data-daily-student="${escapeHtml(s.id)}">
        <span class="student-name">${sName}</span>
        <span class="row-slot-pill">${statusBtn}</span>
        <span class="row-slot-pill">${signBtn}</span>
        <span class="row-slot-icon"><button type="button" class="grade-btn ${dGrade === '全對' ? 'active g-ok' : ''}" data-daily-grade="全對" title="全對">✓</button></span>
        <span class="row-slot-icon"><button type="button" class="grade-btn ${dGrade === '有錯' ? 'active g-err' : ''}" data-daily-grade="有錯" title="有錯">▲</button></span>
        <span class="row-slot-corrected">${correctedBtn}</span>
        <span class="row-slot-icon"><button type="button" class="grade-btn ${dGrade === '沒寫任務' ? 'active g-lost' : ''}" data-daily-grade="沒寫任務" title="沒寫任務">－</button></span>
    </div>`;
}

/**
 * 修正關鍵 Bug：確保參數順序永遠為 (records, gradingRecords, settings)
 */
export function renderContactTab(records, gradingRecords, settings, isAdmin = false) {
    const panel = $('tabContact');
    if (!panel) return;

    const recs = records || [];
    const gradingRecs = gradingRecords || [];
    const st = settings || { groups: [], students: [], subjects: [], assignments: [] };

    const dailyAsg = (st.assignments || []).find(a => a.name === '聯絡簿每日任務');
    const dailyBox = $('dailyQuickGradeList');

    const seatBtn = $('contactViewSeatBtn');
    const groupBtn = $('contactViewGroupBtn');
    if (seatBtn) seatBtn.className = 'btn small' + (contactViewMode === 'seat' ? '' : ' outline');
    if (groupBtn) groupBtn.className = 'btn small' + (contactViewMode === 'group' ? '' : ' outline');

    const allStudents = sortBySeat(st.students).filter(s =>
        !isPulledOut(s, dailyAsg ? ((st.subjects || []).find(x => x.id === dailyAsg.subjectId)?.name || '') : '')
    );

    const missingList = [], unsignedList = [], uncorrectedList = [], notWrittenList = [];
    if (dailyAsg) {
        allStudents.forEach(s => {
            const rec = recs.find(r => r.studentId === s.id && r.assignmentId === dailyAsg.id);
            const dStatus = deriveRecordStatus(rec, '未繳');
            const dSign = deriveRecordSign(rec, '未簽名');
            if (dStatus !== '已繳') missingList.push(s.name);
            if (dStatus === '已繳' && dSign !== '已簽名') unsignedList.push(s.name);
            const g = gradingRecs.find(x => x.studentId === s.id && x.assignmentId === dailyAsg.id);
            if (g && g.correctness === '有錯' && !g.corrected) uncorrectedList.push(s.name);
            if (g && g.correctness === '沒寫任務') notWrittenList.push(s.name);
        });
    }

    const contactStatDefs = [
        { label: '未繳', val: missingList.length, list: missingList },
        { label: '未簽名', val: unsignedList.length, list: unsignedList },
        { label: '未訂正', val: uncorrectedList.length, list: uncorrectedList },
        { label: '沒寫任務', val: notWrittenList.length, list: notWrittenList }
    ];

    const contactCardsEl = $('contactStatCards');
    if (contactCardsEl) {
        contactCardsEl.innerHTML = contactStatDefs.map(d =>
            `<div class="stat-card clickable" data-contact-stat="${d.label}"><div class="stat-num">${d.val}</div><div class="stat-label">${d.label}</div></div>`
        ).join('');

        contactCardsEl.querySelectorAll('[data-contact-stat]').forEach(el => {
            el.onclick = () => {
                const label = el.getAttribute('data-contact-stat');
                const d = contactStatDefs.find(x => x.label === label);
                $('missingListTitle').textContent = `聯絡簿${label}詳情`;
                $('missingListBody').innerHTML = `<p>${d.list.length ? d.list.map(n => escapeHtml(n)).join('、') : '無'}</p>`;
                $('missingListModal').style.display = 'flex';
            };
        });
    }

    if (!dailyBox) return;

    if (!dailyAsg) {
        dailyBox.innerHTML = '<p class="empty-hint">目前沒有「聯絡簿每日任務」這項作業</p>';
    } else {
        const dSubj = (st.subjects || []).find(x => x.id === dailyAsg.subjectId);
        if (contactViewMode === 'group') {
            dailyBox.innerHTML = (st.groups || []).map(g => {
                const gStudents = sortBySeat((st.students || []).filter(s => s.groupId === g.id));
                return `<div class="group-block">
                    <div class="group-block-head"><strong>${escapeHtml(g.name)}</strong></div>
                    ${gStudents.length ? gStudents.map(s => renderContactRow(s, dailyAsg, dSubj, recs, gradingRecs)).join('') : '<p class="empty-hint">此組別尚無學生</p>'}
                </div>`;
            }).join('') || '<p class="empty-hint">尚未新增組別</p>';
        } else {
            const students = sortBySeat(st.students);
            dailyBox.innerHTML = students.map(s => renderContactRow(s, dailyAsg, dSubj, recs, gradingRecs)).join('') || '<p class="empty-hint">尚未新增學生</p>';
        }

        dailyBox.querySelectorAll('[data-daily-status-toggle]').forEach(btn => {
            btn.onclick = async () => {
                const row = btn.closest('.daily-row');
                const sid = row.getAttribute('data-daily-student');
                const stu = st.students.find(x => x.id === sid);
                const grp = st.groups.find(x => x.id === stu?.groupId);
                const cur = recs.find(x => x.studentId === sid && x.assignmentId === dailyAsg.id);
                const curStatus = deriveRecordStatus(cur, '未繳');
                const curSign = deriveRecordSign(cur, '未簽名');
                const nv = (curStatus === '已繳') ? '未繳' : '已繳';
                const payload = {
                    groupId: grp ? grp.id : '',
                    groupName: grp ? grp.name : '',
                    studentId: sid,
                    studentName: stu ? stu.name : '',
                    subjectId: dailyAsg.subjectId || '',
                    subjectName: dSubj ? dSubj.name : '',
                    assignmentId: dailyAsg.id,
                    assignmentName: dailyAsg.name,
                    status: nv,
                    signStatus: curSign
                };
                let r = recs.find(x => x.studentId === sid && x.assignmentId === dailyAsg.id);
                if (r) Object.assign(r, payload); else recs.push(payload);
                renderContactTab(recs, gradingRecs, st, isAdmin);
                await adminSetStatus(payload);
            };
        });

        dailyBox.querySelectorAll('[data-daily-sign-toggle]').forEach(btn => {
            btn.onclick = async () => {
                const row = btn.closest('.daily-row');
                const sid = row.getAttribute('data-daily-student');
                const stu = st.students.find(x => x.id === sid);
                const grp = st.groups.find(x => x.id === stu?.groupId);
                const cur = recs.find(x => x.studentId === sid && x.assignmentId === dailyAsg.id);
                const curStatus = deriveRecordStatus(cur, '未繳');
                const currentText = btn.textContent.trim();
                const nv = (currentText === '已簽名' || currentText === '已簽') ? '未簽名' : '已簽名';
                const payload = {
                    groupId: grp ? grp.id : '',
                    groupName: grp ? grp.name : '',
                    studentId: sid,
                    studentName: stu ? stu.name : '',
                    subjectId: dailyAsg.subjectId || '',
                    subjectName: dSubj ? dSubj.name : '',
                    assignmentId: dailyAsg.id,
                    assignmentName: dailyAsg.name,
                    status: curStatus,
                    signStatus: nv
                };
                let r = recs.find(x => x.studentId === sid && x.assignmentId === dailyAsg.id);
                if (r) Object.assign(r, payload); else recs.push(payload);
                renderContactTab(recs, gradingRecs, st, isAdmin);
                await adminSetStatus(payload);
            };
        });

        dailyBox.querySelectorAll('[data-daily-grade]').forEach(btn => {
            btn.onclick = async () => {
                const row = btn.closest('.daily-row');
                const sid = row.getAttribute('data-daily-student');
                const stu = st.students.find(x => x.id === sid);
                const val = btn.getAttribute('data-daily-grade');
                const g = gradingRecs.find(x => x.studentId === sid && x.assignmentId === dailyAsg.id);
                const nextVal = (g && g.correctness === val) ? '' : val;
                const payload = {
                    studentId: sid,
                    studentName: stu ? stu.name : '',
                    assignmentId: dailyAsg.id,
                    assignmentName: dailyAsg.name,
                    correctness: nextVal,
                    corrected: nextVal === '有錯' ? (g ? g.corrected : false) : false
                };
                let existingG = gradingRecs.find(x => x.studentId === sid && x.assignmentId === dailyAsg.id);
                if (existingG) Object.assign(existingG, payload); else gradingRecs.push(payload);
                renderContactTab(recs, gradingRecs, st, isAdmin);
                await adminSetGrading(payload);
            };
        });

        dailyBox.querySelectorAll('[data-daily-corrected]').forEach(btn => {
            btn.onclick = async () => {
                const row = btn.closest('.daily-row');
                const sid = row.getAttribute('data-daily-student');
                const stu = st.students.find(x => x.id === sid);
                const g = gradingRecs.find(x => x.studentId === sid && x.assignmentId === dailyAsg.id);
                const payload = {
                    studentId: sid,
                    studentName: stu ? stu.name : '',
                    assignmentId: dailyAsg.id,
                    assignmentName: dailyAsg.name,
                    correctness: '有錯',
                    corrected: !(g && g.corrected)
                };
                let existingG = gradingRecs.find(x => x.studentId === sid && x.assignmentId === dailyAsg.id);
                if (existingG) Object.assign(existingG, payload); else gradingRecs.push(payload);
                renderContactTab(recs, gradingRecs, st, isAdmin);
                await adminSetGrading(payload);
            };
        });
    }
}

export function setContactViewMode(mode) {
    contactViewMode = mode;
}

