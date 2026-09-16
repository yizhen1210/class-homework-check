/**
 * 班級作業登記系統 - 作業登記分頁 (Records Tab)
 */

import {
    badgeClass,
    signClass,
    nextStatus,
    nextSign,
    sortBySeat,
    isPulledOut,
    isExamAssignment,
    formatAssignmentLabel,
    formatStudentCell,
    escapeHtml,
    recordDocId,
    todayStr
} from '../domain/rules.js';

import {
    db,
    coll,
    archivesColl,
    adminSetStatus,
    submitGroupRecords,
    saveSettings,
    clearAll,
    clearRecordsForAssignment,
    clearGradingForAssignment
} from '../services/firebase.js';

import { showAlert, askInput, askConfirm } from './modals.js';
import { logger } from '../utils/logger.js';
import { doc, getDocs, setDoc, deleteDoc, writeBatch, query, orderBy } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

const $ = id => document.getElementById(id);

export function renderRecordsTab(records, settings, isAdmin, callbacks = {}) {
    const panel = $('tabRecords');
    if (!panel) return;
    const recs = records || [];
    const st = settings || { groups: [], students: [], subjects: [], assignments: [] };
    const students = sortBySeat(st.students);
    const assignments = (st.assignments || []).filter(a => a.name !== '聯絡簿每日任務');

    const statusOf = (studentId, assignmentId) => {
        const r = recs.find(x => x.studentId === studentId && x.assignmentId === assignmentId);
        return r ? r.status : '未繳';
    };
    const signOf = (studentId, assignmentId) => {
        const r = recs.find(x => x.studentId === studentId && x.assignmentId === assignmentId);
        return (r && r.signStatus) ? r.signStatus : '未簽名';
    };

    // 1. 科目下拉選單
    const quickSubjSel = $('quickAssignmentSubject');
    if (quickSubjSel) {
        const curQuickSubj = quickSubjSel.value;
        const optionsHtml = '<option value="">未分類</option>' +
            (st.subjects || []).filter(s => !s.isSystem).map(s => `<option value="${escapeHtml(s.id)}">${escapeHtml(s.name)}</option>`).join('') +
            '<option value="__new__">＋ 新增科目...</option>';
        quickSubjSel.innerHTML = optionsHtml;
        quickSubjSel.value = [...quickSubjSel.options].some(o => o.value === curQuickSubj) ? curQuickSubj : '';

        quickSubjSel.onchange = async () => {
            if (quickSubjSel.value !== '__new__') return;
            const name = await askInput('新增科目名稱，例如：數學', '');
            if (name && name.trim()) {
                const newSubj = { id: crypto.randomUUID(), name: name.trim() };
                st.subjects.push(newSubj);
                await saveSettings({ subjects: st.subjects }, isAdmin);
                renderRecordsTab(recs, st, isAdmin, callbacks);
                setTimeout(() => {
                    const sel = $('quickAssignmentSubject');
                    if (sel) sel.value = newSubj.id;
                }, 0);
            } else {
                quickSubjSel.value = '';
            }
        };
    }

    const renameSubjectBtn = $('renameSubjectBtn');
    if (renameSubjectBtn) {
        renameSubjectBtn.onclick = async () => {
            if (!quickSubjSel.value || quickSubjSel.value === '__new__') {
                showAlert('請先在左邊下拉選單選擇要改名的科目');
                return;
            }
            const subj = st.subjects.find(x => x.id === quickSubjSel.value);
            if (!subj) return;
            const name = await askInput('修改科目名稱', subj.name);
            if (name === null) return;
            if (!name.trim()) {
                showAlert('名稱不能空白');
                return;
            }
            subj.name = name.trim();
            await saveSettings({ subjects: st.subjects }, isAdmin);
            renderRecordsTab(recs, st, isAdmin, callbacks);
        };
    }

    const deleteSubjectBtn = $('deleteSubjectBtn');
    if (deleteSubjectBtn) {
        deleteSubjectBtn.onclick = async () => {
            if (!quickSubjSel.value || quickSubjSel.value === '__new__') {
                showAlert('請先在左邊下拉選單選擇要刪除的科目');
                return;
            }
            const subj = st.subjects.find(x => x.id === quickSubjSel.value);
            if (!subj) return;
            const ok2 = await askConfirm(`刪除科目「${subj.name}」不會刪除底下已建立的作業（會變成未分類），確定要刪除嗎？`);
            if (!ok2) return;
            st.subjects = st.subjects.filter(x => x.id !== subj.id);
            st.assignments.forEach(a => { if (a.subjectId === subj.id) a.subjectId = ''; });
            await saveSettings({ subjects: st.subjects, assignments: st.assignments }, isAdmin);
            renderRecordsTab(recs, st, isAdmin, callbacks);
        };
    }

    const subjNameOf = a => {
        const s = (st.subjects || []).find(x => x.id === a.subjectId);
        return s ? s.name : '';
    };

    // 2. 統計數據卡片
    let doneCount = 0, missingCount = 0, unsignedCount = 0;
    students.forEach(s => assignments.forEach(a => {
        if (isPulledOut(s, subjNameOf(a))) return;
        const v = statusOf(s.id, a.id);
        if (v === '已繳') doneCount++; else missingCount++;
        if (a.needsSign || a.signOnly) {
            const sgn = signOf(s.id, a.id);
            const isExamOrTest = isExamAssignment(a.name);
            if ((a.signOnly || isExamOrTest || v === '已繳') && sgn !== '已簽名') unsignedCount++;
        }
    }));

    const statDefs = [
        { label: '學生', val: students.length },
        { label: '作業', val: assignments.length },
        { label: '已繳', val: doneCount },
        { label: '未繳', val: missingCount, detail: 'missing' },
        { label: '未簽名', val: unsignedCount, detail: 'unsigned' }
    ];

    const statCardsEl = $('statCards');
    if (statCardsEl) {
        statCardsEl.innerHTML = statDefs.map(d =>
            `<div class="stat-card${d.detail ? ' clickable' : ''}" ${d.detail ? `data-stat="${d.detail}"` : ''}><div class="stat-num">${d.val}</div><div class="stat-label">${d.label}</div></div>`
        ).join('');

        statCardsEl.querySelectorAll('[data-stat]').forEach(el => {
            el.onclick = () => {
                const type = el.getAttribute('data-stat');
                if (type === 'missing') {
                    $('missingListTitle').textContent = '未繳詳情';
                    $('missingListBody').innerHTML = assignments.length ? assignments.map(a => {
                        const applicable = students.filter(s => !isPulledOut(s, subjNameOf(a)));
                        const missing = applicable.filter(s => statusOf(s.id, a.id) !== '已繳');
                        return `<p><strong>${escapeHtml(a.name)}</strong>：${missing.length ? missing.map(s => escapeHtml(s.name)).join('、') : '全部已繳'}</p>`;
                    }).join('') : '<p>目前尚無作業</p>';
                } else {
                    const signAssignments = assignments.filter(a => a.needsSign || a.signOnly);
                    $('missingListTitle').textContent = '未簽名詳情';
                    $('missingListBody').innerHTML = signAssignments.length ? signAssignments.map(a => {
                        const applicable = students.filter(s => !isPulledOut(s, subjNameOf(a)));
                        const unsigned = applicable.filter(s => {
                            const stt = statusOf(s.id, a.id);
                            const isExamOrTest = isExamAssignment(a.name);
                            if (!a.signOnly && !isExamOrTest && stt !== '已繳') return false;
                            return signOf(s.id, a.id) !== '已簽名';
                        });
                        return `<p><strong>${escapeHtml(a.name)}</strong>：${unsigned.length ? unsigned.map(s => escapeHtml(s.name)).join('、') : '全部已簽名'}</p>`;
                    }).join('') : '<p>目前沒有需要簽名的作業</p>';
                }
                $('missingListModal').style.display = 'flex';
            };
        });
    }

    // 3. 今日作業清單管理
    const mgmtListEl = $('assignmentMgmtList');
    if (mgmtListEl) {
        mgmtListEl.innerHTML = assignments.length ? assignments.map(a => `
            <div class="assignment-row" data-assignment="${escapeHtml(a.id)}">
                <span class="assignment-name">${escapeHtml(a.name)}${a.signOnly ? '<span class="sign-tag" style="background:#b8860c;color:#fff">只要簽名</span>' : (a.needsSign ? '<span class="sign-tag">需簽名</span>' : '')}</span>
                <div class="assignment-actions">
                    <button class="btn small" data-mark-all="${escapeHtml(a.id)}">✓ 全班已繳</button>
                    <button class="btn small outline danger" data-del-assignment2="${escapeHtml(a.id)}">刪除</button>
                </div>
            </div>`).join('') : '<p class="empty-hint">尚未新增作業</p>';

        mgmtListEl.querySelectorAll('[data-mark-all]').forEach(b => {
            b.onclick = async () => {
                const aid = b.getAttribute('data-mark-all');
                const a = assignments.find(x => x.id === aid);
                const subj = a ? st.subjects.find(s => s.id === a.subjectId) : null;
                const items = students.filter(s => !isPulledOut(s, subj ? subj.name : '')).map(s => {
                    const grp = st.groups.find(g => g.id === s.groupId);
                    return {
                        groupId: grp ? grp.id : '',
                        groupName: grp ? grp.name : '',
                        studentId: s.id,
                        studentName: s.name,
                        subjectId: a ? a.subjectId || '' : '',
                        subjectName: subj ? subj.name : '',
                        assignmentId: aid,
                        assignmentName: a ? a.name : '',
                        status: '已繳'
                    };
                });
                await submitGroupRecords(items);
            };
        });

        mgmtListEl.querySelectorAll('[data-del-assignment2]').forEach(b => {
            b.onclick = async () => {
                const aid = b.getAttribute('data-del-assignment2');
                const ok2 = await askConfirm('刪除這份作業會一併刪除所有學生對它的繳交紀錄，確定要刪除嗎？');
                if (!ok2) return;
                st.assignments = st.assignments.filter(x => x.id !== aid);
                await saveSettings({ assignments: st.assignments }, isAdmin);
                const batch = writeBatch(db);
                students.forEach(s => batch.delete(doc(coll, recordDocId(s.id, aid))));
                await batch.commit().catch(e => logger.warn('DELETE_ASSIGNMENT_BATCH_FAILED', e));
            };
        });
    }

    // 4. 繳交矩陣表渲染 (修復 </div></div></td> 標籤多餘問題)
    const compactCols = window.innerWidth <= 680 && assignments.length > 3;
    const thead = $('matrixThead');
    if (thead) {
        thead.innerHTML = '<tr><th>學生</th>' + assignments.map(a =>
            `<th>${formatAssignmentLabel(a.name, compactCols)}${a.signOnly ? `<br><span class="sign-tag" style="background:#b8860c;color:#fff">${compactCols ? '簽' : '只要簽名'}</span>` : (a.needsSign ? `<br><span class="sign-tag">${compactCols ? '簽' : '需簽名'}</span>` : '')}</th>`
        ).join('') + '</tr>';
    }

    const tbody = $('matrixTbody');
    if (tbody) {
        tbody.innerHTML = students.length ? students.map(s => {
            const cells = assignments.map(a => {
                if (isPulledOut(s, subjNameOf(a))) {
                    return `<td><span class="cell-pulled-out">抽離</span></td>`;
                }
                const v = statusOf(s.id, a.id);
                const statusBtn = `<button type="button" class="cell-status-btn ${badgeClass(v)}" data-student="${escapeHtml(s.id)}" data-assignment="${escapeHtml(a.id)}">${escapeHtml(v)}</button>`;
                const isExamOrTest = isExamAssignment(a.name);
                const showSign = (a.needsSign || a.signOnly) && (a.signOnly || isExamOrTest || v === '已繳');
                if (!a.needsSign && !a.signOnly) return `<td>${statusBtn}</td>`;

                const sv = signOf(s.id, a.id);
                const svDisplay = sv === '未簽名' ? '未簽' : sv;
                const signBtn = `<button type="button" class="cell-status-btn cell-sign-btn ${signClass(sv)}" data-sign-student="${escapeHtml(s.id)}" data-sign-assignment="${escapeHtml(a.id)}" style="visibility:${showSign ? 'visible' : 'hidden'};pointer-events:${showSign ? 'auto' : 'none'}">${escapeHtml(svDisplay)}</button>`;
                // 修正：單一 cell-stack，只閉合一個 </div>
                return `<td><div class="cell-stack">${statusBtn}${signBtn}</div></td>`;
            }).join('');
            return `<tr><td>${formatStudentCell(s.name, compactCols)}</td>${cells}</tr>`;
        }).join('') : '';

        $('matrixEmpty').style.display = students.length && assignments.length ? 'none' : 'block';
        $('matrixEmpty').textContent = !students.length ? '尚未新增學生，請到「學生管理」新增' : (!assignments.length ? '尚未新增作業，請在上方新增今日作業' : '');

        // 綁定點擊事件
        tbody.querySelectorAll('.cell-status-btn:not(.cell-sign-btn)').forEach(btn => {
            btn.onclick = async () => {
                const sid = btn.getAttribute('data-student'), aid = btn.getAttribute('data-assignment');
                const stu = st.students.find(x => x.id === sid);
                const grp = st.groups.find(x => x.id === stu?.groupId);
                const a = st.assignments.find(x => x.id === aid);
                const subj = a ? st.subjects.find(x => x.id === a.subjectId) : null;
                const nv = nextStatus(btn.textContent.trim());
                const payload = {
                    groupId: grp ? grp.id : '',
                    groupName: grp ? grp.name : '',
                    studentId: sid,
                    studentName: stu ? stu.name : '',
                    subjectId: a ? a.subjectId || '' : '',
                    subjectName: subj ? subj.name : '',
                    assignmentId: aid,
                    assignmentName: a ? a.name : '',
                    status: nv
                };
                await adminSetStatus(payload);
                let rec = recs.find(r => r.studentId === sid && r.assignmentId === aid);
                if (rec) Object.assign(rec, payload); else recs.push(payload);
                renderRecordsTab(recs, st, isAdmin, callbacks);
            };
        });

        tbody.querySelectorAll('.cell-sign-btn').forEach(btn => {
            btn.onclick = async () => {
                const sid = btn.getAttribute('data-sign-student'), aid = btn.getAttribute('data-sign-assignment');
                const stu = st.students.find(x => x.id === sid);
                const grp = st.groups.find(x => x.id === stu?.groupId);
                const a = st.assignments.find(x => x.id === aid);
                const subj = a ? st.subjects.find(x => x.id === a.subjectId) : null;
                const currentText = btn.textContent.trim();
                const nv = nextSign(currentText);
                const payload = {
                    groupId: grp ? grp.id : '',
                    groupName: grp ? grp.name : '',
                    studentId: sid,
                    studentName: stu ? stu.name : '',
                    subjectId: a ? a.subjectId || '' : '',
                    subjectName: subj ? subj.name : '',
                    assignmentId: aid,
                    assignmentName: a ? a.name : '',
                    signStatus: nv
                };
                await adminSetStatus(payload);
                let rec = recs.find(r => r.studentId === sid && r.assignmentId === aid);
                if (rec) rec.signStatus = nv; else recs.push({ ...payload, status: '未繳' });
                renderRecordsTab(recs, st, isAdmin, callbacks);
            };
        });
    }
}

