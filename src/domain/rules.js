/**
 * 班級作業登記系統 - 純業務領域規則 (Domain Rules)
 * 100% 純函數，不依賴 DOM 與 Firebase SDK，具備高可測試性與可維護性。
 */

export const STATUS_LIST = ['已繳', '未繳'];
export const SIGN_LIST = ['已簽名', '未簽名'];

export const badgeClass = (s) => (s === '已繳' ? 'submitted' : 'missing');
export const signClass = (s) => (s === '已簽名' ? 'submitted' : 'unsigned');

export function nextStatus(cur) {
    const i = STATUS_LIST.indexOf(cur);
    return STATUS_LIST[(i + 1) % STATUS_LIST.length];
}

export function nextSign(cur) {
    const isSigned = cur === '已簽名' || cur === '已簽';
    return isSigned ? '未簽名' : '已簽名';
}

/**
 * 依座號排序學生清單（無座號置底，同座號依姓名拼音排序）
 */
export function sortBySeat(list) {
    return [...(list || [])].sort((a, b) => {
        const an = a.seat === '' || a.seat == null ? Infinity : Number(a.seat);
        const bn = b.seat === '' || b.seat == null ? Infinity : Number(b.seat);
        if (an !== bn) return an - bn;
        return (a.name || '').localeCompare(b.name || '', 'zh-Hant');
    });
}

/**
 * 判斷學生在該科目是否為抽離課程
 */
export function isPulledOut(student, subjectName) {
    if (!student || !student.pullout || !subjectName) return false;
    const sName = subjectName.trim();
    if (sName.includes('國') && student.pullout.chinese) return true;
    if (sName.includes('數') && student.pullout.math) return true;
    return false;
}

export function pulloutLabel(p) {
    if (!p) return '抽離';
    const parts = [];
    if (p.chinese) parts.push('國');
    if (p.math) parts.push('數');
    return parts.length ? `抽離:${parts.join('')}` : '抽離';
}

export function nextPullout(p) {
    p = p || { chinese: false, math: false };
    if (!p.chinese && !p.math) return { chinese: true, math: false };
    if (p.chinese && !p.math) return { chinese: false, math: true };
    if (!p.chinese && p.math) return { chinese: true, math: true };
    return { chinese: false, math: false };
}

/**
 * 判斷是否為考試/測驗型作業（通常需簽名）
 */
export function isExamAssignment(name) {
    const n = name || '';
    return n.includes('卷') || n.includes('考') || n.includes('聽') || n.includes('測驗');
}

/**
 * 計算單項批改得分 (全對 10 點、有錯訂正 5 點、其餘 0 點)
 * 修復 Bug：封存後或 fallback 時若原先為 signOnly/Exam，需保留不給點規則
 */
export function pointsOf(g, settings, fallbackMeta = null) {
    if (!g) return 0;
    const aName = g.assignmentName || '';
    if (aName === '聯絡簿每日任務') return 0;
    if (isExamAssignment(aName)) return 0;

    // 優先從目前今日作業找
    const asg = settings && settings.assignments ? settings.assignments.find(a => a.id === g.assignmentId) : null;
    const isSignOnly = asg ? asg.signOnly : (fallbackMeta ? fallbackMeta.signOnly : false);
    const resolvedName = asg ? asg.name : (fallbackMeta ? fallbackMeta.name : aName);

    if (isSignOnly) return 0;
    if (isExamAssignment(resolvedName)) return 0;

    if (g.correctness === '全對') return 10;
    if (g.correctness === '有錯' && g.corrected) return 5;
    return 0;
}

