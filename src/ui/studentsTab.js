/**
 * 班級作業登記系統 - 學生管理與學期設定分頁 (Students Tab)
 */

import {
    sortBySeat,
    pulloutLabel,
    nextPullout,
    escapeHtml
} from '../domain/rules.js';

import { saveSettings } from '../services/firebase.js';
import { showAlert, askChoice } from './modals.js';

const $ = id => document.getElementById(id);

export function renderStudentsTab(settings, isAdmin, onSettingsChange) {
    const panel = $('tabStudents');
    if (!panel) return;
    const st = settings || { groups: [], students: [], subjects: [], assignments: [], semester: {} };

    // 1. 學期行事曆綁定
    const startDateInp = $('semStartDate');
    const endDateInp = $('semEndDate');
    const skipWeekendsChk = $('skipWeekendsChk');

    if (startDateInp) startDateInp.value = (st.semester && st.semester.startDate) || '';
    if (endDateInp) endDateInp.value = (st.semester && st.semester.endDate) || '';
    if (skipWeekendsChk) skipWeekendsChk.checked = !st.semester || st.semester.skipWeekends !== false;

    function saveSemester(patch) {
        st.semester = { ...(st.semester || { skipWeekends: true, holidays: [] }), ...patch };
        saveSettings({ semester: st.semester }, isAdmin);
        if (onSettingsChange) onSettingsChange();
    }

    if (startDateInp) startDateInp.onchange = () => saveSemester({ startDate: startDateInp.value || '' });
    if (endDateInp) endDateInp.onchange = () => saveSemester({ endDate: endDateInp.value || '' });
    if (skipWeekendsChk) skipWeekendsChk.onchange = () => saveSemester({ skipWeekends: skipWeekendsChk.checked });

    function renderHolidayList() {
        const holidays = (st.semester && st.semester.holidays) || [];
        const holListEl = $('holidayList');
        if (!holListEl) return;
        holListEl.innerHTML = holidays.length
            ? holidays.slice().sort().map(d => `<span class="chip">${escapeHtml(d)}<button data-del-holiday="${escapeHtml(d)}">✕</button></span>`).join('')
            : '<span style="color:var(--muted)">尚未新增假日</span>';

        holListEl.querySelectorAll('[data-del-holiday]').forEach(b => {
            b.onclick = () => {
                const d = b.getAttribute('data-del-holiday');
                st.semester = { ...(st.semester || {}), holidays: ((st.semester && st.semester.holidays) || []).filter(x => x !== d) };
                saveSettings({ semester: st.semester }, isAdmin);
                renderHolidayList();
                if (onSettingsChange) onSettingsChange();
            };
        });
    }

    const addHolidayBtn = $('addHolidayBtn');
    if (addHolidayBtn) {
        addHolidayBtn.onclick = () => {
            const inp = $('newHolidayDate');
            const d = inp ? inp.value : '';
            if (!d) return;
            const holidays = (st.semester && st.semester.holidays) || [];
            if (!holidays.includes(d)) holidays.push(d);
            st.semester = { ...(st.semester || {}), holidays };
            saveSettings({ semester: st.semester }, isAdmin);
            if (inp) inp.value = '';
            renderHolidayList();
            if (onSettingsChange) onSettingsChange();
        };
    }
    renderHolidayList();

    // 2. 組別與學生清單
    function renderGroups() {
        const groupsListEl = $('groupsList');
        if (!groupsListEl) return;
        groupsListEl.innerHTML = (st.groups || []).map(g => `
            <div class="group-block" data-group="${escapeHtml(g.id)}">
                <div class="group-block-head">
                    <strong>${escapeHtml(g.name)}</strong>
                    <button class="btn small outline danger" data-del-group="${escapeHtml(g.id)}">刪除組別</button>
                </div>
                <div class="chip-list">
                    ${sortBySeat((st.students || []).filter(s => s.groupId === g.id)).map(s => {
                        const seatLabel = s.seat != null && s.seat !== '' ? `${escapeHtml(s.seat)}號 ` : '';
                        const hasPullout = s.pullout && (s.pullout.chinese || s.pullout.math);
                        const pulloutTag = hasPullout ? `<span class="sign-tag" style="color:#b8860c">${escapeHtml(pulloutLabel(s.pullout))}</span>` : '';
                        return `<span class="chip">${seatLabel}${escapeHtml(s.name)}${pulloutTag}<button data-pullout-student="${escapeHtml(s.id)}" title="設定抽離上課" style="color:#b8860c">抽</button><button data-move-student="${escapeHtml(s.id)}" title="搬到其他組別" style="color:var(--accent)">⇄</button><button data-del-student="${escapeHtml(s.id)}">✕</button></span>`;
                    }).join('') || '<span style="color:var(--muted)">尚無學生</span>'}
                </div>
                <div class="row inline-add-row" style="margin-bottom:0">
                    <input class="txt-input" data-new-student="${escapeHtml(g.id)}" placeholder="新增學生姓名">
                    <button class="btn" data-add-student="${escapeHtml(g.id)}">新增</button>
                </div>
            </div>`).join('') || '<p class="empty-hint">尚未新增組別</p>';

        groupsListEl.querySelectorAll('[data-del-group]').forEach(b => {
            b.onclick = async () => {
                const gid = b.getAttribute('data-del-group');
                st.groups = (st.groups || []).filter(g => g.id !== gid);
                st.students = (st.students || []).filter(s => s.groupId !== gid);
                await saveSettings({ groups: st.groups, students: st.students }, isAdmin);
                renderGroups();
                if (onSettingsChange) onSettingsChange();
            };
        });

        groupsListEl.querySelectorAll('[data-del-student]').forEach(b => {
            b.onclick = async () => {
                const sid = b.getAttribute('data-del-student');
                st.students = (st.students || []).filter(s => s.id !== sid);
                await saveSettings({ students: st.students }, isAdmin);
                renderGroups();
                if (onSettingsChange) onSettingsChange();
            };
        });

        groupsListEl.querySelectorAll('[data-move-student]').forEach(b => {
            b.onclick = async () => {
                const sid = b.getAttribute('data-move-student');
                const stu = (st.students || []).find(x => x.id === sid);
                if (!stu) return;
                const curGroup = (st.groups || []).find(g => g.id === stu.groupId);
                const otherGroups = (st.groups || []).filter(g => g.id !== stu.groupId);
                if (!otherGroups.length) { showAlert('目前沒有其他組別可以搬'); return; }
                const targetName = await askChoice(`「${stu.name}」目前在「${curGroup ? curGroup.name : ''}」，要搬到哪一組？`, otherGroups.map(g => g.name));
                if (!targetName) return;
                const targetGroup = (st.groups || []).find(g => g.name === targetName);
                if (!targetGroup) return;
                stu.groupId = targetGroup.id;
                await saveSettings({ students: st.students }, isAdmin);
                renderGroups();
                if (onSettingsChange) onSettingsChange();
            };
        });

        groupsListEl.querySelectorAll('[data-pullout-student]').forEach(b => {
            b.onclick = async () => {
                const sid = b.getAttribute('data-pullout-student');
                const stu = (st.students || []).find(x => x.id === sid);
                if (!stu) return;
                stu.pullout = nextPullout(stu.pullout);
                await saveSettings({ students: st.students }, isAdmin);
                renderGroups();
                if (onSettingsChange) onSettingsChange();
            };
        });

        groupsListEl.querySelectorAll('[data-add-student]').forEach(b => {
            b.onclick = async () => {
                const gid = b.getAttribute('data-add-student');
                const nameInp = groupsListEl.querySelector(`[data-new-student="${gid}"]`);
                const name = nameInp ? nameInp.value.trim() : '';
                if (!name) return;
                st.students.push({ id: crypto.randomUUID(), name, groupId: gid });
                await saveSettings({ students: st.students }, isAdmin);
                renderGroups();
                if (onSettingsChange) onSettingsChange();
            };
        });
    }

    const addGroupBtn = $('addGroupBtn');
    if (addGroupBtn) {
        addGroupBtn.onclick = async () => {
            const inp = $('newGroupName');
            const name = inp ? inp.value.trim() : '';
            if (!name) return;
            st.groups.push({ id: crypto.randomUUID(), name });
            await saveSettings({ groups: st.groups }, isAdmin);
            if (inp) inp.value = '';
            renderGroups();
            if (onSettingsChange) onSettingsChange();
        };
    }
    renderGroups();
}

