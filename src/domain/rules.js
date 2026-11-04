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
 * 判斷學生在該科目或作業中是否為抽離課程
 */
export function isPulledOut(student, subjectName, assignmentName = '') {
    if (!student || !student.pullout) return false;
    const sName = String(subjectName || '').trim();
    const aName = String(assignmentName || '').trim();
    const combined = `${sName} ${aName}`;
    if (combined.includes('國') && !!student.pullout.chinese) return true;
    if (combined.includes('數') && !!student.pullout.math) return true;
    return false;
}

/**
 * 綜合判斷紀錄或學生在某作業中是否屬於抽離課程（包含歷史快照與活資料安全回退）
 */
export function isRecordPulledOut(record, student, subjectName = '', assignmentName = '') {
    if (record && record.pulledOut) return true;
    if (student) {
        return isPulledOut(student, subjectName, assignmentName || (record ? record.assignmentName : ''));
    }
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

/**
 * 安全解析繳交狀態（活紀錄或封存紀錄任一為已繳則判定為已繳，避免補繳被未繳覆蓋）
 */
export function deriveRecordStatus(liveRecord, archiveRecord) {
    const lStatus = (typeof liveRecord === 'string') ? liveRecord : (liveRecord ? liveRecord.status : '');
    const aStatus = (typeof archiveRecord === 'string') ? archiveRecord : (archiveRecord ? archiveRecord.status : '');
    if (lStatus === '已繳' || aStatus === '已繳') return '已繳';
    if (lStatus) return lStatus;
    if (aStatus) return aStatus;
    return '未繳';
}

/**
 * 安全解析簽名狀態（活紀錄或封存紀錄任一為已簽則判定為已簽名，避免補簽被未簽覆蓋）
 */
export function deriveRecordSign(liveRecord, archiveRecord) {
    const lSign = (typeof liveRecord === 'string') ? liveRecord : (liveRecord ? liveRecord.signStatus : '');
    const aSign = (typeof archiveRecord === 'string') ? archiveRecord : (archiveRecord ? archiveRecord.signStatus : '');
    if (lSign === '已簽名' || lSign === '已簽' || aSign === '已簽名' || aSign === '已簽') return '已簽名';
    if (lSign) return lSign;
    if (aSign) return aSign;
    return '未簽名';
}

export const LEAVE_SEGMENT_RE = /(?:請假|病假|事假|公假|喪假)/;
export const MAKEUP_SUBMIT_SEGMENT_RE = /(?:已補繳|已補交|補繳|補交|狀態改已繳)/;
export const MAKEUP_SIGN_SEGMENT_RE = /(?:已補簽|補簽)/;
export const POINT_SEGMENT_RE = /(?:已加點|加過點數|加點|\+\d+點)/;

function normalizeRemarkSegment(seg) {
    const s = String(seg || '').trim();
    if (!s) return '';
    if (s === '已補交' || s === '補交') return '已補繳';
    if (s.startsWith('已補交（') || s.startsWith('已補交(')) return '已補繳' + s.slice(3);
    if (s.startsWith('補交（') || s.startsWith('補交(')) return '已補繳' + s.slice(2);
    if (s === '補簽') return '已補簽';
    if (s.startsWith('補簽（') || s.startsWith('補簽(')) return '已補簽' + s.slice(2);
    return s;
}

function splitRemarkSegments(remark) {
    if (!remark) return [];
    const str = String(remark);
    const out = [];
    let buf = '';
    let depth = 0;
    for (let i = 0; i < str.length; i++) {
        const ch = str[i];
        if (ch === '(' || ch === '（') {
            depth++;
            buf += ch;
        } else if (ch === ')' || ch === '）') {
            if (depth > 0) depth--;
            buf += ch;
        } else if (depth === 0 && ch === '/') {
            const prev = i > 0 ? str[i - 1] : '';
            const next = i + 1 < str.length ? str[i + 1] : '';
            if (/\d/.test(prev) && /\d/.test(next)) {
                buf += ch;
            } else {
                const norm = normalizeRemarkSegment(buf);
                if (norm) out.push(norm);
                buf = '';
            }
        } else {
            buf += ch;
        }
    }
    const last = normalizeRemarkSegment(buf);
    if (last) out.push(last);
    return out;
}

/**
 * 新增或更新「已補繳」備註標籤（保留請假與已補簽等既有紀錄，不互相覆蓋）
 */
export function appendMakeupSubmitRemark(existingRemark, timeStr) {
    const segs = splitRemarkSegments(existingRemark).filter(s => !MAKEUP_SUBMIT_SEGMENT_RE.test(s));
    const tag = timeStr ? `已補繳（${timeStr}）` : '已補繳';
    const signIdx = segs.findIndex(s => MAKEUP_SIGN_SEGMENT_RE.test(s));
    if (signIdx !== -1) {
        segs.splice(signIdx, 0, tag);
    } else {
        segs.push(tag);
    }
    return segs.join(' / ');
}

/**
 * 移除「已補繳」備註標籤（當狀態改回未繳時，保留請假等其他備註）
 */
export function removeMakeupSubmitRemark(existingRemark) {
    return splitRemarkSegments(existingRemark)
        .filter(s => !MAKEUP_SUBMIT_SEGMENT_RE.test(s))
        .join(' / ');
}

/**
 * 新增或更新「已補簽」備註標籤（保留請假與已補繳等既有紀錄，不互相覆蓋）
 */
export function appendMakeupSignRemark(existingRemark, timeStr) {
    const segs = splitRemarkSegments(existingRemark).filter(s => !MAKEUP_SIGN_SEGMENT_RE.test(s));
    segs.push(timeStr ? `已補簽（${timeStr}）` : '已補簽');
    return segs.join(' / ');
}

/**
 * 移除「已補簽」備註標籤（當簽名改回未簽名時，保留請假與已補繳等備註）
 */
export function removeMakeupSignRemark(existingRemark) {
    return splitRemarkSegments(existingRemark)
        .filter(s => !MAKEUP_SIGN_SEGMENT_RE.test(s))
        .join(' / ');
}

/**
 * 切換「請假」備註標籤（保留已補繳、已補簽等其他備註）
 */
export function toggleLeaveRemark(existingRemark, shouldBeLeave) {
    const segs = splitRemarkSegments(existingRemark).filter(s => !LEAVE_SEGMENT_RE.test(s));
    if (shouldBeLeave) {
        segs.unshift('請假');
    }
    return segs.join(' / ');
}

/**
 * 判斷該筆紀錄是否屬於「請假」
 */
export function isRecordLeave(liveRecord, archiveRecord) {
    const lObj = (liveRecord && typeof liveRecord === 'object') ? liveRecord : null;
    const aObj = (archiveRecord && typeof archiveRecord === 'object') ? archiveRecord : null;
    const lLeave = !!(lObj && (lObj.isLeave || LEAVE_SEGMENT_RE.test(lObj.remark || '')));
    const aLeave = !!(aObj && (aObj.isLeave || LEAVE_SEGMENT_RE.test(aObj.remark || '')));
    return lLeave || aLeave;
}

/**
 * 判斷該筆紀錄是否屬於「補繳」（需目前已繳，且具備補繳標記或補繳備註）
 */
export function isRecordMakeup(liveRecord, archiveRecord, effStatus = null) {
    const resolvedStatus = effStatus || deriveRecordStatus(liveRecord, archiveRecord);
    if (resolvedStatus !== '已繳') return false;
    const lObj = (liveRecord && typeof liveRecord === 'object') ? liveRecord : null;
    const aObj = (archiveRecord && typeof archiveRecord === 'object') ? archiveRecord : null;
    const lMakeup = !!(lObj && (lObj.isMakeup || MAKEUP_SUBMIT_SEGMENT_RE.test(lObj.remark || '')));
    const aMakeup = !!(aObj && (aObj.isMakeup || MAKEUP_SUBMIT_SEGMENT_RE.test(aObj.remark || '')));
    return lMakeup || aMakeup;
}

/**
 * 安全合併活紀錄與封存紀錄的備註文字（確保請假、已補繳、已補簽同時完整保留並標準化）
 */
export function deriveRecordRemark(liveRecord, archiveRecord) {
    const lObj = (liveRecord && typeof liveRecord === 'object') ? liveRecord : null;
    const aObj = (archiveRecord && typeof archiveRecord === 'object') ? archiveRecord : null;
    const effStatus = deriveRecordStatus(lObj, aObj);
    const effSign = deriveRecordSign(lObj, aObj);
    const leave = isRecordLeave(lObj, aObj);
    const pointsGiven = !!((lObj && lObj.pointsGiven) || (aObj && aObj.pointsGiven));

    const aSegs = splitRemarkSegments(aObj ? aObj.remark : '');
    const lSegs = splitRemarkSegments(lObj ? lObj.remark : '');

    let leaveSeg = lSegs.find(s => LEAVE_SEGMENT_RE.test(s)) || aSegs.find(s => LEAVE_SEGMENT_RE.test(s)) || (leave ? '請假' : '');
    if (!leave) leaveSeg = '';

    let submitSeg = '';
    if (effStatus === '已繳') {
        submitSeg = lSegs.find(s => MAKEUP_SUBMIT_SEGMENT_RE.test(s)) || aSegs.find(s => MAKEUP_SUBMIT_SEGMENT_RE.test(s)) || '';
        if (!submitSeg && isRecordMakeup(lObj, aObj, effStatus)) submitSeg = '已補繳';
    }

    let signSeg = '';
    if (effSign === '已簽名') {
        signSeg = lSegs.find(s => MAKEUP_SIGN_SEGMENT_RE.test(s)) || aSegs.find(s => MAKEUP_SIGN_SEGMENT_RE.test(s)) || '';
    }

    let pointSeg = '';
    const existingPointSeg = lSegs.find(s => POINT_SEGMENT_RE.test(s)) || aSegs.find(s => POINT_SEGMENT_RE.test(s));
    if (pointsGiven || existingPointSeg) {
        pointSeg = existingPointSeg || '已加點';
    }

    const others = [];
    [...aSegs, ...lSegs].forEach(s => {
        if (LEAVE_SEGMENT_RE.test(s) || MAKEUP_SUBMIT_SEGMENT_RE.test(s) || MAKEUP_SIGN_SEGMENT_RE.test(s) || POINT_SEGMENT_RE.test(s)) return;
        if (!others.includes(s)) others.push(s);
    });

    return [leaveSeg, submitSeg, signSeg, pointSeg, ...others].filter(Boolean).join(' / ');
}

/**
 * 清理並標準化封存紀錄陣列，消除所有 undefined 欄位避免 Firestore setDoc 拒絕寫入
 */
export function sanitizeArchiveRecords(records) {
    return (records || []).map(r => {
        const remark = r.remark ? splitRemarkSegments(r.remark).join(' / ') : '';
        const isLeave = (typeof r.isLeave === 'boolean') ? (r.isLeave || LEAVE_SEGMENT_RE.test(remark)) : LEAVE_SEGMENT_RE.test(remark);
        const isMakeup = (r.status === '已繳')
            ? ((typeof r.isMakeup === 'boolean') ? (r.isMakeup || MAKEUP_SUBMIT_SEGMENT_RE.test(remark)) : MAKEUP_SUBMIT_SEGMENT_RE.test(remark))
            : false;
        return {
            groupId: r.groupId || '',
            groupName: r.groupName || '',
            studentId: r.studentId || '',
            studentName: r.studentName || '',
            subjectId: r.subjectId || '',
            subjectName: r.subjectName || '',
            assignmentId: r.assignmentId || '',
            assignmentName: r.assignmentName || '',
            status: r.status || '未繳',
            signStatus: r.signStatus || '未簽名',
            correctness: r.correctness || '',
            corrected: !!r.corrected,
            remark,
            pointsGiven: !!r.pointsGiven,
            pulledOut: !!r.pulledOut,
            isLeave: !!isLeave,
            isMakeup: !!isMakeup
        };
    });
}

/**
 * 解析作業對應的實際西元日期 (YYYY-MM-DD)，供期中/期末區間篩選使用
 */
export function resolveAssignmentISODate(info = {}, id = '', fallbackYear = new Date().getFullYear()) {
    const str = `${info.dateLabel || ''} ${info.name || ''} ${id || ''}`;
    const m4 = str.match(/(\d{4})[/-](\d{1,2})[/-](\d{1,2})/);
    if (m4) {
        return `${m4[1]}-${m4[2].padStart(2, '0')}-${m4[3].padStart(2, '0')}`;
    }
    const m2 = str.match(/(?:^|\s|[^\d])(\d{1,2})[/-](\d{1,2})(?:$|\s|[^\d])/);
    if (m2) {
        const y = info.timestamp ? new Date(info.timestamp).getFullYear() : fallbackYear;
        return `${y}-${m2[1].padStart(2, '0')}-${m2[2].padStart(2, '0')}`;
    }
    if (info.timestamp) {
        const d = new Date(info.timestamp);
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    }
    if (info.isActive) {
        return todayISODate();
    }
    return '';
}

/**
 * 收集所有作業項目（含目前作業與所有歷史封存快照，確保聯絡簿封存與同 ID 封存絕不遺漏）
 */
export function collectUnifiedAssignmentEntries({
    settings = {},
    records = [],
    gradingRecords = [],
    archiveDocsList = null,
    archiveDocsMap = {},
    extraPastAssignments = {}
} = {}) {
    const st = settings || {};
    const subjects = st.subjects || [];
    const activeAssignments = st.assignments || [];
    const subjNameOf = a => {
        if (a.subjectName) return a.subjectName;
        const s = subjects.find(x => x.id === a.subjectId);
        return s ? s.name : (a.name === '聯絡簿每日任務' ? '聯絡簿' : '');
    };

    const activeNonContact = activeAssignments.filter(a => a.name !== '聯絡簿每日任務');
    const activeNonContactIds = new Set(activeNonContact.map(a => a.id));
    const activeContactIds = new Set(activeAssignments.filter(a => a.name === '聯絡簿每日任務').map(a => a.id));

    // 建立去重且依時間降冪排列的封存文件清單
    let docs = [];
    if (Array.isArray(archiveDocsList) && archiveDocsList.length) {
        docs = [...archiveDocsList];
    } else if (archiveDocsMap && typeof archiveDocsMap === 'object') {
        const seenDocs = new Set();
        Object.values(archiveDocsMap).forEach(d => {
            if (d && typeof d === 'object' && !seenDocs.has(d)) {
                seenDocs.add(d);
                docs.push(d);
            }
        });
    }
    docs.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

    // 統計每個 assignmentId 在封存文件中出現幾次（避免舊資料同 ID 跨文件互相干擾）
    const aidArchiveCount = new Map();
    docs.forEach(docItem => {
        const docAsgs = (docItem.assignments && docItem.assignments.length)
            ? docItem.assignments
            : Array.from(new Set((docItem.records || []).map(r => r.assignmentId).filter(Boolean))).map(aid => {
                const r0 = (docItem.records || []).find(r => r.assignmentId === aid) || {};
                return { id: aid, name: r0.assignmentName || '未命名作業' };
            });
        docAsgs.forEach(a => {
            if (!a || !a.id) return;
            aidArchiveCount.set(a.id, (aidArchiveCount.get(a.id) || 0) + 1);
        });
    });

    const entries = [];
    const coveredArchiveAids = new Set();

    // 1. 今日活動中作業（依傳入需求決定是否含聯絡簿，由呼叫端過濾 isActiveContact）
    activeAssignments.forEach(a => {
        const isContact = a.name === '聯絡簿每日任務';
        entries.push({
            entryKey: `active_${a.id}`,
            assignmentId: a.id,
            name: a.name,
            subjectName: subjNameOf(a),
            needsSign: !!(a.needsSign || a.signOnly || isContact),
            signOnly: !!a.signOnly,
            dateLabel: todayStr(),
            isoDate: todayISODate(),
            timestamp: Date.now(),
            isActive: true,
            isActiveContact: isContact,
            archiveDoc: null,
            useLive: true
        });
    });

    // 2. 所有封存文件內的作業（包含聯絡簿封存）
    const archivedEntries = [];
    docs.forEach((docItem, docIdx) => {
        const docId = docItem._id || docItem.id || `doc_${docIdx}`;
        const dateLabel = docItem.dateLabel || (docItem.timestamp ? new Date(docItem.timestamp).toLocaleDateString('zh-TW') : '');
        const docAsgs = (docItem.assignments && docItem.assignments.length)
            ? docItem.assignments
            : Array.from(new Set((docItem.records || []).map(r => r.assignmentId).filter(Boolean))).map(aid => {
                const r0 = (docItem.records || []).find(r => r.assignmentId === aid) || {};
                const aName = r0.assignmentName || '未命名作業';
                return {
                    id: aid,
                    name: aName,
                    subjectName: aName === '聯絡簿每日任務' ? '聯絡簿' : '未分類',
                    needsSign: aName === '聯絡簿每日任務',
                    signOnly: false
                };
            });

        docAsgs.forEach(a => {
            if (!a || !a.id) return;
            const isContact = a.name === '聯絡簿每日任務';
            // 若一般作業已還原回今日活動中作業，避免重複計算；但封存的聯絡簿永遠獨立保留！
            if (!isContact && activeNonContactIds.has(a.id)) return;
            coveredArchiveAids.add(a.id);
            const collidesWithActiveContact = isContact && activeContactIds.has(a.id);
            const hasDuplicateArchiveId = (aidArchiveCount.get(a.id) || 0) > 1;
            const infoObj = { dateLabel, name: a.name, timestamp: docItem.timestamp };
            const resolvedSubj = (a.subjectName && a.subjectName !== '未分類')
                ? a.subjectName
                : resolveStatsSubjectName('', a.name, null, null, subjects);
            archivedEntries.push({
                entryKey: `arch_${docId}_${a.id}`,
                assignmentId: a.id,
                archiveDocId: docId,
                name: a.name,
                subjectName: isContact ? '聯絡簿' : (resolvedSubj || subjNameOf(a)),
                needsSign: !!(a.needsSign || a.signOnly || isContact || (docItem.records || []).some(r => r.assignmentId === a.id && r.signStatus && r.signStatus !== '未簽名')),
                signOnly: !!a.signOnly,
                dateLabel,
                isoDate: resolveAssignmentISODate(infoObj, a.id),
                timestamp: docItem.timestamp || 0,
                isActive: false,
                isActiveContact: false,
                archiveDoc: docItem,
                useLive: !collidesWithActiveContact && !hasDuplicateArchiveId
            });
        });
    });

    // 3. 補齊僅存在於 extraPastAssignments 或 gradingRecords 的歷史作業（向下相容舊資料）
    if (extraPastAssignments && typeof extraPastAssignments === 'object') {
        Object.entries(extraPastAssignments).forEach(([aid, info]) => {
            if (coveredArchiveAids.has(aid) || activeNonContactIds.has(aid) || activeContactIds.has(aid)) return;
            const isContact = info.name === '聯絡簿每日任務';
            coveredArchiveAids.add(aid);
            const archDoc = archiveDocsMap ? archiveDocsMap[aid] : null;
            archivedEntries.push({
                entryKey: `extra_${aid}`,
                assignmentId: aid,
                archiveDocId: archDoc ? (archDoc._id || archDoc.id || '') : '',
                name: info.name || '未命名作業',
                subjectName: info.subjectName || (isContact ? '聯絡簿' : '未分類'),
                needsSign: !!(info.needsSign || info.signOnly || isContact),
                signOnly: !!info.signOnly,
                dateLabel: info.dateLabel || '',
                isoDate: resolveAssignmentISODate(info, aid),
                timestamp: info.timestamp || (archDoc ? archDoc.timestamp || 0 : 0),
                isActive: false,
                isActiveContact: false,
                archiveDoc: archDoc || null,
                useLive: true
            });
        });
    }

    (gradingRecords || []).forEach(g => {
        if (!g || !g.assignmentId || !g.assignmentName) return;
        const aid = g.assignmentId;
        if (coveredArchiveAids.has(aid) || activeNonContactIds.has(aid) || activeContactIds.has(aid)) return;
        // 只有歷史聯絡簿每日任務才允許在無封存文件時向下相容；一般科目作業若已被教師刪除，絕不可作為歷史作業復活
        const isContact = g.assignmentName === '聯絡簿每日任務' || aid.startsWith('daily-');
        if (!isContact) return;

        coveredArchiveAids.add(aid);
        const m = aid.match(/^daily-.+-(\d{4})-(\d{2})-(\d{2})/);
        const dateLabel = m ? `${m[1]}/${m[2]}/${m[3]}` : '';
        const infoObj = { dateLabel, name: g.assignmentName, timestamp: g.updatedAt };
        archivedEntries.push({
            entryKey: `grading_${aid}`,
            assignmentId: aid,
            archiveDocId: '',
            name: g.assignmentName,
            subjectName: '聯絡簿',
            needsSign: true,
            signOnly: false,
            dateLabel,
            isoDate: resolveAssignmentISODate(infoObj, aid),
            timestamp: g.updatedAt || 0,
            isActive: false,
            isActiveContact: false,
            archiveDoc: null,
            useLive: true
        });
    });

    archivedEntries.sort((a, b) => {
        const keyA = getAssignmentDateKey(a, a.assignmentId);
        const keyB = getAssignmentDateKey(b, b.assignmentId);
        if (keyA && keyB && keyA !== keyB) return keyB.localeCompare(keyA);
        if ((b.timestamp || 0) !== (a.timestamp || 0)) return (b.timestamp || 0) - (a.timestamp || 0);
        return (b.name || '').localeCompare(a.name || '', 'zh-Hant');
    });

    return [...entries, ...archivedEntries];
}

/**
 * 計算「訂正與加點」上方彈窗清單（未繳清單、未訂正清單、未簽名清單）
 * 確保聯絡簿封存後的未繳、未訂正、未簽名 100% 納入統計
 */
export function computeGlobalPopupLists({
    settings = {},
    records = [],
    gradingRecords = [],
    archiveDocsList = null,
    archiveDocsMap = {},
    extraPastAssignments = {}
} = {}) {
    const students = sortBySeat((settings && settings.students) || []);
    const allEntries = collectUnifiedAssignmentEntries({
        settings,
        records,
        gradingRecords,
        archiveDocsList,
        archiveDocsMap,
        extraPastAssignments
    }).filter(e => !e.isActiveContact); // 今日尚未封存的聯絡簿在聯絡簿分頁即時處理；封存後的聯絡簿全部納入

    const formatDisplayName = entry => {
        if (!entry.isActive && entry.dateLabel && !entry.name.includes(entry.dateLabel)) {
            return `${entry.dateLabel} ${entry.name}`;
        }
        return entry.name;
    };

    const missingBlocks = [];
    const uncorrectedBlocks = [];
    const unsignedBlocks = [];

    allEntries.forEach(entry => {
        const id = entry.assignmentId;
        const archDoc = entry.archiveDoc;
        const isContact = entry.name === '聯絡簿每日任務';
        const displayName = formatDisplayName(entry);

        const hasGrading = entry.useLive && (gradingRecords || []).some(g => g.assignmentId === id);
        const hasRecord = entry.useLive && (records || []).some(r => r.assignmentId === id);

        // 1. 未繳清單（非活動且非封存的孤立作業不列入；豁免聽考/複卷不列入未繳）
        const isMissingExempt = isGradingMissingExempt(entry.name);
        const isValidMissingTarget = (entry.isActive || archDoc) && !isMissingExempt;
        if (isValidMissingTarget) {
            const missing = students.filter(s => {
                if (isPulledOut(s, entry.subjectName, entry.name)) return false;
                const archRec = archDoc && (archDoc.records || []).find(r => r.studentId === s.id && r.assignmentId === id);
                if (archRec && archRec.pulledOut) return false;
                const liveG = entry.useLive ? (gradingRecords || []).find(x => x.studentId === s.id && x.assignmentId === id) : null;
                const correctness = (liveG && liveG.correctness !== undefined) ? liveG.correctness : (archRec ? archRec.correctness || '' : '');
                if (correctness === '遺失' || correctness === '沒寫任務') return false;
                const liveRec = entry.useLive ? (records || []).find(r => r.studentId === s.id && r.assignmentId === id) : null;
                const status = deriveRecordStatus(liveRec, archRec ? archRec.status : '未繳');
                return status !== '已繳';
            });
            if (missing.length) {
                missingBlocks.push({
                    entryKey: entry.entryKey,
                    assignmentId: id,
                    displayName,
                    studentNames: missing.map(s => s.name)
                });
            }
        }

        // 2. 未訂正清單（非活動且非封存的孤立作業不列入）
        if (!entry.signOnly && (entry.isActive || archDoc)) {
            const hasAnyGrading = hasGrading || (archDoc && (archDoc.records || []).some(r => r.assignmentId === id && (r.correctness || r.corrected)));
            if (hasAnyGrading) {
                const uncorrected = students.filter(s => {
                    if (isPulledOut(s, entry.subjectName, entry.name)) return false;
                    const archRec = archDoc && (archDoc.records || []).find(r => r.studentId === s.id && r.assignmentId === id);
                    if (archRec && archRec.pulledOut) return false;
                    const liveG = entry.useLive ? (gradingRecords || []).find(x => x.studentId === s.id && x.assignmentId === id) : null;
                    const correctness = (liveG && liveG.correctness !== undefined) ? liveG.correctness : (archRec ? archRec.correctness || '' : '');
                    const isCorrected = (liveG && liveG.corrected !== undefined) ? !!liveG.corrected : (archRec ? !!archRec.corrected : false);
                    return correctness === '有錯' && !isCorrected;
                });
                if (uncorrected.length) {
                    uncorrectedBlocks.push({
                        entryKey: entry.entryKey,
                        assignmentId: id,
                        displayName,
                        studentNames: uncorrected.map(s => s.name)
                    });
                }
            }
        }

        // 3. 未簽名清單（非活動且非封存的孤立作業不列入）
        if ((entry.needsSign || entry.signOnly || isContact) && (entry.isActive || archDoc)) {
            const unsigned = students.filter(s => {
                if (isPulledOut(s, entry.subjectName, entry.name)) return false;
                const archRec = archDoc && (archDoc.records || []).find(r => r.studentId === s.id && r.assignmentId === id);
                if (archRec && archRec.pulledOut) return false;
                const liveRec = entry.useLive ? (records || []).find(r => r.studentId === s.id && r.assignmentId === id) : null;
                const status = deriveRecordStatus(liveRec, archRec ? archRec.status : '未繳');
                const signStatus = deriveRecordSign(liveRec, archRec ? archRec.signStatus : '未簽名');
                if (isContact) {
                    if (status !== '已繳') return false;
                    return signStatus !== '已簽名';
                }
                const isExamOrTest = isExamAssignment(entry.name);
                if (!entry.signOnly && !isExamOrTest && status !== '已繳') return false;
                return signStatus !== '已簽名';
            });
            if (unsigned.length) {
                unsignedBlocks.push({
                    entryKey: entry.entryKey,
                    assignmentId: id,
                    displayName,
                    studentNames: unsigned.map(s => s.name)
                });
            }
        }
    });

    return { missingBlocks, uncorrectedBlocks, unsignedBlocks };
}

/**
 * 期中/期末作業成績結算：統計每位學生的「一般補繳 / 一般缺交」與「因請假補繳 / 因請假缺交（另外算）」
 */
export function resolveStatsSubjectName(rawSubj, assignmentName, archRec, liveRec, subjects = []) {
    const explicit = String(rawSubj || (archRec && archRec.subjectName) || (liveRec && liveRec.subjectName) || '').trim();
    if (explicit && explicit !== '未分類') return explicit;
    const aName = String(assignmentName || '').trim();
    if (aName === '聯絡簿每日任務' || aName.includes('聯絡簿')) return '聯絡簿';
    const nonSystem = (subjects || []).filter(sub => sub && !sub.isSystem && sub.name);
    const exactMatch = nonSystem.find(sub => aName.includes(sub.name));
    if (exactMatch) return exactMatch.name;
    const pickConfiguredOr = (keyword, fallback) => {
        const found = nonSystem.find(sub => sub.name.includes(keyword));
        return found ? found.name : fallback;
    };
    if (aName.includes('國') || /(?:國語|國習|國卷|國甲|國乙|國作|國練|圈詞|生字|造句|聽寫|聽考|作文)/.test(aName)) return pickConfiguredOr('國', '國語');
    if (aName.includes('數') || /(?:數學|數習|數卷|數作|數練|數格|數單)/.test(aName)) return pickConfiguredOr('數', '數學');
    if (aName.includes('社') || /(?:社會|社習|社卷|社作|社單)/.test(aName)) return pickConfiguredOr('社', '社會');
    if (aName.includes('自') || /(?:自然|自習|自卷|自作|自單)/.test(aName)) return pickConfiguredOr('自', '自然');
    if (aName.includes('英') || /(?:英語|英文|英習|英卷)/.test(aName)) return pickConfiguredOr('英', '英語');
    return '未分類';
}

export function computeMakeupAndLeaveStats({
    settings = {},
    records = [],
    gradingRecords = [],
    archiveDocsList = null,
    archiveDocsMap = {},
    extraPastAssignments = {},
    startDate = '',
    endDate = '',
    includeContactBook = true,
    includeActive = false,
    includeCleanStudents = false
} = {}) {
    const students = sortBySeat((settings && settings.students) || []);
    const subjectsList = (settings && settings.subjects) || [];
    const configuredSubjectOrder = new Map();
    subjectsList.forEach((subj, idx) => {
        if (subj && subj.name && !subj.isSystem && !configuredSubjectOrder.has(subj.name)) {
            configuredSubjectOrder.set(subj.name, idx);
        }
    });
    const getSubjectBaseOrder = (name) => {
        const n = String(name || '').trim();
        if (n.includes('國')) return 1;
        if (n.includes('數')) return 2;
        if (configuredSubjectOrder.has(n)) return 10 + configuredSubjectOrder.get(n);
        if (n.includes('社')) return 40;
        if (n.includes('自')) return 50;
        if (n.includes('英')) return 60;
        if (n === '聯絡簿' || n.includes('聯絡簿')) return 100;
        if (n === '未分類' || n === '其他') return 200;
        return 80;
    };

    const isAllPurpleSubject = (sg) => {
        const hasBlueOrRed = (sg.regularMakeup && sg.regularMakeup.length > 0) || (sg.regularMissing && sg.regularMissing.length > 0);
        return !hasBlueOrRed;
    };

    const compareSubjectGroups = (a, b) => {
        const aAllPurple = isAllPurpleSubject(a);
        const bAllPurple = isAllPurpleSubject(b);
        // 若該科目全部都是紫色，就排到最後，優先顯示含有藍、紅的科目
        if (!aAllPurple && bAllPurple) return -1;
        if (aAllPurple && !bAllPurple) return 1;
        // 兩者皆有藍/紅或兩者皆全為紫色：依科目順序（國、數、聯絡簿、其他...）
        const rankA = getSubjectBaseOrder(a.subjectName);
        const rankB = getSubjectBaseOrder(b.subjectName);
        if (rankA !== rankB) return rankA - rankB;
        return a.subjectName.localeCompare(b.subjectName, 'zh-Hant');
    };

    const allEntries = collectUnifiedAssignmentEntries({
        settings,
        records,
        gradingRecords,
        archiveDocsList,
        archiveDocsMap,
        extraPastAssignments
    }).filter(entry => {
        if (entry.isActive && !includeActive) return false;
        if (!includeContactBook && entry.name === '聯絡簿每日任務') return false;
        if (startDate && entry.isoDate && entry.isoDate < startDate) return false;
        if (endDate && entry.isoDate && entry.isoDate > endDate) return false;
        return true;
    });

    const studentStats = students.map(s => {
        const regularMakeup = [];
        const regularMissing = [];
        const leaveMakeup = [];
        const leaveMissing = [];
        const subjectMap = new Map();

        const getOrCreateSubjectGroup = (subjLabel) => {
            if (!subjectMap.has(subjLabel)) {
                subjectMap.set(subjLabel, {
                    subjectName: subjLabel,
                    regularMakeup: [],
                    regularMissing: [],
                    leaveMakeup: [],
                    leaveMissing: [],
                    totalRegularCount: 0,
                    totalLeaveCount: 0
                });
            }
            return subjectMap.get(subjLabel);
        };

        allEntries.forEach(entry => {
            const id = entry.assignmentId;
            if (isPulledOut(s, entry.subjectName, entry.name)) return;
            const archDoc = entry.archiveDoc;
            const archRec = archDoc && (archDoc.records || []).find(r => r.studentId === s.id && r.assignmentId === id);
            if (archRec && archRec.pulledOut) return;

            const liveRec = entry.useLive ? (records || []).find(r => r.studentId === s.id && r.assignmentId === id) : null;
            const effStatus = deriveRecordStatus(liveRec, archRec);
            const effRemark = deriveRecordRemark(liveRec, archRec);
            const leave = isRecordLeave(liveRec, archRec);
            const makeup = isRecordMakeup(liveRec, archRec, effStatus);

            const displayName = (!entry.isActive && entry.dateLabel && !entry.name.includes(entry.dateLabel))
                ? `${entry.dateLabel} ${entry.name}`
                : (entry.isActive ? `今日 ${entry.name}` : entry.name);
            const displaySubject = resolveStatsSubjectName(entry.subjectName, entry.name, archRec, liveRec, subjectsList);

            const detailItem = {
                entryKey: entry.entryKey,
                assignmentId: id,
                archiveDocId: entry.archiveDocId || (archDoc ? (archDoc._id || archDoc.id || '') : ''),
                isActive: !!entry.isActive,
                dateLabel: entry.dateLabel || '',
                isoDate: entry.isoDate || '',
                assignmentName: entry.name,
                subjectName: displaySubject,
                displayName,
                status: effStatus,
                remark: effRemark,
                isLeave: leave,
                isMakeup: makeup
            };

            if (leave) {
                const sg = getOrCreateSubjectGroup(displaySubject);
                sg.totalLeaveCount++;
                if (effStatus === '已繳') {
                    leaveMakeup.push(detailItem);
                    sg.leaveMakeup.push(detailItem);
                } else {
                    leaveMissing.push(detailItem);
                    sg.leaveMissing.push(detailItem);
                }
            } else if (effStatus === '已繳' && makeup) {
                const sg = getOrCreateSubjectGroup(displaySubject);
                sg.totalRegularCount++;
                regularMakeup.push(detailItem);
                sg.regularMakeup.push(detailItem);
            } else if (effStatus !== '已繳') {
                const sg = getOrCreateSubjectGroup(displaySubject);
                sg.totalRegularCount++;
                regularMissing.push(detailItem);
                sg.regularMissing.push(detailItem);
            }
        });

        const subjectGroups = Array.from(subjectMap.values())
            .sort(compareSubjectGroups);
        const totalRegularCount = regularMakeup.length + regularMissing.length;
        const totalLeaveCount = leaveMakeup.length + leaveMissing.length;

        return {
            studentId: s.id,
            studentName: s.name,
            seat: s.seat,
            regularMakeup,
            regularMissing,
            leaveMakeup,
            leaveMissing,
            subjectGroups,
            totalRegularCount,
            totalLeaveCount,
            hasAnyRecord: (totalRegularCount + totalLeaveCount) > 0
        };
    });

    const filteredStudents = includeCleanStudents
        ? studentStats
        : studentStats.filter(stItem => stItem.hasAnyRecord);

    return {
        assignmentCount: allEntries.length,
        students: filteredStudents,
        allStudentsCount: students.length
    };
}

/**
 * 將補繳與請假統計格式化為可一鍵複製的純文字報表（依科目分組排列）
 */
export function formatMakeupAndLeaveReport(statsResult, { className = '', startDate = '', endDate = '', includeContactBook = true } = {}) {
    const rangeText = (startDate || endDate) ? `${startDate || '開學'} ~ ${endDate || '今日'}` : '全部期間';
    const scopeText = includeContactBook ? '含聯絡簿' : '不含聯絡簿';
    const title = `【${className ? className + ' ' : ''}期中／期末 作業補繳與未繳統計】`;
    const header = `${title}\n統計期間：${rangeText}（${scopeText}，共 ${statsResult.assignmentCount} 項作業）`;

    if (!statsResult.students || !statsResult.students.length) {
        return `${header}\n目前期間內無補繳、缺交或請假紀錄。`;
    }

    const lines = statsResult.students.map(stItem => {
        const sName = String(stItem.studentName || '').trim();
        const hasSeatPrefix = stItem.seat != null && stItem.seat !== '' && !sName.startsWith(String(stItem.seat));
        const prefix = hasSeatPrefix ? `${stItem.seat}號 ${sName}` : sName;
        const summaryParts = [
            `已補 ${stItem.regularMakeup.length}`,
            `未繳 ${stItem.regularMissing.length}`
        ];
        if (stItem.totalLeaveCount > 0) {
            summaryParts.push(`請假 ${stItem.totalLeaveCount}（已補 ${stItem.leaveMakeup.length}／未繳 ${stItem.leaveMissing.length}）`);
        }
        const detailLines = [];
        const groups = Array.isArray(stItem.subjectGroups) ? stItem.subjectGroups : [];
        groups.forEach(sg => {
            const sgParts = [];
            if (sg.regularMakeup.length > 0) sgParts.push(`已補 ${sg.regularMakeup.length}`);
            if (sg.regularMissing.length > 0) sgParts.push(`未繳 ${sg.regularMissing.length}`);
            if (sg.totalLeaveCount > 0) sgParts.push(`請假 ${sg.totalLeaveCount}（已補 ${sg.leaveMakeup.length}／未繳 ${sg.leaveMissing.length}）`);
            detailLines.push(`  【${sg.subjectName}】${sgParts.join('｜')}`);
            if (sg.regularMakeup.length) {
                detailLines.push(`    ・已補：${sg.regularMakeup.map(x => x.displayName).join('、')}`);
            }
            if (sg.regularMissing.length) {
                detailLines.push(`    ・未繳：${sg.regularMissing.map(x => x.displayName).join('、')}`);
            }
            if (sg.leaveMakeup.length) {
                detailLines.push(`    ・請假（已補）：${sg.leaveMakeup.map(x => x.displayName).join('、')}`);
            }
            if (sg.leaveMissing.length) {
                detailLines.push(`    ・請假（未繳）：${sg.leaveMissing.map(x => x.displayName).join('、')}`);
            }
        });
        return [`${prefix}｜${summaryParts.join('｜')}`, ...detailLines].join('\n');
    });

    return `${header}\n────────────────────\n${lines.join('\n')}`;
}