export function todayStr(date = new Date()) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}/${m}/${d}`;
}

export function todayISODate(date = new Date()) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

/**
 * 判斷是否為上課日（考量週末與學期自訂假日）
 */
export function isSchoolDay(dateStr, semester = {}) {
    if (!dateStr) return false;
    const sem = semester || {};
    if (sem.skipWeekends !== false) {
        const day = new Date(dateStr + 'T00:00:00').getDay();
        if (day === 0 || day === 6) return false;
    }
    if (sem.startDate && dateStr < sem.startDate) return false;
    if (sem.endDate && dateStr > sem.endDate) return false;
    if (sem.holidays && Array.isArray(sem.holidays) && sem.holidays.includes(dateStr)) return false;
    return true;
}

export function recordDocId(studentId, assignmentId) {
    return `${studentId}_${assignmentId}`;
}

/**
 * 格式化加點紀錄中的項目清單（修復輸出 [object Object] 的 Bug）
 */
export function formatPointLogItems(items) {
    if (!Array.isArray(items) || !items.length) return '無項目明細';
    return items.map(it => {
        if (typeof it === 'string') return it;
        if (it && typeof it === 'object') {
            const name = it.assignmentName || '作業';
            const type = it.type ? `(${it.type})` : '';
            const pts = it.points != null ? `+${it.points}點` : '';
            return `${name}${type} ${pts}`.trim();
        }
        return String(it);
    }).join('、');
}

/**
 * 簡易 XSS 防護字串轉義
 */
export function escapeHtml(str) {
    if (str == null) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

/**
 * 響應式作業名稱折行優化
 */
export function formatAssignmentLabel(name, compactCols) {
    if (!name) return '';
    if (!compactCols) return escapeHtml(name);
    if (name === '聯絡簿每日任務') return '聯絡簿<br>每日任務';
    
    const lMatch = name.match(/^([Ll][0-9０-９]+)(.*)$/);
    if (lMatch && lMatch[2]) return `${escapeHtml(lMatch[1])}<br>${escapeHtml(lMatch[2])}`;
    
    const pageMatch = name.match(/^(.*?)\s*([Pp]\.?\s*[0-9０-９]+\s*[-~～至到]\s*[0-9０-９]+)\s*$/);
    if (pageMatch && pageMatch[1]) return `${escapeHtml(pageMatch[1])}<br>${escapeHtml(pageMatch[2])}`;
    
    const rangeMatch = name.match(/^(.*?)\s*([0-9０-９]+\s*[-~～至到]\s*[0-9０-９]+)\s*$/);
    if (rangeMatch && rangeMatch[1]) return `${escapeHtml(rangeMatch[1])}<br>${escapeHtml(rangeMatch[2])}`;
    
    const unitMatch = name.match(/^(.*?)\s*(第?[0-9０-９]+\s*單元)\s*$/);
    if (unitMatch && unitMatch[1]) return `${escapeHtml(unitMatch[1])}<br>${escapeHtml(unitMatch[2])}`;
    
    return escapeHtml(name);
}

/**
 * 響應式學生儲存格格式化
 */
export function formatStudentCell(name, compactCols) {
    if (!name) return '';
    if (!compactCols) return escapeHtml(name);
    const trimmed = name.trim();
    const m = trimmed.match(/^\s*([0-9０-９]+)\s*(.*)$/);
    if (m && m[2]) return `${escapeHtml(m[1])}<br>${escapeHtml(m[2])}`;
    return escapeHtml(name);
}

/**
 * 取得作業日期排序用的比較鍵 (YYYY-MM-DD)
 */
export function getAssignmentDateKey(info = {}, id = '') {
    const str = `${info.dateLabel || ''} ${info.name || ''} ${id || ''}`;
    const m4 = str.match(/(\d{4})[/-](\d{1,2})[/-](\d{1,2})/);
    if (m4) {
        return `${m4[1]}-${m4[2].padStart(2, '0')}-${m4[3].padStart(2, '0')}`;
    }
    const m2 = str.match(/(?:^|\s|[^\d])(\d{1,2})[/-](\d{1,2})(?:$|\s|[^\d])/);
    if (m2) {
        return `9999-${m2[1].padStart(2, '0')}-${m2[2].padStart(2, '0')}`;
    }
    if (info.timestamp) {
        const d = new Date(info.timestamp);
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    }
    return '';
}

/**
 * 依前綴日期將歷史作業降冪排序（越新的日期排越前面）
 */
export function sortArchivedAssignments(entries) {
    return [...entries].sort(([idA, infoA], [idB, infoB]) => {
        const keyA = getAssignmentDateKey(infoA, idA);
        const keyB = getAssignmentDateKey(infoB, idB);
        if (keyA && keyB) {
            const cmp = keyB.localeCompare(keyA);
            if (cmp !== 0) return cmp;
        } else if (keyA && !keyB) {
            return -1;
        } else if (!keyA && keyB) {
            return 1;
        }
        return (infoB.name || '').localeCompare(infoA.name || '', 'zh-Hant');
    });
}

/**
 * 解析即時遺失作業清單（活資料 gradingRecords 優先覆蓋封存快照）
 */
export function resolveLostAssignments(students = [], liveGradingRecs = [], archiveDocsMap = {}) {
    const resolvedGrading = new Map();
    
    // 1. 封存庫快照為基底
    if (archiveDocsMap) {
        const uniqueDocs = new Set(Object.values(archiveDocsMap));
        uniqueDocs.forEach(doc => {
            if (doc && Array.isArray(doc.records)) {
                doc.records.forEach(r => {
                    if (r && r.studentId && r.assignmentId) {
                        const key = `${r.studentId}_${r.assignmentId}`;
                        resolvedGrading.set(key, {
                            studentId: r.studentId,
                            assignmentId: r.assignmentId,
                            assignmentName: r.assignmentName || '作業',
                            correctness: r.correctness || ''
                        });
                    }
                });
            }
        });
    }

    // 2. 活資料 gradingRecords 覆蓋（若已被取消遺失或改判，以最新狀態為準）
    (liveGradingRecs || []).forEach(g => {
        if (g && g.studentId && g.assignmentId) {
            const key = `${g.studentId}_${g.assignmentId}`;
            const existing = resolvedGrading.get(key);
            resolvedGrading.set(key, {
                studentId: g.studentId,
                assignmentId: g.assignmentId,
                assignmentName: g.assignmentName || (existing ? existing.assignmentName : '作業'),
                correctness: g.correctness || ''
            });
        }
    });

    // 3. 彙總每位學生的遺失項目
    const lostCounts = {};
    (students || []).forEach(s => {
        lostCounts[s.id] = { count: 0, assignments: [], seenIds: new Set() };
    });

    resolvedGrading.forEach(item => {
        if (item.correctness === '遺失') {
            const lc = lostCounts[item.studentId];
            if (lc && !lc.seenIds.has(item.assignmentId)) {
                lc.seenIds.add(item.assignmentId);
                lc.count++;
                lc.assignments.push(item.assignmentName);
            }
        }
    });

    return sortBySeat(students)
        .map(s => ({ id: s.id, name: s.name, ...lostCounts[s.id] }))
        .filter(x => x.count > 0);
}

/**
 * 取得待加點作業清單中的最新日期（格式化為「M月D日」）
 */
export function getLatestEligibleAssignmentDate(eligibleItems = [], settings = {}, archiveDocsMap = {}, extraPastAssignments = {}) {
    if (!eligibleItems.length) return '';
    const currentAssignmentIds = new Set((settings.assignments || []).map(a => a.id));
    let maxDateStr = '';
    let maxDisplay = '';

    eligibleItems.forEach(g => {
        const aid = g.assignmentId;
        const arch = archiveDocsMap ? archiveDocsMap[aid] : null;
        const extra = extraPastAssignments ? extraPastAssignments[aid] : null;

        let dateStr = '';
        let display = '';

        if (currentAssignmentIds.has(aid)) {
            const now = new Date();
            dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
            display = `${now.getMonth() + 1}月${now.getDate()}日`;
        } else {
            const rawLabel = (arch && arch.dateLabel) || (extra && extra.dateLabel) || '';
            const testStr = `${rawLabel} ${g.assignmentName || ''} ${aid || ''}`;
            const m4 = testStr.match(/(\d{4})[/-](\d{1,2})[/-](\d{1,2})/);
            if (m4) {
                dateStr = `${m4[1]}-${m4[2].padStart(2, '0')}-${m4[3].padStart(2, '0')}`;
                display = `${Number(m4[2])}月${Number(m4[3])}日`;
            } else {
                const m2 = testStr.match(/(?:^|\s|[^\d])(\d{1,2})[/-](\d{1,2})(?:$|\s|[^\d])/);
                if (m2) {
                    const year = new Date().getFullYear();
                    dateStr = `${year}-${m2[1].padStart(2, '0')}-${m2[2].padStart(2, '0')}`;
                    display = `${Number(m2[1])}月${Number(m2[2])}日`;
                } else if (arch && arch.timestamp) {
                    const d = new Date(arch.timestamp);
                    dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
                    display = `${d.getMonth() + 1}月${d.getDate()}日`;
                } else if (g.updatedAt) {
                    const d = new Date(g.updatedAt);
                    dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
                    display = `${d.getMonth() + 1}月${d.getDate()}日`;
                } else {
                    const now = new Date();
                    dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
                    display = `${now.getMonth() + 1}月${now.getDate()}日`;
                }
            }
        }

        if (!maxDateStr || dateStr > maxDateStr) {
            maxDateStr = dateStr;
            maxDisplay = display;
        }
    });

    return maxDisplay;
}

/**
 * 在封存資料結構中重新命名指定作業
 * 純函數：接受 archiveData（包含 assignments 與 records），回傳更新後的複本與是否被修改
 */
export function renameAssignmentInArchive(archiveData, assignmentId, newName) {
    if (!archiveData || !assignmentId || !newName) return { updated: archiveData, modified: false };
    let modified = false;
    const assignments = (archiveData.assignments || []).map(a => {
        if (a.id === assignmentId) {
            modified = true;
            return { ...a, name: newName };
        }
        return a;
    });
    const records = (archiveData.records || []).map(r => {
        if (r.assignmentId === assignmentId) {
            modified = true;
            return { ...r, assignmentName: newName };
        }
        return r;
    });
    return {
        updated: { ...archiveData, assignments, records },
        modified
    };
}

/**
 * 判斷該作業在未繳交時是否豁免顯示「缺交」（包含聽考、複A卷、複B卷）
 */
export function isGradingMissingExempt(assignmentName) {
    const n = assignmentName || '';
    return /(?:聽考|複[AaＡａ]卷|複[BbＢｂ]卷)/.test(n);
}

