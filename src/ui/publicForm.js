/**
 * 班級作業登記系統 - 前台小老師登記表單 (Public Form)
 */

import {
    STATUS_LIST,
    SIGN_LIST,
    sortBySeat,
    isPulledOut,
    isExamAssignment,
    escapeHtml
} from '../domain/rules.js';

import {
    coll,
    submitGroupRecords
} from '../services/firebase.js';

import { getDocs, query, where } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { logger } from '../utils/logger.js';

const $ = id => document.getElementById(id);
let lastSettingsJSON = null;

export async function showMissingListForToday(settings) {
    $('missingListTitle').textContent = '今日未繳作業名單';
    if (!settings || !Array.isArray(settings.assignments) || !settings.assignments.length) {
        $('missingListBody').innerHTML = '<p>目前尚無作業</p>';
        $('missingListModal').style.display = 'flex';
        return;
    }
    $('missingListBody').innerHTML = '<p>讀取中…</p>';
    $('missingListModal').style.display = 'flex';

    let recs = [];
    try {
        const snap = await getDocs(coll);
        recs = snap.docs.map(d => d.data());
    } catch (e) {
        logger.error('SHOW_MISSING_LIST_FETCH_FAILED', e);
        $('missingListBody').innerHTML = '<p>讀取失敗，請檢查網路後重試</p>';
        return;
    }

    const students = sortBySeat(settings.students || []);
    const itemsHtml = (settings.assignments || [])
        .filter(a => a.name !== '聯絡簿每日任務')
        .map(a => {
            const subj = (settings.subjects || []).find(x => x.id === a.subjectId);
            const subjName = subj ? subj.name : '';
            const applicable = students.filter(s => !isPulledOut(s, subjName));
            const missing = applicable.filter(s => {
                const rec = recs.find(r => r.studentId === s.id && r.assignmentId === a.id);
                return !rec || rec.status !== '已繳';
            });
            const safeName = escapeHtml(a.name);
            const tag = a.signOnly ? '（只要簽名）' : (a.needsSign ? '（需簽名）' : '');
            let html = `<p style="margin-bottom:4px"><strong>${safeName}</strong>${tag}：${missing.length ? missing.map(s => escapeHtml(s.name)).join('、') : '全部已繳'}</p>`;
            
            if (a.needsSign || a.signOnly) {
                const unsigned = applicable.filter(s => {
                    const rec = recs.find(r => r.studentId === s.id && r.assignmentId === a.id);
                    const stt = rec ? rec.status : '未繳';
                    const sgn = (rec && rec.signStatus) ? rec.signStatus : '未簽名';
                    const isExamOrTest = isExamAssignment(a.name);
                    if (!a.signOnly && !isExamOrTest && stt !== '已繳') return false;
                    return sgn !== '已簽名';
                });
                html += `<p style="margin:0 0 14px;color:var(--muted)">未簽名：${unsigned.length ? unsigned.map(s => escapeHtml(s.name)).join('、') : '全部已簽名'}</p>`;
            }
            return html;
        }).join('');

    $('missingListBody').innerHTML = itemsHtml || '<p>目前尚無作業</p>';
}

export function renderPublic(recs, st, status) {
    const content = $('content');
    if (!content) return;

    if (status && status.error) {
        content.innerHTML = '<p class="empty-hint">載入失敗，請重新整理頁面</p>';
        lastSettingsJSON = null;
        return;
    }

    const hasGroups = st && Array.isArray(st.groups) && st.groups.length && Array.isArray(st.students) && st.students.length;
    const hasSubjects = st && Array.isArray(st.subjects) && st.subjects.length && Array.isArray(st.assignments) && st.assignments.length;
    if (!hasGroups || !hasSubjects) {
        content.innerHTML = '<p class="empty-hint">老師尚未設定班級/科目資料，請登入後台設定</p>';
        lastSettingsJSON = null;
        return;
    }

    const sJSON = JSON.stringify(st);
    if (sJSON !== lastSettingsJSON) {
        lastSettingsJSON = sJSON;
        content.innerHTML = `
            <div class="card">
                <button class="btn outline" id="showMissingListBtn" style="width:100%">今日未繳作業名單</button>
            </div>
            <div class="card">
                <h2>登記作業繳交</h2>
                <div class="field"><label>科目</label><select id="fSubject"></select></div>
                <div class="field"><label>作業</label><select id="fAssignment"></select></div>
                <p id="noAssignmentHint" class="empty-hint" style="display:none">此科目尚無作業，請請老師先設定</p>
                <div id="groupStep" style="display:none">
                    <div class="field"><label>組別</label><select id="fGroup"></select></div>
                    <p id="noStudentHint" class="empty-hint" style="display:none">此組別尚無學生，請請老師先設定</p>
                    <div id="studentStep" style="display:none">
                        <div id="studentRows"></div>
                        <button id="fSubmit" class="btn" style="width:100%;margin-top:14px">送出本組登記</button>
                        <p id="fMsg"></p>
                    </div>
                </div>
            </div>`;

        $('showMissingListBtn').onclick = () => showMissingListForToday(st);

        const subSel = $('fSubject'), aSel = $('fAssignment'), gSel = $('fGroup');
        (st.subjects || []).filter(s => !s.isSystem).forEach(s => subSel.add(new Option(s.name, s.id)));
        (st.groups || []).forEach(g => gSel.add(new Option(g.name, g.id)));

        function setRowStatus(row, st2) {
            row.dataset.status = st2;
            row.querySelectorAll('.mini-status-group.status-group .mini-status-btn').forEach(b => {
                const active = b.dataset.status === st2;
                b.classList.toggle('active', active);
                b.classList.toggle('submitted', active && st2 === '已繳');
                b.classList.toggle('missing', active && st2 === '未繳');
            });
            const signGroup = row.querySelector('.sign-group');
            if (signGroup) {
                const curAsg = st.assignments.find(a => a.id === aSel.value);
                const isExamOrTest = curAsg && isExamAssignment(curAsg.name);
                if (curAsg && curAsg.signOnly || isExamOrTest || st2 === '已繳') {
                    signGroup.style.display = 'flex';
                } else {
                    signGroup.style.display = 'none';
                    setRowSign(row, '未簽名');
                }
            }
        }

        function setRowSign(row, sg) {
            row.dataset.signStatus = sg;
            row.querySelectorAll('.mini-status-group.sign-group .mini-status-btn').forEach(b => {
                const active = b.dataset.sign === sg;
                b.classList.toggle('active', active);
                b.classList.toggle('submitted', active && sg === '已簽名');
                b.classList.toggle('unsigned', active && sg === '未簽名');
            });
        }

        function buildStudentRows(students, needsSign) {
            const wrap = $('studentRows');
            const curAsg = st.assignments.find(a => a.id === aSel.value);
            const isExamOrTest = curAsg && isExamAssignment(curAsg.name);
            const showSignByDefault = curAsg && (curAsg.signOnly || isExamOrTest);

            wrap.innerHTML = students.map(s => `
                <div class="student-row" data-student="${escapeHtml(s.id)}" data-name="${escapeHtml(s.name)}">
                    <span class="student-name">${escapeHtml(s.name)}</span>
                    <div class="row-status-groups">
                        <div class="mini-status-group status-group">
                            ${STATUS_LIST.map(v => `<button type="button" class="mini-status-btn" data-status="${v}">${v}</button>`).join('')}
                        </div>
                        ${needsSign ? `<div class="mini-status-group sign-group" style="${showSignByDefault ? 'display:flex' : 'display:none'}">
                            ${SIGN_LIST.map(v => `<button type="button" class="mini-status-btn" data-sign="${v}">${v === '未簽名' ? '未簽' : v}</button>`).join('')}
                        </div>` : ''}
                    </div>
                </div>`).join('');

            wrap.querySelectorAll('.student-row').forEach(row => {
                row.querySelectorAll('.status-group .mini-status-btn').forEach(btn => {
                    btn.onclick = () => setRowStatus(row, btn.dataset.status);
                });
                if (needsSign) {
                    row.dataset.signStatus = '未簽名';
                    row.querySelectorAll('.sign-group .mini-status-btn').forEach(btn => {
                        btn.onclick = () => setRowSign(row, btn.dataset.sign);
                    });
                }
                setRowStatus(row, '未繳');
            });
        }

        function refreshStudents() {
            const curAsg = st.assignments.find(a => a.id === aSel.value);
            const curSubj = curAsg ? st.subjects.find(x => x.id === curAsg.subjectId) : null;
            const curSubjName = curSubj ? curSubj.name : '';
            const list = sortBySeat((st.students || []).filter(s => s.groupId === gSel.value && !isPulledOut(s, curSubjName)));
            buildStudentRows(list, !!(curAsg && (curAsg.needsSign || curAsg.signOnly)));
            $('studentStep').style.display = list.length ? 'block' : 'none';
            $('noStudentHint').style.display = list.length ? 'none' : 'block';

            if (curAsg && list.length) {
                const assignmentIdAtFetch = curAsg.id;
                getDocs(query(coll, where('assignmentId', '==', assignmentIdAtFetch))).then(snap => {
                    if (aSel.value !== assignmentIdAtFetch) return;
                    const wrap = $('studentRows');
                    snap.docs.forEach(d => {
                        const data = d.data();
                        const row = wrap.querySelector(`.student-row[data-student="${data.studentId}"]`);
                        if (!row) return;
                        if (data.status) setRowStatus(row, data.status);
                        if ((curAsg.needsSign || curAsg.signOnly) && data.signStatus) setRowSign(row, data.signStatus);
                    });
                }).catch(e => logger.warn('FETCH_STUDENT_STATUS_FAILED', e));
            }
        }

        function updateGroupVisibility() {
            const show = !!aSel.value;
            $('groupStep').style.display = show ? 'block' : 'none';
            if (show) refreshStudents();
        }

        function refreshAssignments() {
            aSel.innerHTML = '';
            const list = (st.assignments || []).filter(a => a.subjectId === subSel.value && a.name !== '聯絡簿每日任務');
            list.forEach(a => {
                const signNote = a.signOnly ? '（只要簽名）' : (a.needsSign ? '（需簽名）' : '');
                aSel.add(new Option(a.name + signNote, a.id));
            });
            $('noAssignmentHint').style.display = list.length ? 'none' : 'block';
            updateGroupVisibility();
        }

        subSel.onchange = refreshAssignments;
        aSel.onchange = updateGroupVisibility;
        gSel.onchange = refreshStudents;
        refreshAssignments();

        $('fSubmit').onclick = async () => {
            const rows = [...document.querySelectorAll('#studentRows .student-row')];
            if (!rows.length) return;
            $('fSubmit').disabled = true;
            const groupName = gSel.options[gSel.selectedIndex]?.text || '';
            const curAsg = st.assignments.find(a => a.id === aSel.value);
            const items = rows.map(row => ({
                groupId: gSel.value,
                groupName,
                studentId: row.dataset.student,
                studentName: row.dataset.name,
                subjectId: subSel.value,
                subjectName: subSel.options[subSel.selectedIndex]?.text || '',
                assignmentId: aSel.value,
                assignmentName: curAsg ? curAsg.name : '',
                status: row.dataset.status,
                ...((curAsg && (curAsg.needsSign || curAsg.signOnly)) ? { signStatus: row.dataset.signStatus } : {})
            }));
            await submitGroupRecords(items);
            $('fSubmit').disabled = false;
            $('fMsg').textContent = `已送出「${groupName}」共 ${items.length} 位學生的登記`;
            setTimeout(() => { if ($('fMsg')) $('fMsg').textContent = ''; }, 4000);
        };
    }
}

